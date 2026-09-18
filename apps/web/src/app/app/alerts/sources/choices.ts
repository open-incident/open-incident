/**
 * The three choices a source carries.
 *
 * A source says who to page, whether an incident opens, and whether an alert
 * closes itself when the tool says it recovered. The pipeline reads those from
 * the route that governs the source — the first route whose conditions hold —
 * so the choices are stored there rather than invented next to it: what the
 * page shows is exactly what the next alert will do.
 *
 * "The source's own choices" is the route scoped to this source alone and
 * carrying no condition. A workspace that never opened this screen has none:
 * the catch-all route governs every source, and the first change made here
 * gives the source a route of its own, placed just before the catch-all so
 * that every rule still wins over it.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import {
  alertPriorities,
  alertRoutes,
  escalationPathVersions,
  escalationPaths,
  members,
  schedules,
  teams,
  type EscalationGraph,
  type EscalationRule,
  type IncidentTemplate,
  type Tx,
} from "@openincident/db";

export type RouteRow = typeof alertRoutes.$inferSelect;

/** Who the source pages when nothing more specific says otherwise. */
export type PageChoice =
  | { kind: "owner" }
  | { kind: "member"; memberId: string; name: string }
  | { kind: "team"; teamId: string; name: string }
  | { kind: "schedule"; scheduleId: string; name: string }
  /** A path the source page cannot express as one of the choices above. */
  | { kind: "path"; pathId: string; name: string }
  | { kind: "nobody" };

/** Whether an alert opens an incident: always (in triage), only when urgent, never. */
export type IncidentChoice = "triage" | "urgent" | "never";

export type SourceChoices = {
  /** The route the pipeline would pick for this source with no other condition. */
  route: RouteRow | null;
  /** The route belongs to this source alone — otherwise it is shared with every other source. */
  own: boolean;
  page: PageChoice;
  incident: IncidentChoice;
  autoResolve: boolean;
};

const EMPTY_TEMPLATE: IncidentTemplate = {
  mode: "never",
  typeId: null,
  startPhase: "triage",
  severity: { mode: "priority" },
  visibility: "public",
  customFields: {},
  declineOnResolve: true,
};

function hasCondition(r: RouteRow): boolean {
  return r.conditions.some((g) => g.all.length > 0) || r.filters.length > 0;
}

/** The route the source's own choices live in, and the shared one it falls back to. */
export async function governingRoute(
  tx: Tx,
  tenantId: string,
  sourceId: string,
): Promise<{ route: RouteRow | null; own: boolean; catchAll: RouteRow | null }> {
  const rows = await tx
    .select()
    .from(alertRoutes)
    .where(eq(alertRoutes.tenantId, tenantId))
    .orderBy(asc(alertRoutes.position), asc(alertRoutes.createdAt));
  const own =
    rows.find((r) => r.sourceIds.length === 1 && r.sourceIds[0] === sourceId && !hasCondition(r)) ??
    null;
  const catchAll = rows.find((r) => r.sourceIds.length === 0 && !hasCondition(r)) ?? null;
  return { route: own ?? catchAll, own: Boolean(own), catchAll };
}

/** The first level of a published path, which is who the path pages first. */
async function firstLevel(tx: Tx, tenantId: string, pathId: string) {
  const [path] = await tx
    .select({
      id: escalationPaths.id,
      name: escalationPaths.name,
      current: escalationPaths.currentVersionId,
    })
    .from(escalationPaths)
    .where(and(eq(escalationPaths.tenantId, tenantId), eq(escalationPaths.id, pathId)));
  if (!path) return null;
  const [version] = path.current
    ? await tx
        .select({ graph: escalationPathVersions.graph })
        .from(escalationPathVersions)
        .where(eq(escalationPathVersions.id, path.current))
    : [];
  const graph: EscalationGraph | null = version?.graph ?? null;
  const node = graph?.nodes.find((n) => n.id === graph.start) ?? null;
  return { name: path.name, level: node?.kind === "level" ? node : null };
}

