/**
 * The escalation engine — a persisted state machine with one writer.
 *
 * `startEscalation()` creates the row on the path's published version and
 * enters the graph. `advanceEscalation()` is the single transition function:
 * it reads the row, acts on the current node (page, wait, branch, loop, hand
 * over) and writes the next state under an optimistic lock (`row_version`).
 * Ticks are BullMQ delayed jobs keyed by row version; the worker's sweep
 * catches any tick that was lost. Everything is replayable with an injected
 * clock, and idempotent: a stale tick finds a newer row and does nothing.
 */
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import {
  alertEvents,
  alerts,
  catalogEntries,
  catalogTypes,
  escalationEvents,
  escalationPathVersions,
  escalationPaths,
  escalations,
  incidentEvents,
  incidentParticipants,
  incidents,
  members,
  rotations,
  scheduleOverrides,
  schedules,
  withTenant,
  workingHoursSets,
  type EscalationGraph,
  type EscalationNode,
  type EscalationTarget,
  type Tx,
} from "@openincident/db";
import { notifyMember, tenantOrigin } from "./notify";
import { nextOnCall, onCallAt } from "./rotation";
import { inWorkingHours, nextWorkingHoursStart } from "./time";
import { ESCALATION_QUEUE } from "./queues";

const MIN = 60_000;

/* ---------- Ticks ---------- */

let queue: Queue | null = null;
function getQueue(): Queue | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!queue) {
    queue = new Queue(ESCALATION_QUEUE, {
      connection: new IORedis(url, { maxRetriesPerRequest: null, enableOfflineQueue: false }),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "fixed", delay: 5_000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    });
  }
  return queue;
}

export type TickJob = { tenantId: string; escalationId: string; rowVersion: number };

/** Schedules the next tick. The job id carries the row version: a superseded tick is a no-op. */
export async function scheduleTick(
  tenantId: string,
  escalationId: string,
  rowVersion: number,
  at: Date,
): Promise<boolean> {
  const q = getQueue();
  if (!q) return false;
  try {
    await q.add("tick", { tenantId, escalationId, rowVersion } satisfies TickJob, {
      delay: Math.max(0, at.getTime() - Date.now()),
      jobId: `${escalationId}:${rowVersion}`,
    });
    return true;
  } catch {
    return false;
  }
}

/* ---------- Targets ---------- */

export type ResolvedMember = { id: string; name: string; email: string };

/** Resolves a level's targets to members, at an instant — schedules read their rotations and overrides. */
export async function resolveTargets(
  tx: Tx,
  tenantId: string,
  targets: EscalationTarget[],
  now: Date,
): Promise<ResolvedMember[]> {
  const ids = new Set<string>();
  for (const t of targets) {
    if (t.kind === "member") ids.add(t.memberId);
    if (t.kind === "team") {
      const [entry] = await tx
        .select({ attributes: catalogEntries.attributes })
        .from(catalogEntries)
        .where(and(eq(catalogEntries.tenantId, tenantId), eq(catalogEntries.id, t.teamEntryId)));
      const list = entry?.attributes?.members;
      if (Array.isArray(list)) for (const m of list) if (typeof m === "string") ids.add(m);
    }
    if (t.kind === "schedule") {
      const [sched] = await tx
        .select()
        .from(schedules)
        .where(and(eq(schedules.tenantId, tenantId), eq(schedules.id, t.scheduleId)));
      if (!sched || sched.status !== "published") continue;
      const rots = await tx.select().from(rotations).where(eq(rotations.scheduleId, sched.id));
      const ovs = await tx
        .select()
        .from(scheduleOverrides)
        .where(eq(scheduleOverrides.scheduleId, sched.id));
      if (t.mode === "everyone") {
        for (const r of rots) for (const m of r.memberIds) ids.add(m);
      } else if (t.mode === "next") {
        for (const r of rots) {
          const m = nextOnCall(sched, r, ovs, now);
          if (m) ids.add(m);
        }
      } else {
        for (const s of onCallAt(sched, rots, ovs, now)) if (s.memberId) ids.add(s.memberId);
      }
    }
  }
  if (ids.size === 0) return [];
  const rows = await tx
    .select({ id: members.id, name: members.name, email: members.email, status: members.status })
    .from(members)
    .where(and(eq(members.tenantId, tenantId), inArray(members.id, [...ids])));
  return rows
    .filter((r) => r.status === "active")
    .map(({ id, name, email }) => ({ id, name, email }));
}

