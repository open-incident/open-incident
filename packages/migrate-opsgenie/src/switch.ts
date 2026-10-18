/**
 * Step 6: a team at a time, Open Incident starts paging.
 *
 * A switch is the activation of what the import created for the team, and
 * nothing else: its schedules (and those its policies page) are published,
 * its policies get a published version, its alert sources, rules and
 * heartbeats are switched on, and the team's own policy becomes the imported
 * default. A rollback undoes exactly that. Overrides are read again from
 * Opsgenie at the moment of the switch — someone may have swapped a shift
 * since the inventory.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  alertRoutes,
  alertSources,
  escalationPathVersions,
  escalationPaths,
  heartbeats,
  migrationItems,
  migrationTeamSwitch,
  scheduleOverrides,
  schedules,
  shadowDecisions,
  teams,
  type EscalationGraph,
  type Tx,
} from "@openincident/db";
import { isNobody, type PeopleIndex } from "./convert";
import type { OpsgenieClient } from "./client";
import { linkOf, type OiLink } from "./import";
import { itemsOf, peopleIndex, peopleOf, type ItemRow, type Run } from "./run";
import type { OgOverride } from "./types";
import { TIMELINE_WEEKS } from "./inventory";

/** The schedule ids a graph pages. */
function schedulesIn(graph: EscalationGraph | null): string[] {
  const out: string[] = [];
  for (const n of graph?.nodes ?? [])
    if (n.kind === "level")
      for (const t of n.targets) if (t.kind === "schedule") out.push(t.scheduleId);
  return out;
}

type TeamObjects = {
  scheduleIds: string[];
  pathIds: string[];
  sourceIds: string[];
  routeIds: string[];
  heartbeatIds: string[];
};

/** What the import made for a team: its own objects, and the schedules its policies page. */
async function objectsOf(tx: Tx, items: ItemRow[], run: Run, team: string): Promise<TeamObjects> {
  const owned = (type: ItemRow["type"]) =>
    items.filter((i) => i.type === type && linkOf(i)?.team === team && i.oiId);
  const pathIds = new Set<string>(owned("escalation").map((i) => i.oiId!));
  for (const r of items.filter((i) => i.type === "routing_rule" && linkOf(i)?.team === team))
    if (linkOf(r)?.pathId) pathIds.add(linkOf(r)!.pathId!);
  const teamItem = items.find((i) => i.type === "team" && i.externalId === team);
  if (teamItem && linkOf(teamItem)?.defaultPathId) pathIds.add(linkOf(teamItem)!.defaultPathId!);
  const scheduleIds = new Set<string>();
  for (const s of owned("schedule"))
    for (const p of linkOf(s)?.parts ?? []) scheduleIds.add(p.scheduleId);
  if (pathIds.size) {
    const paths = await tx
      .select()
      .from(escalationPaths)
      .where(inArray(escalationPaths.id, [...pathIds]));
    for (const p of paths) for (const id of schedulesIn(p.draftGraph)) scheduleIds.add(id);
  }
  void run;
  return {
    scheduleIds: [...scheduleIds],
    pathIds: [...pathIds],
    sourceIds: owned("integration").map((i) => i.oiId!),
    routeIds: owned("routing_rule")
      .filter((i) => linkOf(i) && i.oiTable === "alert_routes")
      .map((i) => i.oiId!),
    heartbeatIds: owned("heartbeat").map((i) => i.oiId!),
  };
}

/** Publishes a path's draft as its next version (unless that version is already current). */
async function publish(
  tx: Tx,
  tenantId: string,
  pathId: string,
  actor: string | null,
): Promise<void> {
  const [path] = await tx.select().from(escalationPaths).where(eq(escalationPaths.id, pathId));
  if (!path?.draftGraph) return;
  const [last] = await tx
    .select()
    .from(escalationPathVersions)
    .where(eq(escalationPathVersions.pathId, pathId))
    .orderBy(desc(escalationPathVersions.version))
    .limit(1);
  if (last && JSON.stringify(last.graph) === JSON.stringify(path.draftGraph)) {
    await tx
      .update(escalationPaths)
      .set({ currentVersionId: last.id, updatedAt: new Date() })
      .where(eq(escalationPaths.id, pathId));
    return;
  }
  const [v] = await tx
    .insert(escalationPathVersions)
    .values({
      tenantId,
      pathId,
      version: (last?.version ?? 0) + 1,
      graph: path.draftGraph,
      publishedByMemberId: actor,
    })
    .returning({ id: escalationPathVersions.id });
  await tx
    .update(escalationPaths)
    .set({ currentVersionId: v!.id, updatedAt: new Date() })
    .where(eq(escalationPaths.id, pathId));
}

