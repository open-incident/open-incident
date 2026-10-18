/**
 * Reads the Atlas screens need beyond `@/lib/atlas/queries` — owner: atlas-ui.
 * Every figure comes from the rows of packages/db/src/schema/atlas.ts and the
 * investigation they belong to; nothing is simulated.
 */
import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import {
  alerts,
  atlasActions,
  escalations,
  incidents,
  investigations,
  members,
  notificationDeliveries,
  services,
  severities,
  teams,
  withTenant,
} from "@openincident/db";
import { getTenantFromHeaders } from "@/lib/tenant";
import { investigationAccess } from "@/lib/investigations";
import {
  getAtlasSettings,
  getServiceAutonomy,
  listAtlasActions,
  type AtlasActionRow,
  type ServiceAutonomyView,
} from "@/lib/atlas/queries";

export type InvestigationRow = typeof investigations.$inferSelect;

/** Is Atlas there at all on this instance, for this workspace? */
export async function atlasAvailable(): Promise<boolean> {
  const tenant = await getTenantFromHeaders();
  if (!tenant) return false;
  return (await investigationAccess(tenant)).ok;
}

/** Display names of the members a journal mentions. */
export async function memberNames(
  tenantId: string,
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (want.length === 0) return new Map();
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(and(eq(members.tenantId, tenantId), inArray(members.id, want))),
  );
  return new Map(rows.map((r) => [r.id, r.name]));
}

export type AtlasRun = {
  inv: InvestigationRow | null;
  actions: AtlasActionRow[];
  autonomy: ServiceAutonomyView | null;
  names: Map<string, string>;
  killSwitch: boolean;
  capPerRunEur: number | null;
};

/** One incident's run: the investigation, its journal, the service's ladder. */
export async function loadRun(tenantId: string, incidentId: string): Promise<AtlasRun> {
  const [inc] = await withTenant(tenantId, (tx) =>
    tx
      .select({ serviceId: incidents.serviceId })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, incidentId))),
  );
  const serviceId = inc?.serviceId ?? null;
  const [[inv], actions, autonomy, settings] = await Promise.all([
    withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(investigations)
        .where(
          and(eq(investigations.tenantId, tenantId), eq(investigations.incidentId, incidentId)),
        ),
    ),
    listAtlasActions(tenantId, incidentId),
    serviceId ? getServiceAutonomy(tenantId, serviceId) : Promise.resolve(null),
    getAtlasSettings(tenantId),
  ]);
  const names = await memberNames(tenantId, [
    inv?.gradedByMemberId,
    ...(inv?.notes ?? []).map((n) => n.memberId),
    ...actions.flatMap((a) => [a.decidedByMemberId, a.approvedByMemberId, a.undoneByMemberId]),
  ]);
  return {
    inv: inv ?? null,
    actions,
    autonomy,
    names,
    killSwitch: settings?.killSwitch ?? false,
    capPerRunEur: settings?.capPerRunEur ?? null,
  };
}

/**
 * Who was told, per incident. At level 3 Atlas pages while it acts and says
 * so in its journal ("Paged Thomas Moreau"); otherwise the first page a
 * person received for the incident. At level 4 nobody is, unless it stops.
 */
export async function firstToldOf(
  tenantId: string,
  incidentIds: string[],
): Promise<Map<string, { name: string; at: Date }>> {
  const out = new Map<string, { name: string; at: Date }>();
  if (incidentIds.length === 0) return out;
  const [paged, rows] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx
        .select({
          incidentId: atlasActions.incidentId,
          at: atlasActions.at,
          payload: atlasActions.payload,
        })
        .from(atlasActions)
        .where(
          and(
            eq(atlasActions.tenantId, tenantId),
            inArray(atlasActions.incidentId, incidentIds),
            sql`${atlasActions.payload}->'text'->>'key' = 'atlas.j.paged'`,
          ),
        )
        .orderBy(asc(atlasActions.at)),
      tx
        .select({
          incidentId: escalations.incidentId,
          alertIncidentId: alerts.incidentId,
          name: members.name,
          at: notificationDeliveries.createdAt,
        })
        .from(notificationDeliveries)
        .innerJoin(escalations, eq(escalations.id, notificationDeliveries.escalationId))
        .leftJoin(alerts, eq(alerts.id, escalations.alertId))
        .innerJoin(members, eq(members.id, notificationDeliveries.memberId))
        .where(
          and(
            eq(notificationDeliveries.tenantId, tenantId),
            eq(notificationDeliveries.kind, "escalation"),
            eq(escalations.isTest, false),
            or(
              inArray(escalations.incidentId, incidentIds),
              inArray(alerts.incidentId, incidentIds),
            ),
          ),
        )
        .orderBy(asc(notificationDeliveries.createdAt)),
    ]),
  );
  for (const p of paged) {
    const params = (p.payload?.text as { params?: { member?: unknown } } | undefined)?.params;
    if (p.incidentId && typeof params?.member === "string" && !out.has(p.incidentId))
      out.set(p.incidentId, { name: params.member, at: p.at });
  }
  for (const r of rows) {
    const id = r.incidentId ?? r.alertIncidentId;
    if (id && !out.has(id)) out.set(id, { name: r.name, at: r.at });
  }
  return out;
}

