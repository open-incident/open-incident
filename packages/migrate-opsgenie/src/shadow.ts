/**
 * Step 5: shadow mode. Opsgenie forwards every alert to a webhook here; for
 * each one this works out who Opsgenie paged and who Open Incident WOULD have
 * paged — through the imported rules, policies and schedules, inactive as
 * they are — and records both. Nothing here pages anybody: no escalation is
 * started, no notification is written.
 *
 * The Opsgenie side replays the team's routing rule, then asks Opsgenie who
 * its schedule had on call at that instant (so an override made since the
 * inventory counts). The Open Incident side runs the product's own matcher
 * over the imported rules, walks the policy's first level (conditions
 * included) and reads the imported schedules with the product's rotation
 * arithmetic.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  alertRoutes,
  alertSources,
  members,
  migrationRuns,
  shadowDecisions,
  teamMembers,
  workingHoursSets,
  type EscalationGraph,
  type EscalationTarget,
  type Tx,
} from "@openincident/db";
import { conditionsHold, inWorkingHours, nextOnCall, onCallAt } from "@openincident/oncall";
import type { OpsgenieClient } from "./client";
import { escalationLevels, isNobody, type PeopleIndex, type ScheduleShape } from "./convert";
import { graphOf, importedShapes, linkOf } from "./import";
import { attributesOf, ogMatchRule, type AlertView } from "./og-routing";
import { itemsOf, loadSnapshot, peopleIndex, peopleOf, type ItemRow, type Run } from "./run";
import type { OgEscalation } from "./types";

export type OgSide = {
  users: string[];
  /** The same, from the inventory as read — differs when an override came since. */
  fromInventory: string[];
  ruleId: string | null;
  ruleName: string | null;
  scheduleIds: string[];
  /** Opsgenie could not be asked: the inventory answered alone. */
  offline: boolean;
};

/** Who Opsgenie paged first for this alert. */
export async function opsgenieSide(
  snap: Awaited<ReturnType<typeof loadSnapshot>>,
  alert: AlertView,
  client: OpsgenieClient | null,
): Promise<OgSide> {
  const out: OgSide = {
    users: [],
    fromInventory: [],
    ruleId: null,
    ruleName: null,
    scheduleIds: [],
    offline: !client,
  };
  const team = snap.teams.find((t) => alert.teams.includes(t.id));
  if (!team) return out;
  const rule = ogMatchRule(team.routingRules, alert);
  if (!rule) return out;
  out.ruleId = rule.id;
  out.ruleName = rule.name ?? null;
  const byUsername = new Map(snap.users.map((u) => [u.username.toLowerCase(), u.id]));
  // The levels Opsgenie walks: its rules grouped by delay.
  type Recipient = OgEscalation["rules"][number]["recipient"];
  const levels: Array<{ delay: number; recipients: Recipient[] }> = [];
  if (rule.notify.type === "schedule" && rule.notify.id)
    levels.push({ delay: 0, recipients: [{ type: "schedule", id: rule.notify.id }] });
  if (rule.notify.type === "escalation" && rule.notify.id) {
    const esc = snap.escalations.find((e) => e.id === rule.notify.id);
    if (esc)
      for (const l of escalationLevels(esc))
        levels.push({ delay: l.delay, recipients: l.rules.map((r) => r.recipient) });
  }
  // Blocked users are kept: the people map says who takes their slots here.
  const fromTimeline = (scheduleId: string, at: number) => {
    const s = snap.schedules.find((x) => x.id === scheduleId);
    const out = new Set<string>();
    for (const r of s?.timeline?.finalTimeline?.rotations ?? [])
      for (const p of r.periods ?? [])
        if (
          p.recipient?.type === "user" &&
          p.recipient.id &&
          new Date(p.startDate).getTime() <= at &&
          new Date(p.endDate).getTime() > at
        )
          out.add(p.recipient.id);
    return out;
  };
  let live: string[] | null = null;
  let inv: string[] | null = null;
  for (const level of levels) {
    const at = new Date(alert.createdAt.getTime() + level.delay * 60_000);
    const l = new Set<string>();
    const i = new Set<string>();
    for (const rec of level.recipients) {
      if (rec.type === "user") {
        l.add(rec.id);
        i.add(rec.id);
      } else if (rec.type === "team") {
        const t = snap.teams.find((x) => x.id === rec.id);
        for (const m of t?.members ?? []) {
          l.add(m.user.id);
          i.add(m.user.id);
        }
      } else if (rec.type === "schedule") {
        if (!out.scheduleIds.includes(rec.id)) out.scheduleIds.push(rec.id);
        fromTimeline(rec.id, at.getTime()).forEach((x) => i.add(x));
        if (client && !out.offline) {
          try {
            for (const username of await client.onCalls(rec.id, at)) {
              const id = byUsername.get(username.toLowerCase());
              if (id) l.add(id);
            }
          } catch {
            out.offline = true;
          }
        }
      }
    }
    if (inv === null && i.size) inv = [...i];
    if (live === null && l.size && !out.offline) live = [...l];
    if (inv !== null && (live !== null || out.offline)) break;
  }
  out.fromInventory = inv ?? [];
  out.users = out.offline ? out.fromInventory : (live ?? []);
  return out;
}

