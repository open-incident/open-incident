/**
 * Services — what the product runs, as it learns they exist.
 *
 * Nothing is declared here. A service appears the first time a signal names it
 * (an alert label, a monitor, later a span) and waits in "seen in traffic"
 * until someone gives it an owner. That single click is the whole configuration:
 * from then on, an alert naming the service pages the owner team's policy, and
 * no rule and no schema were needed to get there.
 */

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  alerts,
  escalationPaths,
  incidents,
  members,
  monitors,
  services,
  teamMembers,
  teams,
  type Tx,
} from "@openincident/db";

export type ServiceRow = {
  id: string;
  key: string;
  name: string | null;
  ownerTeamId: string | null;
  ownerTeamName: string | null;
  labels: Record<string, string>;
  confirmed: boolean;
  seenIn: string[];
  lastSeenAt: Date | null;
  incidents90d: number;
  /** Worst state among the monitors watching it — the dot on the row. */
  state: "online" | "degraded" | "offline" | "unknown";
};

/**
 * Records that a signal named this service.
 *
 * Idempotent and cheap: it is called on every ingested alert, so it writes the
 * name once and then only moves `last_seen_at` and the places it was seen.
 */
export async function observeService(
  tx: Tx,
  tenantId: string,
  key: string,
  seenIn: string,
  now = new Date(),
): Promise<string | null> {
  const clean = key.trim().toLowerCase();
  if (!clean || clean.length > 120) return null;
  const [row] = await tx
    .insert(services)
    .values({ tenantId, key: clean, seenIn: [seenIn], lastSeenAt: now })
    .onConflictDoUpdate({
      target: [services.tenantId, services.key],
      set: {
        lastSeenAt: now,
        updatedAt: now,
        // Keeps the list of places short and stable: a set, capped.
        seenIn: sql`(
          select coalesce(jsonb_agg(distinct v), '[]'::jsonb)
          from (
            select jsonb_array_elements_text(${services.seenIn}) as v
            union select ${seenIn}
            limit 12
          ) s
        )`,
      },
    })
    .returning({ id: services.id });
  return row?.id ?? null;
}

/** Every service, with its owner, its recent incidents and the state of its monitors. */
export async function listServices(tx: Tx, tenantId: string): Promise<ServiceRow[]> {
  const rows = await tx
    .select({
      id: services.id,
      key: services.key,
      name: services.name,
      ownerTeamId: services.ownerTeamId,
      ownerTeamName: teams.name,
      labels: services.labels,
      confirmed: services.confirmed,
      seenIn: services.seenIn,
      lastSeenAt: services.lastSeenAt,
    })
    .from(services)
    .leftJoin(teams, eq(teams.id, services.ownerTeamId))
    .where(eq(services.tenantId, tenantId))
    .orderBy(desc(services.confirmed), asc(services.key));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const counts = await tx
    .select({ serviceId: incidents.serviceId, n: sql<number>`count(*)`.mapWith(Number) })
    .from(incidents)
    .where(
      and(
        eq(incidents.tenantId, tenantId),
        inArray(incidents.serviceId, ids),
        sql`${incidents.declaredAt} >= ${since.toISOString()}::timestamptz`,
      ),
    )
    .groupBy(incidents.serviceId);
  const byService = new Map(counts.map((c) => [c.serviceId, c.n]));

  const mons = await tx
    .select({ serviceId: monitors.serviceId, state: monitors.state })
    .from(monitors)
    .where(and(eq(monitors.tenantId, tenantId), inArray(monitors.serviceId, ids)));
  const worst = new Map<string, ServiceRow["state"]>();
  const RANK = { offline: 3, degraded: 2, online: 1 } as const;
  for (const m of mons) {
    if (!m.serviceId) continue;
    if (m.state !== "offline" && m.state !== "degraded" && m.state !== "online") continue;
    const cur = worst.get(m.serviceId);
    if (!cur || cur === "unknown" || RANK[m.state] > RANK[cur as keyof typeof RANK])
      worst.set(m.serviceId, m.state);
  }

  return rows.map((r) => ({
    ...r,
    incidents90d: byService.get(r.id) ?? 0,
    state: worst.get(r.id) ?? "unknown",
  }));
}

export type OwnerSuggestion = { teamId: string; teamName: string; why: string; count: number };