/** The name of the team that owns a service, if any. */
export async function ownerTeamOf(tenantId: string, serviceId: string): Promise<string | null> {
  const [r] = await withTenant(tenantId, (tx) =>
    tx
      .select({ name: teams.name })
      .from(services)
      .innerJoin(teams, eq(teams.id, services.ownerTeamId))
      .where(and(eq(services.tenantId, tenantId), eq(services.id, serviceId))),
  );
  return r?.name ?? null;
}

export type ReviewCard = {
  investigationId: string;
  incidentId: string;
  number: number;
  name: string;
  summary: string | null;
  severity: string | null;
  serviceKey: string | null;
  serviceId: string | null;
  levelAtStart: number | null;
  declaredAt: Date;
  resolvedAt: Date;
  alone: boolean;
  reviewState: "pending" | "ok" | "miss" | "reopened" | null;
  costEur: number;
  tokensTotal: number;
  citations: InvestigationRow["citations"];
  findings: InvestigationRow["findings"];
  topHypothesisId: string | null;
  hypotheses: InvestigationRow["hypotheses"];
  actions: AtlasActionRow[];
  told: { name: string; at: Date } | null;
};

/**
 * The review queue: every incident Atlas resolved itself (level 3, a person
 * told while it acted, or level 4, nobody paged) that nobody has read yet,
 * then the ones read in the last three days, kept visible and quieter with their
 * verdict. The engine marks such a run for review (`review_state`).
 */
export async function reviewQueue(tenantId: string): Promise<ReviewCard[]> {
  const weekAgo = new Date(Date.now() - 3 * 86_400_000);
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        inv: investigations,
        number: incidents.number,
        name: incidents.name,
        incSummary: incidents.summary,
        declaredAt: incidents.declaredAt,
        resolvedAt: incidents.resolvedAt,
        serviceId: incidents.serviceId,
        serviceKey: services.key,
        severity: severities.name,
      })
      .from(investigations)
      .innerJoin(incidents, eq(incidents.id, investigations.incidentId))
      .leftJoin(services, eq(services.id, incidents.serviceId))
      .leftJoin(severities, eq(severities.id, incidents.severityId))
      .where(
        and(
          eq(investigations.tenantId, tenantId),
          isNotNull(investigations.reviewState),
          isNotNull(incidents.resolvedAt),
          or(eq(investigations.reviewState, "pending"), gte(incidents.resolvedAt, weekAgo)),
        ),
      )
      .orderBy(desc(incidents.resolvedAt))
      .limit(60),
  );
  const kept = rows;
  const ids = kept.map((r) => r.inv.incidentId);
  const [acts, told] = await Promise.all([
    ids.length
      ? withTenant(tenantId, (tx) =>
          tx
            .select()
            .from(atlasActions)
            .where(and(eq(atlasActions.tenantId, tenantId), inArray(atlasActions.incidentId, ids)))
            .orderBy(asc(atlasActions.at)),
        )
      : Promise.resolve([] as AtlasActionRow[]),
    firstToldOf(tenantId, ids),
  ]);
  const cards = kept.map<ReviewCard>((r) => ({
    investigationId: r.inv.id,
    incidentId: r.inv.incidentId,
    number: r.number,
    name: r.name,
    summary: r.incSummary ?? r.inv.summary?.whatsGoingOn ?? null,
    severity: r.severity,
    serviceKey: r.serviceKey,
    serviceId: r.serviceId,
    levelAtStart: r.inv.levelAtStart,
    declaredAt: r.declaredAt,
    resolvedAt: r.resolvedAt!,
    alone: r.inv.resolvedAlone,
    reviewState: r.inv.reviewState ?? "pending",
    costEur: r.inv.costEur,
    tokensTotal: r.inv.tokensTotal,
    citations: r.inv.citations,
    findings: r.inv.findings,
    topHypothesisId: r.inv.summary?.topHypothesisId ?? null,
    hypotheses: r.inv.hypotheses,
    actions: acts.filter((a) => a.incidentId === r.inv.incidentId),
    told: told.get(r.inv.incidentId) ?? null,
  }));
  // Pending first (newest first), then what was already read.
  return [
    ...cards.filter((c) => c.reviewState === "pending"),
    ...cards.filter((c) => c.reviewState !== "pending"),
  ];
}

/**
 * The incidents Atlas resolved itself since a moment — the home banner's
 * lines: at level 4 with nobody paged, at level 3 with a person told.
 */
export async function resolvedByAtlasSince(tenantId: string, since: Date) {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        incidentId: incidents.id,
        number: incidents.number,
        serviceKey: services.key,
        declaredAt: incidents.declaredAt,
        resolvedAt: incidents.resolvedAt,
        reviewState: investigations.reviewState,
        alone: investigations.resolvedAlone,
      })
      .from(investigations)
      .innerJoin(incidents, eq(incidents.id, investigations.incidentId))
      .leftJoin(services, eq(services.id, incidents.serviceId))
      .where(
        and(
          eq(investigations.tenantId, tenantId),
          isNotNull(investigations.reviewState),
          gte(incidents.resolvedAt, since),
        ),
      )
      .orderBy(asc(incidents.resolvedAt)),
  );
  return rows;
}
