"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  escalationPathVersions,
  escalationPaths,
  withTenant,
  type EscalationGraph,
  type EscalationNode,
  type EscalationTarget,
} from "@openincident/db";
import { previewGraph } from "@openincident/oncall";
import { recordAudit } from "@/lib/audit";
import { requireManager, requireMember } from "@/lib/session";

const uuid = z.string().uuid();

async function loadPath(tenantId: string, id: string) {
  return withTenant(tenantId, async (tx) => {
    const [p] = await tx
      .select()
      .from(escalationPaths)
      .where(and(eq(escalationPaths.tenantId, tenantId), eq(escalationPaths.id, id)));
    if (!p) return null;
    const [v] = p.currentVersionId
      ? await tx
          .select()
          .from(escalationPathVersions)
          .where(eq(escalationPathVersions.id, p.currentVersionId))
      : [];
    return {
      path: p,
      graph: (p.draftGraph ?? v?.graph ?? { start: null, nodes: [] }) as EscalationGraph,
    };
  });
}

async function saveDraft(tenantId: string, pathId: string, graph: EscalationGraph) {
  await withTenant(tenantId, (tx) =>
    tx
      .update(escalationPaths)
      .set({ draftGraph: graph, updatedAt: new Date() })
      .where(and(eq(escalationPaths.tenantId, tenantId), eq(escalationPaths.id, pathId))),
  );
}

function parseTarget(formData: FormData): EscalationTarget | null {
  const raw = String(formData.get("target") ?? "");
  const [kind, id, mode] = raw.split(":");
  if (kind === "member" && id) return { kind: "member", memberId: id };
  if (kind === "team" && id) return { kind: "team", teamEntryId: id };
  if (kind === "schedule" && id)
    return {
      kind: "schedule",
      scheduleId: id,
      mode: mode === "next" || mode === "everyone" ? mode : "current",
    };
  return null;
}

const levelSchema = z.object({
  urgency: z.enum(["high", "low"]).default("high"),
  ackTimeoutMinutes: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .default(5),
  retries: z.coerce.number().int().min(0).max(10).default(0),
  retryIntervalMinutes: z.coerce.number().int().min(1).max(120).default(2),
});

/** Edits the selected node's properties on the draft graph. */
export async function updateNode(formData: FormData) {
  const current = await requireManager();
  const pathId = uuid.parse(formData.get("pathId"));
  const nodeId = z.string().min(1).parse(formData.get("nodeId"));
  const loaded = await loadPath(current.tenant.id, pathId);
  if (!loaded) return;
  const graph = loaded.graph;
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  if (node.kind === "level") {
    const lv = levelSchema.parse(Object.fromEntries(formData.entries()));
    const target = parseTarget(formData);
    Object.assign(node, {
      ...lv,
      targets: target ? [target] : node.targets,
      everyoneMustAck: formData.get("everyoneMustAck") === "on",
      roundRobin: formData.get("roundRobin") === "on",
    });
  } else if (node.kind === "delay") {
    const minutes = z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 60)
      .catch(15)
      .parse(formData.get("minutes"));
    const set = String(formData.get("untilWorkingHoursSetId") ?? "");
    node.minutes = set ? undefined : minutes;
    node.untilWorkingHoursSetId = set || undefined;
  } else if (node.kind === "retry") {
    node.maxLoops = z.coerce.number().int().min(1).max(10).catch(2).parse(formData.get("maxLoops"));
    node.intervalMinutes = z.coerce
      .number()
      .int()
      .min(1)
      .max(120)
      .catch(5)
      .parse(formData.get("intervalMinutes"));
  }
  await saveDraft(current.tenant.id, pathId, graph);
  revalidatePath("/app/on-call/paths");
  redirect(`/app/on-call/paths?path=${pathId}&node=${nodeId}`);
}