/** "Who will be paged": the levels of a graph, walked from the start with conditions evaluated now. */
export async function previewGraph(
  tx: Tx,
  tenantId: string,
  graph: EscalationGraph,
  ctx: { now: Date; urgency: "high" | "low"; priorityRank: number | null },
): Promise<
  Array<{
    nodeId: string;
    level: number;
    offsetMinutes: number;
    members: ResolvedMember[];
    urgency: "high" | "low";
    ackTimeoutMinutes: number;
    retries: number;
    everyoneMustAck: boolean;
  }>
> {
  const out: Array<{
    nodeId: string;
    level: number;
    offsetMinutes: number;
    members: ResolvedMember[];
    urgency: "high" | "low";
    ackTimeoutMinutes: number;
    retries: number;
    everyoneMustAck: boolean;
  }> = [];
  let nodeId = graph.start;
  let offset = 0;
  let level = 0;
  const seen = new Set<string>();
  while (nodeId && !seen.has(nodeId) && out.length < 12) {
    seen.add(nodeId);
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) break;
    if (node.kind === "level") {
      level += 1;
      out.push({
        nodeId: node.id,
        level,
        offsetMinutes: offset,
        members: await resolveTargets(
          tx,
          tenantId,
          node.targets,
          new Date(ctx.now.getTime() + offset * MIN),
        ),
        urgency: node.urgency,
        ackTimeoutMinutes: node.ackTimeoutMinutes,
        retries: node.retries,
        everyoneMustAck: Boolean(node.everyoneMustAck),
      });
      offset += node.ackTimeoutMinutes;
      nodeId = node.next;
    } else if (node.kind === "condition") {
      nodeId = (await evaluateCondition(tx, tenantId, node, {
        now: new Date(ctx.now.getTime() + offset * MIN),
        urgency: ctx.urgency,
        priorityRank: ctx.priorityRank,
      }))
        ? node.whenTrue
        : node.whenFalse;
    } else if (node.kind === "delay") {
      offset += node.minutes ?? 0;
      nodeId = node.next;
    } else if (node.kind === "retry") {
      nodeId = node.next;
    } else {
      break;
    }
  }
  return out;
}

async function evaluateCondition(
  tx: Tx,
  tenantId: string,
  node: Extract<EscalationNode, { kind: "condition" }>,
  ctx: { now: Date; urgency: "high" | "low"; priorityRank: number | null },
): Promise<boolean> {
  if (node.test.type === "working_hours") {
    const [set] = await tx
      .select()
      .from(workingHoursSets)
      .where(
        and(eq(workingHoursSets.tenantId, tenantId), eq(workingHoursSets.id, node.test.setId)),
      );
    return set ? inWorkingHours(ctx.now, set) : false;
  }
  if (node.test.type === "priority")
    return ctx.priorityRank !== null && ctx.priorityRank <= node.test.maxRank;
  return ctx.urgency === node.test.urgency;
}

/* ---------- Lifecycle ---------- */

export type StartInput = {
  pathId: string;
  alertId?: string | null;
  incidentId?: string | null;
  urgency?: "high" | "low";
  priorityRank?: number | null;
  triggeredBy: {
    kind: "member" | "system" | "api";
    memberId?: string | null;
    name?: string | null;
  };
  isTest?: boolean;
  /** Wait before the first page — the route's deferral. */
  deferMinutes?: number;
  now?: Date;
};

/** Starts an escalation on the path's published version. Returns null when the path has no published version. */
export async function startEscalation(
  tenantId: string,
  input: StartInput,
): Promise<{ id: string } | null> {
  const now = input.now ?? new Date();
  const created = await withTenant(tenantId, async (tx) => {
    const [path] = await tx
      .select()
      .from(escalationPaths)
      .where(and(eq(escalationPaths.tenantId, tenantId), eq(escalationPaths.id, input.pathId)));
    if (!path?.currentVersionId) return null;
    const [version] = await tx
      .select({ id: escalationPathVersions.id, version: escalationPathVersions.version })
      .from(escalationPathVersions)
      .where(eq(escalationPathVersions.id, path.currentVersionId));
    if (!version) return null;
    const defer = Math.max(0, input.deferMinutes ?? 0);
    const [row] = await tx
      .insert(escalations)
      .values({
        tenantId,
        pathId: path.id,
        pathVersionId: version.id,
        alertId: input.alertId ?? null,
        incidentId: input.incidentId ?? null,
        status: "pending",
        urgency: input.urgency ?? "high",
        priorityRank: input.priorityRank ?? null,
        currentNodeId: null,
        nextTickAt: new Date(now.getTime() + defer * MIN),
        startedAt: now,
        triggeredByKind: input.triggeredBy.kind,
        triggeredByMemberId: input.triggeredBy.memberId ?? null,
        triggeredByName: input.triggeredBy.name ?? null,
        isTest: Boolean(input.isTest),
        rowVersion: 0,
      })
      .returning({ id: escalations.id });
    await tx.insert(escalationEvents).values({
      tenantId,
      escalationId: row!.id,
      kind: "started",
      payload: {
        path: path.name,
        version: version.version,
        deferMinutes: defer,
        by: input.triggeredBy.name ?? input.triggeredBy.kind,
      },
      occurredAt: now,
    });
    if (defer > 0)
      await tx.insert(escalationEvents).values({
        tenantId,
        escalationId: row!.id,
        kind: "delayed",
        payload: { minutes: defer, reason: "route_defer" },
        occurredAt: now,
      });
    if (input.alertId)
      await tx.update(alerts).set({ escalationId: row!.id }).where(eq(alerts.id, input.alertId));
    return { id: row!.id, path: path.name, defer };
  });
  if (!created) return null;
  if (created.defer > 0) {
    const queued = await scheduleTick(
      tenantId,
      created.id,
      0,
      new Date(now.getTime() + created.defer * MIN),
    );
    if (!queued) {
      /* the worker's sweep will pick it up at next_tick_at */
    }
  } else {
    await advanceEscalation(tenantId, created.id, now);
  }
  return { id: created.id };
}