/** Reads back which of the five "who to page" answers a route's rules express. */
async function readPage(tx: Tx, tenantId: string, route: RouteRow | null): Promise<PageChoice> {
  if (!route) return { kind: "nobody" };
  const rules: EscalationRule[] =
    route.escalations.length > 0
      ? route.escalations
      : route.escalationMode === "static" && route.escalationPathId
        ? [{ kind: "path", pathId: route.escalationPathId }]
        : [];
  if (rules.length === 0) return { kind: "nobody" };
  const first = rules[0]!;
  if (first.kind === "attribute") return { kind: "owner" };
  const [team] = await tx
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(and(eq(teams.tenantId, tenantId), eq(teams.policyPathId, first.pathId)));
  if (team) return { kind: "team", teamId: team.id, name: team.name };
  const found = await firstLevel(tx, tenantId, first.pathId);
  if (!found) return { kind: "nobody" };
  const target = found.level?.targets[0];
  if (found.level && found.level.targets.length === 1 && target) {
    if (target.kind === "member") {
      const [m] = await tx
        .select({ name: members.name })
        .from(members)
        .where(eq(members.id, target.memberId));
      if (m) return { kind: "member", memberId: target.memberId, name: m.name };
    }
    if (target.kind === "schedule") {
      const [s] = await tx
        .select({ name: schedules.name })
        .from(schedules)
        .where(eq(schedules.id, target.scheduleId));
      if (s) return { kind: "schedule", scheduleId: target.scheduleId, name: s.name };
    }
  }
  return { kind: "path", pathId: first.pathId, name: found.name };
}

function readIncident(route: RouteRow | null): IncidentChoice {
  if (!route) return "never";
  const template = route.incident ?? { ...EMPTY_TEMPLATE, mode: route.incidentMode };
  if (template.mode === "never") return "never";
  return template.mode === "always" ? "triage" : "urgent";
}

function readAutoResolve(route: RouteRow | null): boolean {
  if (!route) return true;
  const template = route.incident;
  return route.resolveClosesEscalation && (template?.declineOnResolve ?? true);
}

/** Everything the source page and the source cards show about one source. */
export async function sourceChoices(
  tx: Tx,
  tenantId: string,
  sourceId: string,
): Promise<SourceChoices> {
  const { route, own } = await governingRoute(tx, tenantId, sourceId);
  return {
    route,
    own,
    page: await readPage(tx, tenantId, route),
    incident: readIncident(route),
    autoResolve: readAutoResolve(route),
  };
}

/**
 * The priority from which the "only when urgent" answer opens an incident.
 *
 * The pipeline opens a conditional incident when the alert's urgency is high,
 * and urgency comes from the priority — so the threshold is the least
 * important priority the workspace marked urgent, and naming it is the truth
 * rather than a guess.
 */
export async function urgentFrom(tx: Tx, tenantId: string): Promise<string | null> {
  const rows = await tx
    .select({ name: alertPriorities.name, urgency: alertPriorities.urgency })
    .from(alertPriorities)
    .where(eq(alertPriorities.tenantId, tenantId))
    .orderBy(desc(alertPriorities.rank));
  return rows.find((p) => p.urgency === "high")?.name ?? null;
}

/** The teams a source can hand its alerts to: the ones whose policy really pages. */
export async function pageableTeams(tx: Tx, tenantId: string) {
  const rows = await tx
    .select({
      id: teams.id,
      name: teams.name,
      pathId: teams.policyPathId,
      published: escalationPaths.currentVersionId,
    })
    .from(teams)
    .leftJoin(escalationPaths, eq(escalationPaths.id, teams.policyPathId))
    .where(eq(teams.tenantId, tenantId))
    .orderBy(asc(teams.name));
  return rows
    .filter((r) => r.pathId && r.published)
    .map((r) => ({ id: r.id, name: r.name, pathId: r.pathId! }));
}

/** The schedules a source can page: published ones, the only kind the engine reads. */
export async function pageableSchedules(tx: Tx, tenantId: string) {
  return tx
    .select({ id: schedules.id, name: schedules.name })
    .from(schedules)
    .where(and(eq(schedules.tenantId, tenantId), eq(schedules.status, "published")))
    .orderBy(asc(schedules.name));
}