/**
 * Which team most likely owns a service nobody has claimed.
 *
 * Read from what actually happened: the team whose members acknowledged the
 * most alerts naming this service. It is a suggestion, never an assignment,
 * and when nothing was acknowledged there is no suggestion at all — a guess
 * with no evidence behind it is worse than an empty space.
 */
export async function ownerSuggestions(
  tx: Tx,
  tenantId: string,
  serviceKeys: string[],
): Promise<Map<string, OwnerSuggestion>> {
  const out = new Map<string, OwnerSuggestion>();
  if (serviceKeys.length === 0) return out;
  const rows = await tx
    .select({
      service: sql<string>`lower(${alerts.attributes} ->> 'service')`,
      teamId: teamMembers.teamId,
      teamName: teams.name,
      n: sql<number>`count(*)`.mapWith(Number),
    })
    .from(alerts)
    .innerJoin(members, eq(members.id, alerts.ackedByMemberId))
    .innerJoin(teamMembers, eq(teamMembers.memberId, members.id))
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(
      and(
        eq(alerts.tenantId, tenantId),
        sql`lower(${alerts.attributes} ->> 'service') = any(${serviceKeys})`,
      ),
    )
    .groupBy(sql`lower(${alerts.attributes} ->> 'service')`, teamMembers.teamId, teams.name)
    .orderBy(desc(sql`count(*)`));
  for (const r of rows) {
    if (!r.service || out.has(r.service)) continue;
    out.set(r.service, {
      teamId: r.teamId,
      teamName: r.teamName,
      why: "ack",
      count: r.n,
    });
  }
  return out;
}

/** The teams a service can be handed to, with the policy each one pages. */
export async function listTeams(tx: Tx, tenantId: string) {
  return tx
    .select({
      id: teams.id,
      name: teams.name,
      policyPathId: teams.policyPathId,
      policyName: escalationPaths.name,
      chatChannel: teams.chatChannel,
    })
    .from(teams)
    .leftJoin(escalationPaths, eq(escalationPaths.id, teams.policyPathId))
    .where(eq(teams.tenantId, tenantId))
    .orderBy(asc(teams.name));
}

export async function getService(tx: Tx, tenantId: string, id: string) {
  const [row] = await tx
    .select({
      id: services.id,
      key: services.key,
      name: services.name,
      ownerTeamId: services.ownerTeamId,
      ownerTeamName: teams.name,
      ownerPolicyName: escalationPaths.name,
      ownerChannel: teams.chatChannel,
      labels: services.labels,
      confirmed: services.confirmed,
      seenIn: services.seenIn,
      firstSeenAt: services.firstSeenAt,
      lastSeenAt: services.lastSeenAt,
    })
    .from(services)
    .leftJoin(teams, eq(teams.id, services.ownerTeamId))
    .leftJoin(escalationPaths, eq(escalationPaths.id, teams.policyPathId))
    .where(and(eq(services.tenantId, tenantId), eq(services.id, id)));
  if (!row) return null;

  const since7 = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const since90 = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const [alertStats] = await tx
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      paged: sql<number>`count(*) filter (where ${alerts.escalationId} is not null)`.mapWith(
        Number,
      ),
    })
    .from(alerts)
    .where(
      and(
        eq(alerts.tenantId, tenantId),
        sql`lower(${alerts.attributes} ->> 'service') = ${row.key}`,
        sql`${alerts.firstAt} >= ${since7.toISOString()}::timestamptz`,
      ),
    );
  const incidentRows = await tx
    .select({ number: incidents.number, name: incidents.name })
    .from(incidents)
    .where(
      and(
        eq(incidents.tenantId, tenantId),
        eq(incidents.serviceId, row.id),
        sql`${incidents.declaredAt} >= ${since90.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(desc(incidents.declaredAt))
    .limit(6);
  const monitorRows = await tx
    .select({
      id: monitors.id,
      name: monitors.name,
      state: monitors.state,
      lastLatencyMs: monitors.lastLatencyMs,
    })
    .from(monitors)
    .where(and(eq(monitors.tenantId, tenantId), eq(monitors.serviceId, row.id)))
    .orderBy(asc(monitors.name));

  return {
    ...row,
    alerts7d: alertStats?.total ?? 0,
    alertsPaged7d: alertStats?.paged ?? 0,
    incidents: incidentRows,
    monitors: monitorRows,
  };
}

export type ServiceDetail = NonNullable<Awaited<ReturnType<typeof getService>>>;