export type OiSide = {
  members: string[];
  routeId: string | null;
  routeName: string | null;
  pathId: string | null;
};

/** Who Open Incident would page first, through the imported (inactive) objects. */
export async function openIncidentSide(
  tx: Tx,
  tenantId: string,
  run: Run,
  items: ItemRow[],
  shapes: Map<string, ScheduleShape>,
  alert: AlertView,
): Promise<OiSide> {
  const out: OiSide = { members: [], routeId: null, routeName: null, pathId: null };
  const teamItem = items.find((i) => i.type === "team" && alert.teams.includes(i.externalId));
  if (!teamItem) return out;
  const team = teamItem.externalId;
  const attributes = attributesOf(alert, Boolean(run.confirmations?.p5));
  // The source the alert would come from once repointed: the team's integration of that name or type.
  const integration = items.find(
    (i) =>
      i.type === "integration" &&
      linkOf(i)?.team === team &&
      i.oiId &&
      (i.name === alert.source || (i.data as { type?: string }).type === alert.source),
  );
  let source: { id: string; kind: string; name: string } | null = null;
  if (integration?.oiId) {
    const [s] = await tx
      .select({
        id: alertSources.id,
        kind: alertSources.kind,
        name: alertSources.name,
        escalations: alertSources.escalations,
      })
      .from(alertSources)
      .where(eq(alertSources.id, integration.oiId));
    if (s) source = s;
  }
  const ctx = {
    attributes,
    source: source ?? { id: "", kind: "http", name: alert.source },
    priority: attributes.priority ?? null,
    title: alert.message,
  };
  const routeIds = items
    .filter(
      (i) =>
        i.type === "routing_rule" &&
        linkOf(i)?.team === team &&
        i.oiTable === "alert_routes" &&
        i.oiId,
    )
    .map((i) => i.oiId!);
  const routes = routeIds.length
    ? await tx
        .select()
        .from(alertRoutes)
        .where(inArray(alertRoutes.id, routeIds))
        .orderBy(asc(alertRoutes.position), asc(alertRoutes.createdAt))
    : [];
  const route = routes.find(
    (r) =>
      (!source || r.sourceIds.length === 0 || r.sourceIds.includes(source.id)) &&
      conditionsHold(r.conditions, ctx),
  );
  let pathId: string | null = null;
  if (route) {
    out.routeId = route.id;
    out.routeName = route.name;
    const first = route.escalations.find((e) => e.kind === "path");
    pathId = first && first.kind === "path" ? first.pathId : null;
  } else {
    pathId = linkOf(teamItem)?.defaultPathId ?? null;
  }
  out.pathId = pathId;
  if (!pathId) return out;
  const graph = await graphOf(tx, pathId);
  out.members = await firstPaged(tx, tenantId, graph, alert, shapes);
  return out;
}

/**
 * The first people the graph pages, conditions evaluated when the flow
 * reaches them: a level that resolves to nobody waits its timeout and hands
 * on, exactly as the engine does — so that level is skipped here too.
 */