/** Teams whose unresolved disagreements block their switch. */
export async function switchBlocked(tx: Tx, runId: string, team: string): Promise<number> {
  const rows = await tx
    .select({
      id: shadowDecisions.id,
      resolution: shadowDecisions.resolution,
      agrees: shadowDecisions.agrees,
    })
    .from(shadowDecisions)
    .where(and(eq(shadowDecisions.runId, runId), eq(shadowDecisions.teamExternalId, team)));
  return rows.filter((r) => !r.agrees && !r.resolution).length;
}

export async function switchTeam(
  tx: Tx,
  tenantId: string,
  run: Run,
  team: string,
  actor: string | null,
): Promise<{ ok: true } | { ok: false; reason: "blocked" | "unknown" }> {
  if ((await switchBlocked(tx, run.id, team)) > 0) return { ok: false, reason: "blocked" };
  const [row] = await tx
    .select()
    .from(migrationTeamSwitch)
    .where(
      and(eq(migrationTeamSwitch.runId, run.id), eq(migrationTeamSwitch.teamExternalId, team)),
    );
  if (!row) return { ok: false, reason: "unknown" };
  const items = await itemsOf(tx, run.id);
  const o = await objectsOf(tx, items, run, team);
  if (o.scheduleIds.length)
    await tx
      .update(schedules)
      .set({ status: "published", updatedAt: new Date() })
      .where(inArray(schedules.id, o.scheduleIds));
  for (const p of o.pathIds) await publish(tx, tenantId, p, actor);
  if (o.sourceIds.length)
    await tx
      .update(alertSources)
      .set({ active: true })
      .where(inArray(alertSources.id, o.sourceIds));
  if (o.routeIds.length)
    await tx
      .update(alertRoutes)
      .set({ active: true, updatedAt: new Date() })
      .where(inArray(alertRoutes.id, o.routeIds));
  if (o.heartbeatIds.length)
    await tx
      .update(heartbeats)
      .set({ active: true, updatedAt: new Date() })
      .where(inArray(heartbeats.id, o.heartbeatIds));
  const teamItem = items.find((i) => i.type === "team" && i.externalId === team);
  const link = teamItem ? linkOf(teamItem) : null;
  // The team's own policy becomes the imported default — unless the team
  // already had one here, which stays the team's to change.
  if (teamItem?.oiId && link?.defaultPathId && (link.createdHere || !link.previousPolicyPathId))
    await tx
      .update(teams)
      .set({ policyPathId: link.defaultPathId, updatedAt: new Date() })
      .where(eq(teams.id, teamItem.oiId));
  await tx
    .update(migrationTeamSwitch)
    .set({
      state: "switched",
      switchedAt: new Date(),
      switchedByMemberId: actor,
      rolledBackAt: null,
      updatedAt: new Date(),
    })
    .where(eq(migrationTeamSwitch.id, row.id));
  return { ok: true };
}

export async function rollbackTeam(
  tx: Tx,
  tenantId: string,
  run: Run,
  team: string,
): Promise<boolean> {
  const switches = await tx
    .select()
    .from(migrationTeamSwitch)
    .where(eq(migrationTeamSwitch.runId, run.id));
  const row = switches.find((s) => s.teamExternalId === team);
  if (!row || row.state !== "switched") return false;
  const items = await itemsOf(tx, run.id);
  const mine = await objectsOf(tx, items, run, team);
  // What another switched team still needs stays on.
  const others = switches.filter((s) => s.state === "switched" && s.teamExternalId !== team);
  const keep = { scheduleIds: new Set<string>(), pathIds: new Set<string>() };
  for (const s of others) {
    const o = await objectsOf(tx, items, run, s.teamExternalId);
    o.scheduleIds.forEach((x) => keep.scheduleIds.add(x));
    o.pathIds.forEach((x) => keep.pathIds.add(x));
  }
  const scheduleIds = mine.scheduleIds.filter((x) => !keep.scheduleIds.has(x));
  const pathIds = mine.pathIds.filter((x) => !keep.pathIds.has(x));
  if (scheduleIds.length)
    await tx
      .update(schedules)
      .set({ status: "draft", updatedAt: new Date() })
      .where(inArray(schedules.id, scheduleIds));
  if (pathIds.length)
    await tx
      .update(escalationPaths)
      .set({ currentVersionId: null, updatedAt: new Date() })
      .where(inArray(escalationPaths.id, pathIds));
  if (mine.sourceIds.length)
    await tx
      .update(alertSources)
      .set({ active: false })
      .where(inArray(alertSources.id, mine.sourceIds));
  if (mine.routeIds.length)
    await tx
      .update(alertRoutes)
      .set({ active: false, updatedAt: new Date() })
      .where(inArray(alertRoutes.id, mine.routeIds));
  if (mine.heartbeatIds.length)
    await tx
      .update(heartbeats)
      .set({ active: false, updatedAt: new Date() })
      .where(inArray(heartbeats.id, mine.heartbeatIds));
  const teamItem = items.find((i) => i.type === "team" && i.externalId === team);
  const link = teamItem ? linkOf(teamItem) : null;
  if (teamItem?.oiId && (link?.createdHere || !link?.previousPolicyPathId))
    await tx
      .update(teams)
      .set({ policyPathId: link?.previousPolicyPathId ?? null, updatedAt: new Date() })
      .where(eq(teams.id, teamItem.oiId));
  await tx
    .update(migrationTeamSwitch)
    .set({ state: "rolled_back", rolledBackAt: new Date(), updatedAt: new Date() })
    .where(eq(migrationTeamSwitch.id, row.id));
  void tenantId;
  return true;
}