type EscRow = typeof escalations.$inferSelect;

async function loadGraph(tx: Tx, esc: EscRow): Promise<EscalationGraph | null> {
  const [v] = await tx
    .select({ graph: escalationPathVersions.graph })
    .from(escalationPathVersions)
    .where(eq(escalationPathVersions.id, esc.pathVersionId));
  return v?.graph ?? null;
}

/** The label under which an escalation's messages travel. */
async function describe(
  tx: Tx,
  tenantId: string,
  esc: EscRow,
): Promise<{ subject: string; text: string; url: string }> {
  const origin = await originOf(tenantId);
  if (esc.alertId) {
    const [a] = await tx
      .select({ title: alerts.title, attrs: alerts.attributes, incidentId: alerts.incidentId })
      .from(alerts)
      .where(eq(alerts.id, esc.alertId));
    if (a) {
      const pr = a.attrs.priority ? `${a.attrs.priority} · ` : "";
      return {
        subject: `${esc.isTest ? "[TEST] " : ""}${pr}${a.title}`,
        text:
          [a.attrs.service ? `Service ${a.attrs.service}` : null, a.attrs.environment ?? null]
            .filter(Boolean)
            .join(" · ") || "Alert firing",
        url: `${origin}/app/alerts/${esc.alertId}`,
      };
    }
  }
  if (esc.incidentId) {
    const [i] = await tx
      .select({ number: incidents.number, name: incidents.name })
      .from(incidents)
      .where(eq(incidents.id, esc.incidentId));
    if (i)
      return {
        subject: `${esc.isTest ? "[TEST] " : ""}INC-${i.number} · ${i.name}`,
        text: "You are being escalated to this incident.",
        url: `${origin}/app/incidents/${i.number}`,
      };
  }
  return {
    subject: esc.isTest ? "[TEST] Escalation" : "Escalation",
    text: "",
    url: `${origin}/app/on-call`,
  };
}

async function originOf(tenantId: string): Promise<string> {
  const { getTenantById } = await import("@openincident/db");
  const t = await getTenantById(tenantId);
  return t ? tenantOrigin(t.slug, t.customDomain) : "";
}

/**
 * THE transition. Reads the row, acts once, writes the next state. Safe to call
 * from a tick, from the sweep or right after creation; a stale caller loses the
 * optimistic lock and returns quietly.
 */
export async function advanceEscalation(
  tenantId: string,
  escalationId: string,
  now = new Date(),
): Promise<void> {
  // Loop: several instant nodes (condition → level) resolve in one call; each iteration is one committed transition.
  for (let guard = 0; guard < 10; guard++) {
    const outcome = await withTenant(tenantId, async (tx) => step(tx, tenantId, escalationId, now));
    if (outcome.tick)
      await scheduleTick(tenantId, escalationId, outcome.tick.rowVersion, outcome.tick.at);
    if (outcome.reassign) await startEscalation(tenantId, { ...outcome.reassign, now });
    if (!outcome.again) return;
  }
}

type StepOutcome = {
  again: boolean;
  tick?: { at: Date; rowVersion: number };
  reassign?: StartInput;
};

