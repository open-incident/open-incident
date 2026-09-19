/**
 * Alerting, from the workspace's point of view: where its setup stands, the
 * one-click path that pages a person or a schedule, and the reads the setup
 * screens share.
 */
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  alertAttributes,
  alertEvents,
  alertPriorities,
  alertRoutes,
  alertSources,
  alerts,
  escalationPathVersions,
  escalationPaths,
  escalations,
  members,
  schedules,
  type EscalationGraph,
  type EscalationRule,
  type Tx,
} from "@openincident/db";

export type RouteRow = typeof alertRoutes.$inferSelect;

/** The route that catches everything: no source restriction, no condition, last in order. */
export async function catchAllRoute(tx: Tx, tenantId: string): Promise<RouteRow | null> {
  const rows = await tx
    .select()
    .from(alertRoutes)
    .where(eq(alertRoutes.tenantId, tenantId))
    .orderBy(desc(alertRoutes.position));
  return (
    rows.find(
      (r) =>
        r.sourceIds.length === 0 &&
        r.conditions.filter((g) => g.all.length > 0).length === 0 &&
        r.filters.length === 0,
    ) ?? null
  );
}

export type SetupStatus = {
  sources: { count: number; lastAlertAt: Date | null; ids: string[] };
  paths: { count: number; published: number };
  routes: { count: number; catchAll: RouteRow | null; paging: boolean };
  alerts: { count: number; lastAt: Date | null; escalated: boolean; routed: boolean };
  priorities: number;
  attributes: number;
  /** Who gets paged, a source, a first alert, an alert that paged: the four steps. */
  steps: { pager: boolean; source: boolean; firstAlert: boolean; verified: boolean };
  complete: boolean;
};

/** Whether an active route pages someone: a rule that names a published path. */
async function routePages(tx: Tx, tenantId: string, routes: RouteRow[]): Promise<boolean> {
  const published = new Set(
    (
      await tx
        .select({ id: escalationPaths.id })
        .from(escalationPaths)
        .where(
          and(
            eq(escalationPaths.tenantId, tenantId),
            sql`${escalationPaths.currentVersionId} is not null`,
          ),
        )
    ).map((p) => p.id),
  );
  return routes.some(
    (r) =>
      r.active &&
      !r.testMode &&
      (r.escalations.some(
        (e: EscalationRule) =>
          (e.kind === "path" && published.has(e.pathId)) ||
          (e.kind === "attribute" && (e.fallbackPathId ? published.has(e.fallbackPathId) : true)),
      ) ||
        (r.escalationMode === "static" &&
          r.escalationPathId &&
          published.has(r.escalationPathId)) ||
        (r.escalationMode === "dynamic" && r.escalations.length === 0)),
  );
}