async function firstPaged(
  tx: Tx,
  tenantId: string,
  graph: EscalationGraph | null,
  alert: AlertView,
  shapes: Map<string, ScheduleShape>,
): Promise<string[]> {
  let id = graph?.start ?? null;
  const seen = new Set<string>();
  let at = alert.createdAt;
  while (id && !seen.has(id)) {
    seen.add(id);
    const n = graph!.nodes.find((x) => x.id === id);
    if (!n) return [];
    if (n.kind === "level") {
      const paged = await resolve(tx, tenantId, n.targets, shapes, at);
      if (paged.length) return paged;
      at = new Date(at.getTime() + n.ackTimeoutMinutes * 60_000);
      id = n.next;
    } else if (n.kind === "delay") {
      at = new Date(at.getTime() + (n.minutes ?? 0) * 60_000);
      id = n.next;
    } else if (n.kind === "condition") {
      let holds = false;
      if (n.test.type === "working_hours") {
        const [set] = await tx
          .select()
          .from(workingHoursSets)
          .where(
            and(eq(workingHoursSets.tenantId, tenantId), eq(workingHoursSets.id, n.test.setId)),
          );
        holds = set ? inWorkingHours(at, set) : false;
      } else if (n.test.type === "priority") {
        const rank = Number(alert.priority.replace(/\D/g, "")) - 1;
        holds = rank <= n.test.maxRank;
      } else holds = n.test.urgency === "high";
      id = holds ? n.whenTrue : n.whenFalse;
    } else if (n.kind === "retry") id = n.next;
    else return [];
  }
  return [];
}

async function resolve(
  tx: Tx,
  tenantId: string,
  targets: EscalationTarget[],
  shapes: Map<string, ScheduleShape>,
  at: Date,
): Promise<string[]> {
  const ids = new Set<string>();
  for (const t of targets) {
    if (t.kind === "member") ids.add(t.memberId);
    else if (t.kind === "team") {
      const rows = await tx
        .select({ id: teamMembers.memberId })
        .from(teamMembers)
        .where(and(eq(teamMembers.tenantId, tenantId), eq(teamMembers.teamId, t.teamId)));
      rows.forEach((r) => ids.add(r.id));
    } else {
      // Imported schedules are drafts: read them as they will page once published.
      for (const shape of shapes.values())
        for (const part of shape.parts) {
          if (part.scheduleId !== t.scheduleId) continue;
          const sched = { timezone: part.timezone, handoverTime: part.handoverTime };
          if (t.mode === "everyone")
            part.rotations.forEach((r) => r.memberIds.forEach((m) => ids.add(m)));
          else if (t.mode === "next")
            part.rotations.forEach((r) => {
              const m = nextOnCall(sched, r, part.overrides, at);
              if (m) ids.add(m);
            });
          else
            onCallAt(sched, part.rotations, part.overrides, at).forEach(
              (s) => s.memberId && ids.add(s.memberId),
            );
        }
    }
  }
  const list = [...ids].filter((m) => !isNobody(m));
  if (!list.length) return [];
  const rows = await tx
    .select({ id: members.id, status: members.status })
    .from(members)
    .where(and(eq(members.tenantId, tenantId), inArray(members.id, list)));
  return rows.filter((r) => r.status === "active").map((r) => r.id);
}