/** "+ Add a node": appended at the end of the main chain (the true branch of conditions). */
export async function addNode(formData: FormData) {
  const current = await requireManager();
  const pathId = uuid.parse(formData.get("pathId"));
  const kind = z
    .enum(["level", "condition", "delay", "retry", "reassign"])
    .parse(formData.get("kind"));
  const loaded = await loadPath(current.tenant.id, pathId);
  if (!loaded) return;
  const graph = loaded.graph;
  const id = `n_${Date.now().toString(36)}`;
  let node: EscalationNode;
  if (kind === "level") {
    const lv = levelSchema.parse(Object.fromEntries(formData.entries()));
    const target = parseTarget(formData) ?? { kind: "member", memberId: current.member.id };
    node = {
      id,
      kind: "level",
      targets: [target],
      ...lv,
      everyoneMustAck: formData.get("everyoneMustAck") === "on",
      next: null,
    };
  } else if (kind === "condition") {
    const test = String(formData.get("test") ?? "urgency:high");
    const [ty, val] = test.split(":");
    node = {
      id,
      kind: "condition",
      test:
        ty === "working_hours"
          ? { type: "working_hours", setId: val ?? "" }
          : ty === "priority"
            ? { type: "priority", maxRank: Number(val ?? 1) }
            : { type: "urgency", urgency: val === "low" ? "low" : "high" },
      whenTrue: null,
      whenFalse: null,
    };
  } else if (kind === "delay") {
    const set = String(formData.get("untilWorkingHoursSetId") ?? "");
    node = {
      id,
      kind: "delay",
      minutes: set
        ? undefined
        : z.coerce.number().int().min(1).catch(15).parse(formData.get("minutes")),
      untilWorkingHoursSetId: set || undefined,
      next: null,
    };
  } else if (kind === "retry") {
    const first = graph.nodes.find((n) => n.kind === "level");
    node = {
      id,
      kind: "retry",
      toNodeId: String(formData.get("toNodeId") ?? first?.id ?? ""),
      maxLoops: z.coerce.number().int().min(1).max(10).catch(2).parse(formData.get("maxLoops")),
      intervalMinutes: z.coerce
        .number()
        .int()
        .min(1)
        .max(120)
        .catch(5)
        .parse(formData.get("intervalMinutes")),
      next: null,
    };
  } else {
    node = { id, kind: "reassign", pathId: String(formData.get("toPathId") ?? "") };
  }
  // Find the tail of the main chain.
  let tail: EscalationNode | null = null;
  let cursor = graph.start;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const n = graph.nodes.find((x) => x.id === cursor);
    if (!n) break;
    tail = n;
    cursor = n.kind === "condition" ? n.whenTrue : n.kind === "reassign" ? null : n.next;
  }
  graph.nodes.push(node);
  if (!tail) graph.start = id;
  else if (tail.kind === "condition") tail.whenTrue = id;
  else if (tail.kind !== "reassign") tail.next = id;
  await saveDraft(current.tenant.id, pathId, graph);
  revalidatePath("/app/on-call/paths");
  redirect(`/app/on-call/paths?path=${pathId}&node=${id}&added=1`);
}

export async function removeNode(formData: FormData) {
  const current = await requireManager();
  const pathId = uuid.parse(formData.get("pathId"));
  const nodeId = z.string().min(1).parse(formData.get("nodeId"));
  const loaded = await loadPath(current.tenant.id, pathId);
  if (!loaded) return;
  const graph = loaded.graph;
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const successor =
    node.kind === "condition" ? node.whenTrue : node.kind === "reassign" ? null : node.next;
  for (const n of graph.nodes) {
    if (n.kind === "condition") {
      if (n.whenTrue === nodeId) n.whenTrue = successor;
      if (n.whenFalse === nodeId) n.whenFalse = successor;
    } else if (n.kind === "retry") {
      if (n.next === nodeId) n.next = successor;
      if (n.toNodeId === nodeId) n.toNodeId = successor ?? "";
    } else if (n.kind !== "reassign" && n.next === nodeId) n.next = successor;
  }
  if (graph.start === nodeId) graph.start = successor;
  graph.nodes = graph.nodes.filter((n) => n.id !== nodeId);
  await saveDraft(current.tenant.id, pathId, graph);
  revalidatePath("/app/on-call/paths");
  redirect(`/app/on-call/paths?path=${pathId}`);
}

