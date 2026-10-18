/**
 * Reads of Atlas's state — CONTRACT shared by the engine and the screens.
 *
 * Owner: atlas-core (may extend and optimise; must keep these signatures).
 * Readers: atlas-ui (incident Atlas tab, review queue, service card, insights
 * tab, alert badge, home banner…), and through atlas-ui's components every
 * module. Everything here reads the real tables of
 * packages/db/src/schema/atlas.ts — nothing is simulated: an empty table is
 * an empty answer.
 */
import "server-only";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import {
  atlasActions,
  atlasNotifyPrefs,
  atlasSettings,
  autonomyEvents,
  incidents,
  investigations,
  serviceAutonomy,
  services,
  withTenant,
  type AtlasNotifyMode,
} from "@openincident/db";
import { effectiveLevel, nextLevelCriteria } from "./levels";

export type AtlasActionRow = typeof atlasActions.$inferSelect;

export async function getAtlasSettings(tenantId: string) {
  const [row] = await withTenant(tenantId, (tx) =>
    tx.select().from(atlasSettings).where(eq(atlasSettings.tenantId, tenantId)).limit(1),
  );
  return row ?? null;
}

export type ServiceAutonomyView = {
  serviceId: string;
  key: string;
  name: string | null;
  level: number;
  cap: number | null;
  effective: number;
  incidentsSeen: number;
  gradedRuns: number;
  rightPct: number | null;
  backtestPct: number | null;
  proposalsOk: number;
  l3FixesOk: number;
  lastMissAt: Date | null;
  changedAt: Date | null;
  reason: string | null;
  next: ReturnType<typeof nextLevelCriteria>;
};

function view(
  s: { id: string; key: string; name: string | null },
  a: typeof serviceAutonomy.$inferSelect | null,
): ServiceAutonomyView {
  const base = {
    level: a?.level ?? 0,
    incidentsSeen: a?.incidentsSeen ?? 0,
    gradedRuns: a?.gradedRuns ?? 0,
    rightPct: a?.rightPct ?? null,
    backtestPct: a?.backtestPct ?? null,
    proposalsOk: a?.proposalsOk ?? 0,
    l3FixesOk: a?.l3FixesOk ?? 0,
    lastMissAt: a?.lastMissAt ?? null,
  };
  return {
    serviceId: s.id,
    key: s.key,
    name: s.name,
    ...base,
    cap: a?.cap ?? null,
    effective: effectiveLevel(base.level, a?.cap),
    changedAt: a?.changedAt ?? null,
    reason: a?.reason ?? null,
    next: nextLevelCriteria(base),
  };
}

/** Every service with its level — a service with no row is at L0. */
export async function listServiceAutonomy(tenantId: string): Promise<ServiceAutonomyView[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        s: { id: services.id, key: services.key, name: services.name },
        a: serviceAutonomy,
      })
      .from(services)
      .leftJoin(serviceAutonomy, eq(serviceAutonomy.serviceId, services.id))
      .where(eq(services.tenantId, tenantId))
      .orderBy(services.key),
  );
  return rows.map((r) => view(r.s, r.a));
}

export async function getServiceAutonomy(
  tenantId: string,
  serviceId: string,
): Promise<ServiceAutonomyView | null> {
  const [r] = await withTenant(tenantId, (tx) =>
    tx
      .select({
        s: { id: services.id, key: services.key, name: services.name },
        a: serviceAutonomy,
      })
      .from(services)
      .leftJoin(serviceAutonomy, eq(serviceAutonomy.serviceId, services.id))
      .where(and(eq(services.tenantId, tenantId), eq(services.id, serviceId)))
      .limit(1),
  );
  return r ? view(r.s, r.a) : null;
}

/** The ladder's history for a service, newest first. */
export async function autonomyHistory(tenantId: string, serviceId: string, limit = 20) {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(autonomyEvents)
      .where(and(eq(autonomyEvents.tenantId, tenantId), eq(autonomyEvents.serviceId, serviceId)))
      .orderBy(desc(autonomyEvents.createdAt))
      .limit(limit),
  );
}