async function step(
  tx: Tx,
  tenantId: string,
  escalationId: string,
  now: Date,
): Promise<StepOutcome> {
  const [esc] = await tx
    .select()
    .from(escalations)
    .where(and(eq(escalations.tenantId, tenantId), eq(escalations.id, escalationId)));
  if (!esc || esc.status !== "pending") return { again: false };
  if (esc.nextTickAt && esc.nextTickAt.getTime() > now.getTime() + 1000) {
    // Woken early (sweep, duplicate tick): make sure a tick exists for the real time.
    return { again: false, tick: { at: esc.nextTickAt, rowVersion: esc.rowVersion } };
  }
  const graph = await loadGraph(tx, esc);
  if (!graph) return finish(tx, tenantId, esc, "exhausted", now, { reason: "no_graph" });

  const events: Array<{
    kind: (typeof escalationEvents.$inferInsert)["kind"];
    payload: Record<string, unknown>;
  }> = [];
  let nodeId: string | null = esc.currentNodeId;
  let patch: Partial<typeof escalations.$inferInsert> = {};
  let outcome: StepOutcome = { again: false };

  if (!nodeId) {
    nodeId = graph.start;
  } else {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node)
      return finish(tx, tenantId, esc, "exhausted", now, { reason: "node_missing", nodeId });
    if (node.kind === "level") {
      const entered = esc.nodeEnteredAt ?? now;
      const timeoutAt = entered.getTime() + node.ackTimeoutMinutes * MIN;
      if (now.getTime() + 1000 >= timeoutAt) {
        events.push({
          kind: "timeout",
          payload: { nodeId: node.id, afterMinutes: node.ackTimeoutMinutes },
        });
        nodeId = node.next; // fall through to enter the next node
      } else {
        // A retry is due: page the same targets again.
        const attempt = esc.attempt + 1;
        const targets = await pageLevel(tx, tenantId, esc, node, now, attempt);
        events.push({
          kind: "retried",
          payload: { nodeId: node.id, attempt, members: targets.map((m) => m.name) },
        });
        const next = nextLevelTick(entered, node, attempt);
        await commit(tx, esc, { attempt, nextTickAt: next }, events, now);
        return { again: false, tick: { at: next, rowVersion: esc.rowVersion + 1 } };
      }
    } else if (node.kind === "delay") {
      nodeId = node.next;
    } else if (node.kind === "retry") {
      nodeId = node.toNodeId;
    } else {
      nodeId = null;
    }
  }

  // Enter nodes until one that waits.
  const visited = new Set<string>();
  while (nodeId) {
    if (visited.has(nodeId))
      return finish(tx, tenantId, esc, "exhausted", now, { reason: "loop", nodeId });
    visited.add(nodeId);
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node)
      return finish(tx, tenantId, esc, "exhausted", now, { reason: "node_missing", nodeId });
    if (node.kind === "level") {
      const targets = await pageLevel(tx, tenantId, esc, node, now, 1);
      events.push({
        kind: "notified",
        payload: {
          nodeId: node.id,
          attempt: 1,
          urgency: node.urgency,
          members: targets.map((m) => m.name),
          ackTimeoutMinutes: node.ackTimeoutMinutes,
        },
      });
      const next = nextLevelTick(now, node, 1);
      patch = {
        currentNodeId: node.id,
        nodeEnteredAt: now,
        attempt: 1,
        nextTickAt: next,
        urgency: node.urgency,
      };
      outcome = { again: false, tick: { at: next, rowVersion: esc.rowVersion + 1 } };
      break;
    }
    if (node.kind === "condition") {
      const result = await evaluateCondition(tx, tenantId, node, {
        now,
        urgency: esc.urgency,
        priorityRank: esc.priorityRank,
      });
      events.push({ kind: "condition", payload: { nodeId: node.id, test: node.test, result } });
      nodeId = result ? node.whenTrue : node.whenFalse;
      continue;
    }
    if (node.kind === "delay") {
      let until = new Date(now.getTime() + (node.minutes ?? 0) * MIN);
      if (node.untilWorkingHoursSetId) {
        const [set] = await tx
          .select()
          .from(workingHoursSets)
          .where(eq(workingHoursSets.id, node.untilWorkingHoursSetId));
        if (set) until = nextWorkingHoursStart(now, set);
      }
      events.push({ kind: "delayed", payload: { nodeId: node.id, until: until.toISOString() } });
      patch = { currentNodeId: node.id, nodeEnteredAt: now, nextTickAt: until };
      outcome = { again: false, tick: { at: until, rowVersion: esc.rowVersion + 1 } };
      break;
    }
    if (node.kind === "retry") {
      const loops = esc.retryLoops[node.id] ?? 0;
      if (loops >= node.maxLoops) {
        nodeId = node.next;
        continue;
      }
      const until = new Date(now.getTime() + Math.max(1, node.intervalMinutes) * MIN);
      events.push({
        kind: "retried",
        payload: {
          nodeId: node.id,
          loop: loops + 1,
          toNodeId: node.toNodeId,
          until: until.toISOString(),
        },
      });
      patch = {
        currentNodeId: node.id,
        nodeEnteredAt: now,
        nextTickAt: until,
        retryLoops: { ...esc.retryLoops, [node.id]: loops + 1 },
      };
      outcome = { again: false, tick: { at: until, rowVersion: esc.rowVersion + 1 } };
      break;
    }
    if (node.kind === "reassign") {
      events.push({ kind: "reassigned", payload: { nodeId: node.id, toPathId: node.pathId } });
      await commit(tx, esc, { status: "cancelled", endedAt: now, nextTickAt: null }, events, now);
      return {
        again: false,
        reassign: {
          pathId: node.pathId,
          alertId: esc.alertId,
          incidentId: esc.incidentId,
          urgency: esc.urgency,
          priorityRank: esc.priorityRank,
          triggeredBy: { kind: "system", name: "reassign" },
          isTest: esc.isTest,
        },
      };
    }
  }
  if (!nodeId) {
    await commit(tx, esc, {}, events, now);
    return finish(tx, tenantId, { ...esc, rowVersion: esc.rowVersion + 1 }, "exhausted", now, {
      reason: "end_of_path",
    });
  }
  await commit(tx, esc, patch, events, now);
  return outcome;
}

