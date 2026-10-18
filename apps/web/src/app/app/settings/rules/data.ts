/**
 * What the rules screen reads, and the "Preview on the last 50 alerts" it
 * offers — server only.
 */
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  alertPriorities,
  alertRoutes,
  alertSources,
  alerts,
  auditEvents,
  escalationPaths,
  severities,
  teams,
  withTenant,
  type Tx,
} from "@openincident/db";
import { conditionsHold, type ConditionContext } from "@openincident/oncall";
import {
  conditionsOf,
  escalationsOf,
  incidentOf,
  isRule,
  type RouteRow,
  type RuleRefs,
} from "./model";

const DAY = 86_400_000;

/** The design's window for the preview: the last fifty alerts the workspace received. */
export const PREVIEW_LAST = 50;

export async function loadRefs(tx: Tx, tenantId: string): Promise<RuleRefs> {
  const [sources, paths, teamRows, sevs, prios] = await Promise.all([
    tx
      .select({ id: alertSources.id, name: alertSources.name, kind: alertSources.kind })
      .from(alertSources)
      .where(and(eq(alertSources.tenantId, tenantId), eq(alertSources.managed, false)))
      .orderBy(asc(alertSources.name)),
    tx
      .select({ id: escalationPaths.id, name: escalationPaths.name })
      .from(escalationPaths)
      .where(eq(escalationPaths.tenantId, tenantId))
      .orderBy(asc(escalationPaths.name)),
    tx
      .select({ id: teams.id, name: teams.name, policyPathId: teams.policyPathId })
      .from(teams)
      .where(eq(teams.tenantId, tenantId))
      .orderBy(asc(teams.name)),
    tx
      .select({ id: severities.id, name: severities.name })
      .from(severities)
      .where(eq(severities.tenantId, tenantId))
      .orderBy(asc(severities.rank)),
    tx
      .select({ id: alertPriorities.id, name: alertPriorities.name, rank: alertPriorities.rank })
      .from(alertPriorities)
      .where(eq(alertPriorities.tenantId, tenantId))
      .orderBy(asc(alertPriorities.rank)),
  ]);
  return { sources, paths, teams: teamRows, severities: sevs, priorities: prios };
}

export async function orderedRoutes(tx: Tx, tenantId: string): Promise<RouteRow[]> {
  return tx
    .select()
    .from(alertRoutes)
    .where(eq(alertRoutes.tenantId, tenantId))
    .orderBy(asc(alertRoutes.position), asc(alertRoutes.createdAt));
}

/**
 * Positions written back so they say what the pipeline reads: the rules in
 * the order given, then everything that is not a rule. Every consumer that
 * sorts by position alone then agrees with the one that reads rules first.
 */
export async function writeOrder(tx: Tx, rules: string[], others: string[]): Promise<void> {
  for (const [i, id] of [...rules, ...others].entries())
    await tx.update(alertRoutes).set({ position: i }).where(eq(alertRoutes.id, id));
}

export type RulesScreen = {
  rules: RouteRow[];
  /** The shared fallback — what every source starts from — when the workspace has one. */
  fallback: RouteRow | null;
  refs: RuleRefs;
  /** Alerts each rule decided in the last seven days, from `alerts.route_id`. */
  counts: Record<string, number>;
  /** Who wrote each rule, read from the audit log where the creation was recorded. */
  creators: Record<string, { name: string; at: Date }>;
};

