/** Read side of the alerts: the list with its counts and the detail with everything the page shows. */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  alertEvents,
  alertPriorities,
  alertRoutes,
  alertSources,
  alerts,
  escalationEvents,
  escalationPathVersions,
  escalationPaths,
  escalations,
  incidents,
  members,
  type Tx,
} from "@openincident/db";

export type AlertListRow = {
  id: string;
  title: string;
  status: "firing" | "resolved";
  sourceName: string;
  sourceKind: string;
  priority: string | null;
  priorityRank: number | null;
  service: string | null;
  groupCount: number;
  lastAt: Date;
  incidentNumber: number | null;
  acked: boolean;
  testMode: boolean;
};

export async function listAlerts(
  tx: Tx,
  tenantId: string,
  view: "firing" | "resolved" | "all",
  sourceId?: string | null,
): Promise<AlertListRow[]> {
  const rows = await tx
    .select({
      a: alerts,
      sourceName: alertSources.name,
      sourceKind: alertSources.kind,
      incidentNumber: incidents.number,
      priorityRank: alertPriorities.rank,
    })
    .from(alerts)
    .innerJoin(alertSources, eq(alertSources.id, alerts.sourceId))
    .leftJoin(incidents, eq(incidents.id, alerts.incidentId))
    .leftJoin(alertPriorities, eq(alertPriorities.id, alerts.priorityId))
    .where(
      and(
        eq(alerts.tenantId, tenantId),
        isNull(alerts.groupId),
        view === "all" ? undefined : eq(alerts.status, view),
        sourceId ? eq(alerts.sourceId, sourceId) : undefined,
      ),
    )
    .orderBy(desc(alerts.lastAt))
    .limit(200);
  return rows.map(({ a, sourceName, sourceKind, incidentNumber, priorityRank }) => ({
    id: a.id,
    title: a.title,
    status: a.status,
    sourceName,
    sourceKind,
    priority: a.attributes.priority ?? null,
    priorityRank: priorityRank ?? null,
    service: a.attributes.service ?? null,
    groupCount: a.groupCount,
    lastAt: a.lastAt,
    incidentNumber: incidentNumber ?? null,
    acked: Boolean(a.ackedAt),
    testMode: a.testMode,
  }));
}

export async function alertCounts(
  tx: Tx,
  tenantId: string,
): Promise<{
  firing: number;
  resolved: number;
  bySource: Array<{ id: string; name: string; kind: string; count: number }>;
}> {
  const [c] = await tx
    .select({
      firing:
        sql<number>`count(*) filter (where ${alerts.status} = 'firing' and ${alerts.groupId} is null)`.mapWith(
          Number,
        ),
      resolved:
        sql<number>`count(*) filter (where ${alerts.status} = 'resolved' and ${alerts.groupId} is null)`.mapWith(
          Number,
        ),
    })
    .from(alerts)
    .where(eq(alerts.tenantId, tenantId));
  const bySource = await tx
    .select({
      id: alertSources.id,
      name: alertSources.name,
      kind: alertSources.kind,
      count: sql<number>`count(${alerts.id})`.mapWith(Number),
    })
    .from(alertSources)
    .leftJoin(alerts, and(eq(alerts.sourceId, alertSources.id), isNull(alerts.groupId)))
    .where(eq(alertSources.tenantId, tenantId))
    .groupBy(alertSources.id)
    .orderBy(desc(sql`count(${alerts.id})`), asc(alertSources.name));
  return { firing: c?.firing ?? 0, resolved: c?.resolved ?? 0, bySource };
}