export async function alertingSetupStatus(tx: Tx, tenantId: string): Promise<SetupStatus> {
  const sources = await tx
    .select({ id: alertSources.id, lastAlertAt: alertSources.lastAlertAt })
    .from(alertSources)
    .where(and(eq(alertSources.tenantId, tenantId), eq(alertSources.managed, false)));
  const paths = await tx
    .select({ id: escalationPaths.id, current: escalationPaths.currentVersionId })
    .from(escalationPaths)
    .where(eq(escalationPaths.tenantId, tenantId));
  const routes = await tx
    .select()
    .from(alertRoutes)
    .where(eq(alertRoutes.tenantId, tenantId))
    .orderBy(alertRoutes.position);
  const [alertStats] = await tx
    .select({ n: sql<number>`count(*)::int`, last: sql<Date | null>`max(${alerts.lastAt})` })
    .from(alerts)
    .where(eq(alerts.tenantId, tenantId));
  const [escalated] = await tx
    .select({ id: escalations.id })
    .from(escalations)
    .where(and(eq(escalations.tenantId, tenantId), sql`${escalations.alertId} is not null`))
    .limit(1);
  const [routed] = await tx
    .select({ id: alertEvents.id })
    .from(alertEvents)
    .where(
      and(
        eq(alertEvents.tenantId, tenantId),
        eq(alertEvents.kind, "routed"),
        sql`${alertEvents.payload}->>'route' is not null`,
      ),
    )
    .limit(1);
  const [prio] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(alertPriorities)
    .where(eq(alertPriorities.tenantId, tenantId));
  const [attrs] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(alertAttributes)
    .where(eq(alertAttributes.tenantId, tenantId));
  const paging = await routePages(tx, tenantId, routes);
  const lastAlertAt = sources.reduce<Date | null>(
    (acc, s) => (s.lastAlertAt && (!acc || s.lastAlertAt > acc) ? s.lastAlertAt : acc),
    null,
  );
  const steps = {
    pager: paging,
    source: sources.length > 0,
    firstAlert: (alertStats?.n ?? 0) > 0,
    verified: Boolean(escalated),
  };
  return {
    sources: { count: sources.length, lastAlertAt, ids: sources.map((s) => s.id) },
    paths: { count: paths.length, published: paths.filter((p) => p.current).length },
    routes: { count: routes.length, catchAll: await catchAllRoute(tx, tenantId), paging },
    alerts: {
      count: alertStats?.n ?? 0,
      lastAt: alertStats?.last ? new Date(alertStats.last) : null,
      escalated: Boolean(escalated),
      routed: Boolean(routed),
    },
    priorities: prio?.n ?? 0,
    attributes: attrs?.n ?? 0,
    steps,
    complete: steps.pager && steps.source && steps.firstAlert && steps.verified,
  };
}

export type QuickTarget =
  { kind: "member"; memberId: string } | { kind: "schedule"; scheduleId: string };

/**
 * The path a click makes: one level that pages the person or the schedule,
 * five minutes to acknowledge, two retries — published at once, so the route
 * that names it works the moment it is saved. Reused when it already exists.
 */
export async function ensureQuickPath(
  tx: Tx,
  tenantId: string,
  actor: { memberId: string | null },
  target: QuickTarget,
  name: string,
): Promise<{ id: string; name: string; created: boolean }> {
  const [existing] = await tx
    .select({
      id: escalationPaths.id,
      name: escalationPaths.name,
      current: escalationPaths.currentVersionId,
    })
    .from(escalationPaths)
    .where(and(eq(escalationPaths.tenantId, tenantId), eq(escalationPaths.name, name)));
  if (existing?.current) return { id: existing.id, name: existing.name, created: false };
  const graph: EscalationGraph = {
    start: "l1",
    nodes: [
      {
        id: "l1",
        kind: "level",
        targets:
          target.kind === "member"
            ? [{ kind: "member", memberId: target.memberId }]
            : [{ kind: "schedule", scheduleId: target.scheduleId, mode: "current" }],
        urgency: "high",
        ackTimeoutMinutes: 5,
        retries: 2,
        retryIntervalMinutes: 3,
        next: null,
      },
    ],
  };
  let pathId = existing?.id;
  if (!pathId) {
    const [row] = await tx
      .insert(escalationPaths)
      .values({ tenantId, name, draftGraph: null })
      .returning({ id: escalationPaths.id });
    pathId = row!.id;
  }
  const [version] = await tx
    .insert(escalationPathVersions)
    .values({ tenantId, pathId, version: 1, graph, publishedByMemberId: actor.memberId })
    .returning({ id: escalationPathVersions.id });
  await tx
    .update(escalationPaths)
    .set({ currentVersionId: version!.id, draftGraph: null, updatedAt: new Date() })
    .where(eq(escalationPaths.id, pathId));
  return { id: pathId, name, created: true };
}