export async function toggleChecklist(
  tx: Tx,
  runId: string,
  team: string,
  key: string,
): Promise<void> {
  const [row] = await tx
    .select()
    .from(migrationTeamSwitch)
    .where(and(eq(migrationTeamSwitch.runId, runId), eq(migrationTeamSwitch.teamExternalId, team)));
  if (!row) return;
  const checklist = row.checklist.map((c) => (c.key === key ? { ...c, done: !c.done } : c));
  await tx
    .update(migrationTeamSwitch)
    .set({ checklist, updatedAt: new Date() })
    .where(eq(migrationTeamSwitch.id, row.id));
}

/* ---------- Reading overrides again ---------- */

/**
 * Reads a schedule's overrides and timeline again from Opsgenie (network,
 * outside any transaction). `writeOverrides` then stores them and replaces
 * the imported overrides.
 */
export async function fetchOverrides(
  client: OpsgenieClient,
  scheduleIds: string[],
  now = new Date(),
): Promise<Map<string, { overrides: OgOverride[]; timeline: unknown }>> {
  const out = new Map<string, { overrides: OgOverride[]; timeline: unknown }>();
  for (const id of scheduleIds) {
    const overrides = await client.overrides(id);
    const timeline = await client.timeline(id, now, TIMELINE_WEEKS).catch(() => null);
    out.set(id, { overrides, timeline });
  }
  return out;
}

export async function writeOverrides(
  tx: Tx,
  tenantId: string,
  run: Run,
  fresh: Map<string, { overrides: OgOverride[]; timeline: unknown }>,
  actor: string | null,
): Promise<void> {
  const items = await itemsOf(tx, run.id, "schedule");
  const people: PeopleIndex = peopleIndex(await peopleOf(tx, run.id));
  for (const [id, f] of fresh) {
    const item = items.find((i) => i.externalId === id);
    if (!item) continue;
    const data: Record<string, unknown> = {
      ...(item.data as Record<string, unknown>),
      overrides: f.overrides,
      ...(f.timeline ? { timeline: f.timeline } : {}),
    };
    const link = linkOf(item);
    if (link?.parts) {
      // Replace what came from Opsgenie; the slots fixed here are kept.
      const imported = link.parts.flatMap((p) => p.overrideIds);
      if (imported.length)
        await tx.delete(scheduleOverrides).where(inArray(scheduleOverrides.id, imported));
      const now = Date.now();
      const parts: NonNullable<OiLink["parts"]> = [];
      for (const p of link.parts) {
        const mine = f.overrides.filter(
          (o) =>
            (!o.rotations?.length || o.rotations.some((r) => p.rotationIds[r.id])) &&
            new Date(o.endDate).getTime() > now,
        );
        const rows = mine.length
          ? await tx
              .insert(scheduleOverrides)
              .values(
                mine.map((o) => {
                  const m = o.user.type === "user" && o.user.id ? people.get(o.user.id) : null;
                  const rot = o.rotations?.find((r) => p.rotationIds[r.id]);
                  return {
                    tenantId,
                    scheduleId: p.scheduleId,
                    rotationId: rot ? p.rotationIds[rot.id]! : null,
                    memberId: m && !isNobody(m) ? m : null,
                    startAt: new Date(o.startDate),
                    endAt: new Date(o.endDate),
                    reason: "override" as const,
                    createdByMemberId: actor,
                  };
                }),
              )
              .returning({ id: scheduleOverrides.id })
          : [];
        parts.push({ ...p, overrideIds: rows.map((r) => r.id) });
      }
      data.oi = { ...link, parts };
    }
    await tx
      .update(migrationItems)
      .set({ data, updatedAt: new Date() })
      .where(eq(migrationItems.id, item.id));
  }
}