export async function loadRulesScreen(tenantId: string): Promise<RulesScreen> {
  return withTenant(tenantId, async (tx) => {
    const routes = await orderedRoutes(tx, tenantId);
    const refs = await loadRefs(tx, tenantId);
    const rules = routes.filter(isRule);
    const fallback = routes.find((r) => !isRule(r)) ?? null;
    const since = new Date(Date.now() - 7 * DAY);
    const counted = rules.length
      ? await tx
          .select({ routeId: alerts.routeId, n: sql<number>`count(*)::int` })
          .from(alerts)
          .where(
            and(
              eq(alerts.tenantId, tenantId),
              gt(alerts.firstAt, since),
              inArray(
                alerts.routeId,
                rules.map((r) => r.id),
              ),
            ),
          )
          .groupBy(alerts.routeId)
      : [];
    const counts: Record<string, number> = {};
    for (const c of counted) if (c.routeId) counts[c.routeId] = Number(c.n);
    const created = rules.length
      ? await tx
          .select({
            actorName: auditEvents.actorName,
            target: auditEvents.target,
            createdAt: auditEvents.createdAt,
          })
          .from(auditEvents)
          .where(
            and(eq(auditEvents.tenantId, tenantId), eq(auditEvents.action, "alert_route.created")),
          )
          .orderBy(desc(auditEvents.createdAt))
          .limit(500)
      : [];
    const creators: RulesScreen["creators"] = {};
    for (const r of rules) {
      const hit =
        created.find((a) => a.target.id === r.id) ??
        created.find((a) => !a.target.id && a.target.name === r.name);
      if (hit) creators[r.id] = { name: hit.actorName, at: hit.createdAt };
    }
    return { rules, fallback, refs, counts, creators };
  });
}

/* ---------- Preview on the last 50 alerts ---------- */

type SourceRow = typeof alertSources.$inferSelect;

/**
 * What a route ends up doing for an alert from this source — the pipeline's
 * reading: a rule says everything; the fallback has the source's own three
 * choices laid over it.
 */
function outcomeKey(route: RouteRow | null, source: SourceRow | null): string {
  if (!route) return "none";
  let escalations = escalationsOf(route);
  let mode = incidentOf(route).mode;
  if (!isRule(route) && source) {
    if (source.escalations !== null) escalations = source.escalations;
    if (source.incidentOpens !== null) mode = source.incidentOpens;
  }
  const inc = incidentOf(route);
  return JSON.stringify({
    escalations,
    mode,
    severity: inc.severity,
    atlas: route.atlasDirective,
    test: route.testMode,
  });
}

/**
 * The rules as they stand, replayed on the last alerts: how many a rule
 * catches, and how many would now be handled differently from the way they
 * were when they arrived — read off the route each alert recorded. Nothing is
 * sent; this reads, it never acts.
 */
export async function previewLastAlerts(
  tx: Tx,
  tenantId: string,
): Promise<{ total: number; matched: number; changed: number }> {
  const rows = await tx
    .select({
      title: alerts.title,
      attributes: alerts.attributes,
      sourceId: alerts.sourceId,
      routeId: alerts.routeId,
      priority: alertPriorities.name,
    })
    .from(alerts)
    .leftJoin(alertPriorities, eq(alertPriorities.id, alerts.priorityId))
    .where(eq(alerts.tenantId, tenantId))
    .orderBy(desc(alerts.lastAt))
    .limit(PREVIEW_LAST);
  const routes = await orderedRoutes(tx, tenantId);
  const active = routes.filter((r) => r.active);
  const sources = await tx.select().from(alertSources).where(eq(alertSources.tenantId, tenantId));
  const fallback = active.find((r) => !isRule(r)) ?? null;
  let matched = 0;
  let changed = 0;
  for (const a of rows) {
    const source = sources.find((s) => s.id === a.sourceId) ?? null;
    const ctx: ConditionContext = {
      attributes: a.attributes,
      source: { kind: source?.kind ?? "", name: source?.name ?? "", id: a.sourceId },
      priority: a.priority ?? a.attributes.priority ?? null,
      title: a.title,
    };
    const rule =
      active.find(
        (r) =>
          isRule(r) &&
          (r.sourceIds.length === 0 || r.sourceIds.includes(a.sourceId)) &&
          conditionsHold(conditionsOf(r), ctx),
      ) ?? null;
    if (rule) matched += 1;
    // An alert that recorded no route has nothing to compare against.
    if (!a.routeId) continue;
    const then = routes.find((r) => r.id === a.routeId) ?? null;
    if (!then) continue;
    if (outcomeKey(then, source) !== outcomeKey(rule ?? fallback, source)) changed += 1;
  }
  return { total: rows.length, matched, changed };
}