/** Publishes the draft as the next version: running escalations finish on theirs, new ones take it. */
export async function publishPath(formData: FormData) {
  const current = await requireManager();
  const pathId = uuid.parse(formData.get("pathId"));
  const version = await withTenant(current.tenant.id, async (tx) => {
    const [p] = await tx
      .select()
      .from(escalationPaths)
      .where(and(eq(escalationPaths.tenantId, current.tenant.id), eq(escalationPaths.id, pathId)));
    if (!p?.draftGraph) return null;
    const [last] = await tx
      .select({ version: escalationPathVersions.version })
      .from(escalationPathVersions)
      .where(eq(escalationPathVersions.pathId, pathId))
      .orderBy(desc(escalationPathVersions.version))
      .limit(1);
    const version = (last?.version ?? 0) + 1;
    const [row] = await tx
      .insert(escalationPathVersions)
      .values({
        tenantId: current.tenant.id,
        pathId,
        version,
        graph: p.draftGraph,
        publishedByMemberId: current.member.id,
      })
      .returning({ id: escalationPathVersions.id });
    await tx
      .update(escalationPaths)
      .set({ currentVersionId: row!.id, draftGraph: null, updatedAt: new Date() })
      .where(eq(escalationPaths.id, pathId));
    await recordAudit(tx, current, "config", "escalation_path.published", {
      name: p.name,
      version,
    });
    return version;
  });
  revalidatePath("/app/on-call/paths");
  redirect(`/app/on-call/paths?path=${pathId}${version ? `&published=${version}` : ""}`);
}

export async function discardDraft(formData: FormData) {
  const current = await requireManager();
  const pathId = uuid.parse(formData.get("pathId"));
  await withTenant(current.tenant.id, (tx) =>
    tx
      .update(escalationPaths)
      .set({ draftGraph: null })
      .where(and(eq(escalationPaths.tenantId, current.tenant.id), eq(escalationPaths.id, pathId))),
  );
  revalidatePath("/app/on-call/paths");
  redirect(`/app/on-call/paths?path=${pathId}`);
}

export async function createPath(formData: FormData) {
  const current = await requireManager();
  const name = z.string().trim().min(2).max(80).parse(formData.get("name"));
  const id = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .insert(escalationPaths)
      .values({
        tenantId: current.tenant.id,
        name,
        draftGraph: {
          start: "l1",
          nodes: [
            {
              id: "l1",
              kind: "level",
              targets: [{ kind: "member", memberId: current.member.id }],
              urgency: "high",
              ackTimeoutMinutes: 5,
              retries: 1,
              retryIntervalMinutes: 2,
              next: null,
            },
          ],
        },
      })
      .returning({ id: escalationPaths.id });
    await recordAudit(tx, current, "config", "escalation_path.created", { name });
    return row!.id;
  });
  revalidatePath("/app/on-call/paths");
  redirect(`/app/on-call/paths?path=${id}`);
}

/** "Test the path": who would be paged right now, level by level — a dry run on real schedules. */
export async function testPath(formData: FormData) {
  const current = await requireMember();
  const pathId = uuid.parse(formData.get("pathId"));
  const loaded = await loadPath(current.tenant.id, pathId);
  if (!loaded) return;
  const preview = await withTenant(current.tenant.id, (tx) =>
    previewGraph(tx, current.tenant.id, loaded.graph, {
      now: new Date(),
      urgency: "high",
      priorityRank: 0,
    }),
  );
  const encoded = Buffer.from(
    JSON.stringify(
      preview.map((l) => ({
        level: l.level,
        offset: l.offsetMinutes,
        members: l.members.map((m) => m.name),
        urgency: l.urgency,
        ack: l.ackTimeoutMinutes,
      })),
    ),
  ).toString("base64url");
  redirect(`/app/on-call/paths?path=${pathId}&test=${encoded}`);
}