/** The next instant something happens on a level: the next retry, or the timeout. */
function nextLevelTick(
  entered: Date,
  node: Extract<EscalationNode, { kind: "level" }>,
  attempt: number,
): Date {
  const timeoutAt = entered.getTime() + node.ackTimeoutMinutes * MIN;
  if (attempt <= node.retries) {
    const retryAt = entered.getTime() + attempt * Math.max(1, node.retryIntervalMinutes) * MIN;
    if (retryAt < timeoutAt) return new Date(retryAt);
  }
  return new Date(timeoutAt);
}

async function pageLevel(
  tx: Tx,
  tenantId: string,
  esc: EscRow,
  node: Extract<EscalationNode, { kind: "level" }>,
  now: Date,
  attempt: number,
): Promise<ResolvedMember[]> {
  let targets = await resolveTargets(tx, tenantId, node.targets, now);
  if (node.roundRobin && targets.length > 1) targets = [targets[(attempt - 1) % targets.length]!];
  const what = await describe(tx, tenantId, esc);
  for (const m of targets) {
    if (esc.ackedMemberIds.includes(m.id)) continue;
    await notifyMember(tx, tenantId, m, {
      kind: "escalation",
      urgency: node.urgency,
      subject: what.subject,
      text: `${what.text}${attempt > 1 ? ` (reminder ${attempt})` : ""}`,
      url: what.url,
      escalationId: esc.id,
      alertId: esc.alertId,
      ackable: true,
      origin: what.url.replace(/\/app\/.*$/, ""),
      now,
    });
  }
  if (esc.incidentId && attempt === 1) {
    await tx.insert(incidentEvents).values({
      tenantId,
      incidentId: esc.incidentId,
      kind: "escalation_triggered",
      actorKind: esc.triggeredByKind,
      actorMemberId: esc.triggeredByMemberId,
      actorName: esc.triggeredByName,
      payload: {
        escalationId: esc.id,
        nodeId: node.id,
        urgency: node.urgency,
        members: targets.map((m) => m.name),
        path: await pathName(tx, esc.pathId),
      },
      occurredAt: now,
    });
  }
  if (esc.alertId && attempt === 1) {
    await tx.insert(alertEvents).values({
      tenantId,
      alertId: esc.alertId,
      kind: "escalated",
      actorKind: "system",
      payload: {
        escalationId: esc.id,
        nodeId: node.id,
        urgency: node.urgency,
        members: targets.map((m) => m.name),
      },
      occurredAt: now,
    });
  }
  return targets;
}

async function pathName(tx: Tx, pathId: string): Promise<string | null> {
  const [p] = await tx
    .select({ name: escalationPaths.name })
    .from(escalationPaths)
    .where(eq(escalationPaths.id, pathId));
  return p?.name ?? null;
}

/** Writes the transition under the optimistic lock; a lost race throws and the caller retries later. */
async function commit(
  tx: Tx,
  esc: EscRow,
  patch: Partial<typeof escalations.$inferInsert>,
  events: Array<{
    kind: (typeof escalationEvents.$inferInsert)["kind"];
    payload: Record<string, unknown>;
  }>,
  now: Date,
): Promise<void> {
  const updated = await tx
    .update(escalations)
    .set({ ...patch, rowVersion: esc.rowVersion + 1 })
    .where(and(eq(escalations.id, esc.id), eq(escalations.rowVersion, esc.rowVersion)))
    .returning({ id: escalations.id });
  if (updated.length === 0) throw new Error("escalation moved under us");
  if (events.length)
    await tx.insert(escalationEvents).values(
      events.map((e) => ({
        tenantId: esc.tenantId,
        escalationId: esc.id,
        kind: e.kind,
        payload: e.payload,
        occurredAt: now,
      })),
    );
}