export async function getAlert(tx: Tx, tenantId: string, id: string) {
  const [row] = await tx
    .select()
    .from(alerts)
    .where(and(eq(alerts.tenantId, tenantId), eq(alerts.id, id)));
  if (!row) return null;
  const [source] = await tx.select().from(alertSources).where(eq(alertSources.id, row.sourceId));
  const [route] = row.routeId
    ? await tx.select().from(alertRoutes).where(eq(alertRoutes.id, row.routeId))
    : [];
  const [priority] = row.priorityId
    ? await tx.select().from(alertPriorities).where(eq(alertPriorities.id, row.priorityId))
    : [];
  const [incident] = row.incidentId
    ? await tx
        .select({
          id: incidents.id,
          number: incidents.number,
          name: incidents.name,
          phase: incidents.phase,
        })
        .from(incidents)
        .where(eq(incidents.id, row.incidentId))
    : [];
  const grouped = await tx
    .select({ id: alerts.id, title: alerts.title, firstAt: alerts.firstAt, status: alerts.status })
    .from(alerts)
    .where(eq(alerts.groupId, row.id))
    .orderBy(asc(alerts.firstAt));
  const events = await tx
    .select()
    .from(alertEvents)
    .where(eq(alertEvents.alertId, row.id))
    .orderBy(asc(alertEvents.occurredAt));
  const [esc] = row.escalationId
    ? await tx.select().from(escalations).where(eq(escalations.id, row.escalationId))
    : [];
  let escalation: null | {
    id: string;
    status: string;
    pathName: string;
    level: number;
    levelMembers: string[];
    urgency: string;
    enteredAt: Date | null;
    nextTickAt: Date | null;
    ackTimeoutMinutes: number | null;
    ackedByName: string | null;
    ackedAt: Date | null;
    ackedChannel: string | null;
    isLast: boolean;
  } = null;
  if (esc) {
    const [path] = await tx
      .select({ name: escalationPaths.name })
      .from(escalationPaths)
      .where(eq(escalationPaths.id, esc.pathId));
    const [version] = await tx
      .select({ graph: escalationPathVersions.graph })
      .from(escalationPathVersions)
      .where(eq(escalationPathVersions.id, esc.pathVersionId));
    const levels = version?.graph.nodes.filter((n) => n.kind === "level") ?? [];
    const node = version?.graph.nodes.find((n) => n.id === esc.currentNodeId);
    const levelIndex = node ? levels.findIndex((l) => l.id === node.id) : -1;
    const [lastNotified] = await tx
      .select()
      .from(escalationEvents)
      .where(
        and(
          eq(escalationEvents.escalationId, esc.id),
          inArray(escalationEvents.kind, ["notified", "retried"]),
        ),
      )
      .orderBy(desc(escalationEvents.occurredAt))
      .limit(1);
    const [acker] = esc.ackedByMemberId
      ? await tx
          .select({ name: members.name })
          .from(members)
          .where(eq(members.id, esc.ackedByMemberId))
      : [];
    escalation = {
      id: esc.id,
      status: esc.status,
      pathName: path?.name ?? "—",
      level: levelIndex + 1,
      levelMembers: Array.isArray(lastNotified?.payload.members)
        ? (lastNotified!.payload.members as string[])
        : [],
      urgency: esc.urgency,
      enteredAt: esc.nodeEnteredAt,
      nextTickAt: esc.nextTickAt,
      ackTimeoutMinutes: node?.kind === "level" ? node.ackTimeoutMinutes : null,
      ackedByName: acker?.name ?? null,
      ackedAt: esc.ackedAt,
      ackedChannel: esc.ackedChannel,
      isLast: node?.kind === "level" ? node.next === null : false,
    };
  }
  const [acker] = row.ackedByMemberId
    ? await tx
        .select({ name: members.name })
        .from(members)
        .where(eq(members.id, row.ackedByMemberId))
    : [];
  return {
    row,
    source: source!,
    route: route ?? null,
    priority: priority ?? null,
    incident: incident ?? null,
    grouped,
    events,
    escalation,
    ackedByName: acker?.name ?? null,
  };
}

export type AlertDetail = NonNullable<Awaited<ReturnType<typeof getAlert>>>;