/** What Atlas did on an incident, in order. */
export async function listAtlasActions(
  tenantId: string,
  incidentId: string,
): Promise<AtlasActionRow[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(atlasActions)
      .where(and(eq(atlasActions.tenantId, tenantId), eq(atlasActions.incidentId, incidentId)))
      .orderBy(atlasActions.at),
  );
}

/** Incidents Atlas resolved alone since a moment — the home banner. */
export async function resolvedAloneSince(tenantId: string, since: Date): Promise<number> {
  const [r] = await withTenant(tenantId, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(investigations)
      .innerJoin(incidents, eq(incidents.id, investigations.incidentId))
      .where(
        and(
          eq(investigations.tenantId, tenantId),
          eq(investigations.resolvedAlone, true),
          gte(incidents.resolvedAt, since),
        ),
      ),
  );
  return r?.n ?? 0;
}

/** Autonomous resolutions nobody has read yet — the "✦ Resolved by Atlas" tab count. */
export async function reviewCount(tenantId: string): Promise<number> {
  const [r] = await withTenant(tenantId, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(investigations)
      .where(
        and(
          eq(investigations.tenantId, tenantId),
          eq(investigations.resolvedAlone, true),
          eq(investigations.reviewState, "pending"),
        ),
      ),
  );
  return r?.n ?? 0;
}

export type AlertAtlasState =
  | { state: "on_it"; incidentId: string; waiting: AtlasActionRow | null }
  | { state: "alone"; incidentId: string }
  | { state: "told"; incidentId: string; told: string | null };

/**
 * What Atlas is doing about each alert — the "✦ Atlas on it" / "✦ by Atlas
 * alone" / "✦ by Atlas · Thomas told" badges. One query for a whole list.
 */
export async function alertAtlasStates(
  tenantId: string,
  alertIncidents: Array<{ alertId: string; incidentId: string | null }>,
): Promise<Map<string, AlertAtlasState>> {
  const ids = [...new Set(alertIncidents.map((a) => a.incidentId).filter((x): x is string => !!x))];
  const out = new Map<string, AlertAtlasState>();
  if (ids.length === 0) return out;
  const [invs, waiting] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx
        .select({
          incidentId: investigations.incidentId,
          status: investigations.status,
          paused: investigations.paused,
          resolvedAlone: investigations.resolvedAlone,
          resolvedAt: incidents.resolvedAt,
        })
        .from(investigations)
        .innerJoin(incidents, eq(incidents.id, investigations.incidentId))
        .where(and(eq(investigations.tenantId, tenantId), inArray(investigations.incidentId, ids))),
      tx
        .select()
        .from(atlasActions)
        .where(
          and(
            eq(atlasActions.tenantId, tenantId),
            inArray(atlasActions.incidentId, ids),
            eq(atlasActions.approvalState, "waiting"),
            isNull(atlasActions.undoneAt),
          ),
        ),
    ]),
  );
  const byIncident = new Map(invs.map((i) => [i.incidentId, i]));
  for (const a of alertIncidents) {
    if (!a.incidentId) continue;
    const inv = byIncident.get(a.incidentId);
    if (!inv) continue;
    if (inv.resolvedAt && inv.resolvedAlone)
      out.set(a.alertId, { state: "alone", incidentId: a.incidentId });
    else if (inv.resolvedAt) continue;
    else if (!inv.paused)
      out.set(a.alertId, {
        state: "on_it",
        incidentId: a.incidentId,
        waiting: waiting.find((w) => w.incidentId === a.incidentId) ?? null,
      });
  }
  return out;
}

export async function getNotifyMode(tenantId: string, memberId: string): Promise<AtlasNotifyMode> {
  const [r] = await withTenant(tenantId, (tx) =>
    tx
      .select({ mode: atlasNotifyPrefs.mode })
      .from(atlasNotifyPrefs)
      .where(and(eq(atlasNotifyPrefs.tenantId, tenantId), eq(atlasNotifyPrefs.memberId, memberId)))
      .limit(1),
  );
  return r?.mode ?? "summary";
}