async function finish(
  tx: Tx,
  tenantId: string,
  esc: EscRow,
  status: "exhausted" | "cancelled" | "resolved",
  now: Date,
  payload: Record<string, unknown>,
): Promise<StepOutcome> {
  await commit(
    tx,
    esc,
    { status, endedAt: now, nextTickAt: null },
    [{ kind: status, payload }],
    now,
  );
  if (esc.incidentId && status === "exhausted") {
    await tx.insert(incidentEvents).values({
      tenantId,
      incidentId: esc.incidentId,
      kind: "note",
      actorKind: "system",
      payload: { system: "escalation_exhausted", escalationId: esc.id },
      occurredAt: now,
    });
  }
  return { again: false };
}

/* ---------- Acknowledgement ---------- */

/**
 * Acknowledges: stops the timers, logs who and how, adds the responder to the
 * incident when there is one. Returns false when nothing was pending.
 */
export async function acknowledgeEscalation(
  tenantId: string,
  escalationId: string,
  actor: { memberId: string; name: string },
  channel: string,
  now = new Date(),
): Promise<{
  ok: boolean;
  incidentNumber: number | null;
  alertId: string | null;
  complete: boolean;
}> {
  return withTenant(tenantId, async (tx) => {
    const [esc] = await tx
      .select()
      .from(escalations)
      .where(and(eq(escalations.tenantId, tenantId), eq(escalations.id, escalationId)));
    if (!esc || esc.status !== "pending")
      return { ok: false, incidentNumber: null, alertId: esc?.alertId ?? null, complete: false };
    const graph = await loadGraph(tx, esc);
    const node = graph?.nodes.find((n) => n.id === esc.currentNodeId);
    const acked = esc.ackedMemberIds.includes(actor.memberId)
      ? esc.ackedMemberIds
      : [...esc.ackedMemberIds, actor.memberId];
    let complete = true;
    if (node?.kind === "level" && node.everyoneMustAck) {
      const targets = await resolveTargets(tx, tenantId, node.targets, now);
      complete = targets.every((t) => acked.includes(t.id));
    }
    await commit(
      tx,
      esc,
      complete
        ? {
            status: "acked",
            ackedByMemberId: actor.memberId,
            ackedAt: now,
            ackedChannel: channel,
            ackedMemberIds: acked,
            endedAt: now,
            nextTickAt: null,
          }
        : { ackedMemberIds: acked },
      [
        {
          kind: "acknowledged",
          payload: { by: actor.name, memberId: actor.memberId, channel, complete },
        },
      ],
      now,
    );
    let incidentNumber: number | null = null;
    if (esc.alertId) {
      await tx
        .update(alerts)
        .set({ ackedAt: now, ackedByMemberId: actor.memberId })
        .where(eq(alerts.id, esc.alertId));
      await tx.insert(alertEvents).values({
        tenantId,
        alertId: esc.alertId,
        kind: "acknowledged",
        actorKind: "member",
        actorMemberId: actor.memberId,
        actorName: actor.name,
        payload: { channel, complete },
        occurredAt: now,
      });
      const [a] = await tx
        .select({ incidentId: alerts.incidentId })
        .from(alerts)
        .where(eq(alerts.id, esc.alertId));
      if (a?.incidentId && !esc.incidentId)
        incidentNumber = await joinIncident(
          tx,
          tenantId,
          a.incidentId,
          actor,
          channel,
          now,
          esc.id,
        );
    }
    if (esc.incidentId)
      incidentNumber = await joinIncident(
        tx,
        tenantId,
        esc.incidentId,
        actor,
        channel,
        now,
        esc.id,
      );
    return { ok: true, incidentNumber, alertId: esc.alertId, complete };
  });
}