/** Opsgenie users → members, the way the comparison counts them. */
function mapped(users: string[], people: PeopleIndex): string[] {
  return [
    ...new Set(
      users.map((u) => people.get(u)).filter((m): m is string => Boolean(m) && !isNobody(m)),
    ),
  ];
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export type Decision = {
  agrees: boolean;
  cause: "override" | "rule" | "policy" | null;
  og: OgSide;
  oi: OiSide;
};

/** Compares the two sides for one alert. */
export function compareSides(
  og: OgSide,
  oi: OiSide,
  people: PeopleIndex,
  ruleItems: ItemRow[],
): Decision {
  const ogMembers = mapped(og.users, people);
  const agrees = same(ogMembers, oi.members);
  if (agrees) return { agrees, cause: null, og, oi };
  if (!same(mapped(og.fromInventory, people), ogMembers))
    return { agrees, cause: "override", og, oi };
  const expected = og.ruleId ? ruleItems.find((r) => r.externalId === og.ruleId) : null;
  const expectedRoute = expected?.oiTable === "alert_routes" ? expected.oiId : null;
  if ((expectedRoute ?? null) !== (oi.routeId ?? null)) return { agrees, cause: "rule", og, oi };
  return { agrees, cause: "policy", og, oi };
}

/** Names for the people on both sides. */
async function names(
  tx: Tx,
  tenantId: string,
  og: string[],
  oi: string[],
  snap: Awaited<ReturnType<typeof loadSnapshot>>,
) {
  const users = new Map(snap.users.map((u) => [u.id, u.fullName]));
  const rows = oi.length
    ? await tx
        .select({ id: members.id, name: members.name })
        .from(members)
        .where(and(eq(members.tenantId, tenantId), inArray(members.id, oi)))
    : [];
  return {
    og: og.map((id) => ({ id, name: users.get(id) ?? id })),
    oi: rows.map((r) => ({ memberId: r.id, name: r.name })),
  };
}

/**
 * Records one forwarded alert. Network first (Opsgenie's on-call), then one
 * short transaction per write — the caller passes `withTenant`.
 */
export async function recordShadow(
  inTenant: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>,
  tenantId: string,
  runId: string,
  alert: AlertView,
  client: OpsgenieClient | null,
): Promise<Decision | null> {
  const ctx = await inTenant(async (tx) => {
    const [run] = await tx.select().from(migrationRuns).where(eq(migrationRuns.id, runId));
    if (!run) return null;
    const snap = await loadSnapshot(tx, run);
    return { run, snap };
  });
  if (!ctx) return null;
  const og = await opsgenieSide(ctx.snap, alert, client);
  return inTenant(async (tx) => {
    const items = await itemsOf(tx, runId);
    const people = peopleIndex(await peopleOf(tx, runId));
    const shapes = await importedShapes(tx, runId, people);
    const oi = await openIncidentSide(tx, tenantId, ctx.run, items, shapes, alert);
    const decision = compareSides(
      og,
      oi,
      people,
      items.filter((i) => i.type === "routing_rule"),
    );
    const n = await names(tx, tenantId, og.users, oi.members, ctx.snap);
    const team = ctx.snap.teams.find((t) => alert.teams.includes(t.id));
    await tx
      .insert(shadowDecisions)
      .values({
        tenantId,
        runId,
        alertExternalId: alert.id,
        alertTitle: `${alert.message} · ${alert.priority}`,
        teamExternalId: team?.id ?? alert.teams[0] ?? null,
        receivedAt: alert.createdAt,
        opsgeniePaged: n.og,
        oiWouldPage: n.oi,
        agrees: decision.agrees,
        cause: decision.cause,
        detail: {
          alert: { ...alert, createdAt: alert.createdAt.toISOString() },
          ogRule: og.ruleName,
          oiRoute: oi.routeName,
          oiRouteId: oi.routeId,
          pathId: oi.pathId,
          scheduleIds: og.scheduleIds,
          offline: og.offline,
        },
      })
      .onConflictDoNothing();
    return decision;
  });
}

/** Compares again the disagreements still open — after a rule or a policy was edited. */
export async function recheck(
  tx: Tx,
  tenantId: string,
  run: Run,
  only?: string[],
): Promise<number> {
  const open = await tx
    .select()
    .from(shadowDecisions)
    .where(and(eq(shadowDecisions.runId, run.id), eq(shadowDecisions.agrees, false)))
    .orderBy(desc(shadowDecisions.receivedAt));
  const todo = open.filter((d) => !d.resolution && (!only || only.includes(d.id)));
  if (!todo.length) return 0;
  const items = await itemsOf(tx, run.id);
  const people = peopleIndex(await peopleOf(tx, run.id));
  const shapes = await importedShapes(tx, run.id, people);
  let fixed = 0;
  for (const d of todo) {
    const raw = (d.detail as { alert?: AlertView & { createdAt: string } }).alert;
    if (!raw) continue;
    const alert: AlertView = { ...raw, createdAt: new Date(raw.createdAt) };
    const oi = await openIncidentSide(tx, tenantId, run, items, shapes, alert);
    const og = mapped(d.opsgeniePaged.map((x) => x.id ?? "").filter(Boolean), people);
    if (!same(og, oi.members)) continue;
    await tx
      .update(shadowDecisions)
      .set({ resolution: "fixed_here", resolvedAt: new Date() })
      .where(eq(shadowDecisions.id, d.id));
    fixed++;
  }
  return fixed;
}

/** Marks a disagreement settled by a person (Opsgenie's override read again, a rule edited). */
export async function resolveDecision(
  tx: Tx,
  runId: string,
  id: string,
  actor: string | null,
): Promise<void> {
  await tx
    .update(shadowDecisions)
    .set({ resolution: "fixed_here", resolvedAt: new Date(), resolvedByMemberId: actor })
    .where(and(eq(shadowDecisions.runId, runId), eq(shadowDecisions.id, id)));
}
