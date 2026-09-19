/**
 * Reading an escalation policy as a sentence.
 *
 * The graph is a typed node list (`level | condition | delay | retry |
 * reassign`); two screens need the same reading of it — the Now tab, which
 * says in one line who the pager reaches, and the Policies tab, which draws
 * the same walk as a timeline. Both go through here so they never disagree.
 */

import { asc, eq, inArray } from "drizzle-orm";
import {
  catalogEntries,
  escalationPaths,
  members,
  schedules,
  teams,
  workingHoursSets,
  type EscalationGraph,
  type EscalationNode,
  type EscalationTarget,
  type Tx,
} from "@openincident/db";
import type { Translate } from "@/i18n/server";

/** Names the graph refers to by id, resolved by the caller from its own queries. */
export type Names = {
  member: (id: string) => string;
  schedule: (id: string) => string;
  team: (id: string) => string;
  workingHours: (id: string) => string;
  path: (id: string) => string;
  /** Who carries that schedule's pager right now — null when nobody does. */
  onCall: (id: string) => string | null;
};

export type ChainStep = { node: EscalationNode; offset: number };

/**
 * The main line of the graph: follow `next`, and a condition's true branch.
 * The false branch is a side road the timeline mentions rather than walks —
 * the same choice the editor makes, so both read alike.
 */
export function mainChain(graph: EscalationGraph): ChainStep[] {
  const out: ChainStep[] = [];
  const seen = new Set<string>();
  let cursor = graph.start;
  let offset = 0;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = graph.nodes.find((n) => n.id === cursor);
    if (!node) break;
    out.push({ node, offset });
    if (node.kind === "level") offset += node.ackTimeoutMinutes;
    if (node.kind === "delay") offset += node.minutes ?? 0;
    cursor =
      node.kind === "condition" ? node.whenTrue : node.kind === "reassign" ? null : node.next;
  }
  return out;
}

/** One target as a noun phrase: "whoever is on call in Platform primary", "the Payments team". */
export function targetText(t: Translate, target: EscalationTarget, names: Names): string {
  if (target.kind === "member") return names.member(target.memberId);
  if (target.kind === "team")
    return t("oc2.pol.targetTeam", {
      name: names.team("teamId" in target ? target.teamId : target.teamEntryId),
    });
  const schedule = names.schedule(target.scheduleId);
  if (target.mode === "everyone") return t("oc2.pol.targetEveryone", { schedule });
  if (target.mode === "next") return t("oc2.pol.targetNext", { schedule });
  return t("oc2.pol.targetOnCall", { schedule });
}

/** Every target of a level, the first spelled out and the rest counted. */
export function levelTargets(
  t: Translate,
  node: Extract<EscalationNode, { kind: "level" }>,
  names: Names,
): string {
  const first = node.targets[0];
  if (!first) return t("oc2.pol.noTarget");
  const head = targetText(t, first, names);
  if (node.targets.length === 1) return head;
  return t("oc2.pol.targetMore", { first: head, count: node.targets.length - 1 });
}

/**
 * The same target, but named by the person actually holding the pager: a card
 * that says "Jordan now" is read at a glance, "whoever is on call in Platform
 * primary now" is read twice. Falls back to the phrase when nobody is on call.
 */
function pagedName(t: Translate, target: EscalationTarget, names: Names): string {
  if (target.kind === "schedule" && target.mode === "current")
    return names.onCall(target.scheduleId) ?? targetText(t, target, names);
  return targetText(t, target, names);
}

/** "Jordan now → Karim after 5 min → Platform team after 15 min". */
export function chainSentence(t: Translate, graph: EscalationGraph, names: Names): string {
  const parts: string[] = [];
  for (const { node, offset } of mainChain(graph)) {
    if (node.kind !== "level") continue;
    const first = node.targets[0];
    const who = first ? pagedName(t, first, names) : t("oc2.pol.noTarget");
    const rest =
      node.targets.length > 1
        ? t("oc2.pol.targetMore", { first: who, count: node.targets.length - 1 })
        : who;
    parts.push(
      offset === 0
        ? t("oc2.now.chainNow", { who: rest })
        : t("oc2.now.chainAfter", { who: rest, count: offset }),
    );
  }
  return parts.join(t("oc2.now.chainSep"));
}

/** The first policy whose main line pages this schedule — what the Now card explains. */
export function policyForSchedule<T extends { graph: EscalationGraph }>(
  policies: T[],
  scheduleId: string,
): T | null {
  return (
    policies.find((p) =>
      mainChain(p.graph).some(
        ({ node }) =>
          node.kind === "level" &&
          node.targets.some((tg) => tg.kind === "schedule" && tg.scheduleId === scheduleId),
      ),
    ) ?? null
  );
}

/* ---------- Resolving the ids a graph carries ---------- */

export type NameSource = {
  members: Array<{ id: string; name: string }>;
  schedules: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string }>;
  workingHours: Array<{ id: string; name: string }>;
  paths: Array<{ id: string; name: string }>;
  /** Schedule id → the name of whoever holds its pager right now. */
  onCall: Map<string, string>;
};

/**
 * The names every id in the graphs stands for.
 *
 * A team target still points at a catalogue entry — that is what the engine
 * resolves — while the first-class `teams` table names the owner teams a
 * service routes to. Both are read, so a policy reads the same whichever one
 * it was written against.
 */
export async function loadNameSource(
  tx: Tx,
  tenantId: string,
  graphs: EscalationGraph[],
  onCall: Map<string, string>,
): Promise<NameSource> {
  const teamIds = [
    ...new Set(
      graphs.flatMap((g) =>
        g.nodes.flatMap((n) =>
          n.kind === "level"
            ? n.targets.flatMap((tg) =>
                tg.kind === "team" ? ["teamId" in tg ? tg.teamId : tg.teamEntryId] : [],
              )
            : [],
        ),
      ),
    ),
  ];
  const entries = teamIds.length
    ? await tx
        .select({ id: catalogEntries.id, name: catalogEntries.name })
        .from(catalogEntries)
        .where(inArray(catalogEntries.id, teamIds))
    : [];
  const firstClass = await tx
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(eq(teams.tenantId, tenantId))
    .orderBy(asc(teams.name));
  return {
    members: await tx
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(eq(members.tenantId, tenantId)),
    schedules: await tx
      .select({ id: schedules.id, name: schedules.name })
      .from(schedules)
      .where(eq(schedules.tenantId, tenantId)),
    teams: [...entries, ...firstClass],
    workingHours: await tx
      .select({ id: workingHoursSets.id, name: workingHoursSets.name })
      .from(workingHoursSets)
      .where(eq(workingHoursSets.tenantId, tenantId)),
    paths: await tx
      .select({ id: escalationPaths.id, name: escalationPaths.name })
      .from(escalationPaths)
      .where(eq(escalationPaths.tenantId, tenantId)),
    onCall,
  };
}

/** An id nobody knows any more prints as a dash rather than as a uuid. */
export function namesOf(source: NameSource): Names {
  const map = (rows: Array<{ id: string; name: string }>) =>
    new Map(rows.map((r) => [r.id, r.name]));
  const m = map(source.members);
  const s = map(source.schedules);
  const tm = map(source.teams);
  const w = map(source.workingHours);
  const p = map(source.paths);
  return {
    member: (id) => m.get(id) ?? "—",
    schedule: (id) => s.get(id) ?? "—",
    team: (id) => tm.get(id) ?? "—",
    workingHours: (id) => w.get(id) ?? "—",
    path: (id) => p.get(id) ?? "—",
    onCall: (id) => source.onCall.get(id) ?? null,
  };
}