async function joinIncident(
  tx: Tx,
  tenantId: string,
  incidentId: string,
  actor: { memberId: string; name: string },
  channel: string,
  now: Date,
  escalationId: string,
): Promise<number | null> {
  const [inc] = await tx
    .select({ number: incidents.number, acknowledgedAt: incidents.acknowledgedAt })
    .from(incidents)
    .where(eq(incidents.id, incidentId));
  if (!inc) return null;
  await tx.insert(incidentEvents).values({
    tenantId,
    incidentId,
    kind: "escalation_acknowledged",
    actorKind: "member",
    actorMemberId: actor.memberId,
    actorName: actor.name,
    payload: { channel, escalationId },
    occurredAt: now,
  });
  await tx
    .insert(incidentParticipants)
    .values({
      tenantId,
      incidentId,
      memberId: actor.memberId,
      kind: "participant",
      firstActivityAt: now,
      lastActivityAt: now,
    })
    .onConflictDoUpdate({
      target: [incidentParticipants.incidentId, incidentParticipants.memberId],
      set: { lastActivityAt: now },
    });
  await tx
    .update(incidents)
    .set({ acknowledgedAt: inc.acknowledgedAt ?? now, lastActivityAt: now })
    .where(eq(incidents.id, incidentId));
  return inc.number;
}

/** Puts an acknowledged escalation back on its level: timers restart from now. */
export async function unacknowledgeEscalation(
  tenantId: string,
  escalationId: string,
  actor: { memberId: string; name: string },
  now = new Date(),
): Promise<boolean> {
  const ok = await withTenant(tenantId, async (tx) => {
    const [esc] = await tx
      .select()
      .from(escalations)
      .where(and(eq(escalations.tenantId, tenantId), eq(escalations.id, escalationId)));
    if (!esc || esc.status !== "acked") return false;
    const graph = await loadGraph(tx, esc);
    const node = graph?.nodes.find((n) => n.id === esc.currentNodeId);
    const timeout = node?.kind === "level" ? node.ackTimeoutMinutes : 5;
    await commit(
      tx,
      esc,
      {
        status: "pending",
        ackedByMemberId: null,
        ackedAt: null,
        ackedChannel: null,
        ackedMemberIds: [],
        endedAt: null,
        nodeEnteredAt: now,
        attempt: 1,
        nextTickAt: new Date(now.getTime() + timeout * MIN),
      },
      [{ kind: "unacknowledged", payload: { by: actor.name, memberId: actor.memberId } }],
      now,
    );
    if (esc.alertId) {
      await tx
        .update(alerts)
        .set({ ackedAt: null, ackedByMemberId: null })
        .where(eq(alerts.id, esc.alertId));
      await tx.insert(alertEvents).values({
        tenantId,
        alertId: esc.alertId,
        kind: "unacknowledged",
        actorKind: "member",
        actorMemberId: actor.memberId,
        actorName: actor.name,
        payload: {},
        occurredAt: now,
      });
    }
    return true;
  });
  if (ok) {
    const [esc] = await withTenant(tenantId, (tx) =>
      tx
        .select({ rowVersion: escalations.rowVersion, nextTickAt: escalations.nextTickAt })
        .from(escalations)
        .where(eq(escalations.id, escalationId)),
    );
    if (esc?.nextTickAt) await scheduleTick(tenantId, escalationId, esc.rowVersion, esc.nextTickAt);
  }
  return ok;
}

/** Ends a pending escalation for an external reason (alert resolved at the source, incident closed). */
export async function cancelEscalation(
  tenantId: string,
  escalationId: string,
  reason: string,
  now = new Date(),
): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const [esc] = await tx
      .select()
      .from(escalations)
      .where(and(eq(escalations.tenantId, tenantId), eq(escalations.id, escalationId)));
    if (!esc || esc.status !== "pending") return false;
    await commit(
      tx,
      esc,
      {
        status: reason === "alert_resolved" ? "resolved" : "cancelled",
        endedAt: now,
        nextTickAt: null,
      },
      [{ kind: reason === "alert_resolved" ? "resolved" : "cancelled", payload: { reason } }],
      now,
    );
    return true;
  });
}

/* ---------- Reconciliation ---------- */