/** Names a path on the catch-all route (created when the workspace has none). */
export async function pageWithPath(
  tx: Tx,
  tenantId: string,
  pathId: string,
  routeName: string,
  routeDescription: string,
): Promise<string> {
  let route = await catchAllRoute(tx, tenantId);
  if (!route) {
    const [created] = await tx
      .insert(alertRoutes)
      .values({
        tenantId,
        name: routeName,
        description: routeDescription,
        active: true,
        sourceIds: [],
        conditions: [],
        escalations: [],
        incident: {
          mode: "conditional",
          typeId: null,
          startPhase: "triage",
          severity: { mode: "priority" },
          visibility: "public",
          customFields: {},
          declineOnResolve: true,
        },
        grouping: {
          enabled: true,
          by: ["service"],
          windowMinutes: 5,
          extending: true,
          escalate: "never",
          graceMinutes: 0,
        },
        escalationMode: "none",
        incidentMode: "conditional",
        position: 1000,
      })
      .returning();
    route = created!;
  }
  const rules: EscalationRule[] = [
    ...route.escalations.filter((e) => !(e.kind === "path" && e.pathId === pathId)),
    { kind: "path", pathId },
  ];
  await tx
    .update(alertRoutes)
    .set({
      escalations: rules,
      escalationMode: "static",
      escalationPathId: pathId,
      testMode: false,
      active: true,
      updatedAt: new Date(),
    })
    .where(eq(alertRoutes.id, route.id));
  return route.id;
}

/** The last payloads a source received — the material the mapping editor previews against. */
export async function recentPayloads(tx: Tx, sourceId: string, limit = 6) {
  return tx
    .select({
      id: alerts.id,
      title: alerts.title,
      payload: alerts.payload,
      attributes: alerts.attributes,
      firstAt: alerts.firstAt,
      testMode: alerts.testMode,
    })
    .from(alerts)
    .where(eq(alerts.sourceId, sourceId))
    .orderBy(desc(alerts.firstAt))
    .limit(limit);
}

/** Per source: alerts in the last 24 h and the last one, for the health column. */
export async function sourceHealth(tx: Tx, tenantId: string) {
  const since = new Date(Date.now() - 24 * 3600_000);
  const rows = await tx
    .select({
      sourceId: alerts.sourceId,
      n: sql<number>`count(*)::int`,
      firing: sql<number>`count(*) filter (where ${alerts.status} = 'firing')::int`,
    })
    .from(alerts)
    .where(and(eq(alerts.tenantId, tenantId), gt(alerts.lastAt, since)))
    .groupBy(alerts.sourceId);
  return new Map(rows.map((r) => [r.sourceId, { day: r.n, firing: r.firing }]));
}

/** How often each attribute is present on recent alerts — the coverage column of the registry. */
export async function attributeCoverage(tx: Tx, tenantId: string, keys: string[]) {
  const recent = await tx
    .select({ attributes: alerts.attributes, sourceId: alerts.sourceId })
    .from(alerts)
    .where(and(eq(alerts.tenantId, tenantId), isNull(alerts.groupId)))
    .orderBy(desc(alerts.lastAt))
    .limit(200);
  const out = new Map<string, { present: number; total: number; sources: Set<string> }>();
  for (const key of keys) {
    const present = recent.filter((r) => Boolean(r.attributes[key]));
    out.set(key, {
      present: present.length,
      total: recent.length,
      sources: new Set(present.map((r) => r.sourceId)),
    });
  }
  return out;
}

/** The people and schedules a quick path can page. */
export async function quickTargets(tx: Tx, tenantId: string) {
  const people = await tx
    .select({ id: members.id, name: members.name })
    .from(members)
    .where(and(eq(members.tenantId, tenantId), eq(members.status, "active")))
    .orderBy(members.name);
  const scheds = await tx
    .select({ id: schedules.id, name: schedules.name })
    .from(schedules)
    .where(and(eq(schedules.tenantId, tenantId), eq(schedules.status, "published")))
    .orderBy(schedules.name);
  return { people, schedules: scheds };
}