/** The worker's sweep: every pending escalation whose tick is due, across live tenants. */
export async function sweepEscalations(tenantIds: string[], now = new Date()): Promise<number> {
  let advanced = 0;
  for (const tenantId of tenantIds) {
    const due = await withTenant(tenantId, (tx) =>
      tx
        .select({ id: escalations.id })
        .from(escalations)
        .where(
          and(
            eq(escalations.tenantId, tenantId),
            eq(escalations.status, "pending"),
            lte(escalations.nextTickAt, new Date(now.getTime() - 5_000)),
          ),
        )
        .limit(200),
    );
    for (const e of due) {
      try {
        await advanceEscalation(tenantId, e.id, now);
        advanced++;
      } catch (err) {
        console.error(`[escalation] ${e.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return advanced;
}

/** Dynamic resolution: service → owner team → the team's escalation path (by name). */
export async function resolveDynamicPath(
  tx: Tx,
  tenantId: string,
  serviceName: string | null | undefined,
): Promise<{ pathId: string; via: string } | null> {
  if (!serviceName) return null;
  const [svcType] = await tx
    .select({ id: catalogTypes.id })
    .from(catalogTypes)
    .where(and(eq(catalogTypes.tenantId, tenantId), eq(catalogTypes.key, "service")));
  if (!svcType) return null;
  const [service] = await tx
    .select()
    .from(catalogEntries)
    .where(
      and(
        eq(catalogEntries.typeId, svcType.id),
        sql`lower(${catalogEntries.name}) = lower(${serviceName})`,
      ),
    );
  const ownerId = service?.attributes?.owner;
  if (typeof ownerId !== "string") return null;
  const [team] = await tx.select().from(catalogEntries).where(eq(catalogEntries.id, ownerId));
  const pathName = team?.attributes?.escalation_path;
  if (typeof pathName !== "string") return null;
  const [path] = await tx
    .select({ id: escalationPaths.id })
    .from(escalationPaths)
    .where(and(eq(escalationPaths.tenantId, tenantId), eq(escalationPaths.name, pathName)));
  return path ? { pathId: path.id, via: `${service!.name} → ${team!.name} → ${pathName}` } : null;
}

/* ---------- Shift reminders ---------- */

/**
 * "1 h before my shift" / "at the end of my shift": one notification per
 * member and handover, found by comparing who is on call now with who is on
 * call in an hour. Idempotent through the delivery log.
 */
export async function sweepShiftReminders(tenantIds: string[], now = new Date()): Promise<number> {
  const { notificationDeliveries } = await import("@openincident/db");
  const { desc } = await import("drizzle-orm");
  let sent = 0;
  for (const tenantId of tenantIds) {
    const origin = await originOf(tenantId);
    sent += await withTenant(tenantId, async (tx) => {
      let n = 0;
      const scheds = await tx
        .select()
        .from(schedules)
        .where(and(eq(schedules.tenantId, tenantId), eq(schedules.status, "published")));
      for (const sched of scheds) {
        const rots = await tx.select().from(rotations).where(eq(rotations.scheduleId, sched.id));
        const ovs = await tx
          .select()
          .from(scheduleOverrides)
          .where(eq(scheduleOverrides.scheduleId, sched.id));
        const current = onCallAt(sched, rots, ovs, now);
        const inAnHour = onCallAt(sched, rots, ovs, new Date(now.getTime() + 60 * MIN));
        const changes: Array<{
          memberId: string;
          kind: "start" | "end";
          rotation: string;
          at: Date;
        }> = [];
        for (const next of inAnHour) {
          const cur = current.find((c) => c.rotationId === next.rotationId);
          if (next.memberId && next.memberId !== cur?.memberId)
            changes.push({
              memberId: next.memberId,
              kind: "start",
              rotation: next.rotationName,
              at: cur?.until ?? now,
            });
        }
        for (const cur of current) {
          const next = inAnHour.find((c) => c.rotationId === cur.rotationId);
          if (
            cur.memberId &&
            cur.memberId !== next?.memberId &&
            cur.until.getTime() - now.getTime() <= 15 * MIN
          )
            changes.push({
              memberId: cur.memberId,
              kind: "end",
              rotation: cur.rotationName,
              at: cur.until,
            });
        }
        for (const c of changes) {
          const [m] = await tx
            .select({
              id: members.id,
              name: members.name,
              email: members.email,
              shiftReminders: members.shiftReminders,
              status: members.status,
            })
            .from(members)
            .where(eq(members.id, c.memberId));
          if (!m || m.status !== "active") continue;
          if (c.kind === "start" && !m.shiftReminders.beforeStart) continue;
          if (c.kind === "end" && !m.shiftReminders.atEnd) continue;
          const subject =
            c.kind === "start"
              ? `On-call in 1 h · ${sched.name}`
              : `Your shift ends soon · ${sched.name}`;
          const [dup] = await tx
            .select({ id: notificationDeliveries.id, createdAt: notificationDeliveries.createdAt })
            .from(notificationDeliveries)
            .where(
              and(
                eq(notificationDeliveries.memberId, m.id),
                eq(notificationDeliveries.kind, "shift_reminder"),
              ),
            )
            .orderBy(desc(notificationDeliveries.createdAt))
            .limit(1);
          if (dup && now.getTime() - dup.createdAt.getTime() < 6 * 60 * MIN) continue;
          await notifyMember(tx, tenantId, m, {
            kind: "shift_reminder",
            urgency: "low",
            subject,
            text: `${c.rotation} — ${c.kind === "start" ? "you take over at" : "hand over at"} ${c.at.toISOString()}`,
            url: `${origin}/app/on-call`,
            origin,
            now,
          });
          n++;
        }
      }
      return n;
    });
  }
  return sent;
}
