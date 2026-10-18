/**
 * Who hears about what Atlas did alone, and when (spec delta §15.5): each
 * member chose "Silent push right away", "A summary at 09:00" (the default)
 * or "Nothing". The people concerned are the members of the team that owns
 * the service; a service nobody owns concerns the workspace's owners and
 * admins.
 */
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import {
  atlasNotifyPrefs,
  incidents,
  investigations,
  members,
  services,
  teamMembers,
  workspaces,
  withTenant,
  type AtlasNotifyMode,
  type Tx,
} from "@openincident/db";

export async function concernedMembersTx(
  tx: Tx,
  tenantId: string,
  serviceIds: string[],
): Promise<string[]> {
  const ids = [...new Set(serviceIds)];
  const owners = ids.length
    ? await tx
        .select({ team: services.ownerTeamId })
        .from(services)
        .where(and(eq(services.tenantId, tenantId), inArray(services.id, ids)))
    : [];
  const teams = owners.map((o) => o.team).filter((t): t is string => Boolean(t));
  const out = new Set<string>();
  if (teams.length) {
    const rows = await tx
      .select({ m: teamMembers.memberId })
      .from(teamMembers)
      .where(inArray(teamMembers.teamId, teams));
    rows.forEach((r) => out.add(r.m));
  }
  if (owners.some((o) => !o.team) || out.size === 0) {
    const admins = await tx
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          eq(members.tenantId, tenantId),
          eq(members.status, "active"),
          inArray(members.role, ["owner", "admin"]),
        ),
      );
    admins.forEach((a) => out.add(a.id));
  }
  if (out.size === 0) return [];
  const active = await tx
    .select({ id: members.id })
    .from(members)
    .where(and(inArray(members.id, [...out]), eq(members.status, "active")));
  return active.map((a) => a.id);
}

export async function modesTx(
  tx: Tx,
  tenantId: string,
  memberIds: string[],
): Promise<Map<string, AtlasNotifyMode>> {
  const rows = memberIds.length
    ? await tx
        .select({ m: atlasNotifyPrefs.memberId, mode: atlasNotifyPrefs.mode })
        .from(atlasNotifyPrefs)
        .where(
          and(
            eq(atlasNotifyPrefs.tenantId, tenantId),
            inArray(atlasNotifyPrefs.memberId, memberIds),
          ),
        )
    : [];
  const map = new Map<string, AtlasNotifyMode>(memberIds.map((id) => [id, "summary"]));
  rows.forEach((r) => map.set(r.m, r.mode));
  return map;
}

export type ResolutionLine = {
  number: number;
  name: string;
  service: string | null;
  resolvedAt: Date;
  alone: boolean;
  serviceId: string | null;
};

/** What Atlas resolved itself since a moment, newest first. */
export async function resolutionsSinceTx(
  tx: Tx,
  tenantId: string,
  since: Date,
  serviceIds?: string[],
): Promise<ResolutionLine[]> {
  const rows = await tx
    .select({
      number: incidents.number,
      name: incidents.name,
      service: services.key,
      serviceId: incidents.serviceId,
      resolvedAt: incidents.resolvedAt,
      alone: investigations.resolvedAlone,
    })
    .from(investigations)
    .innerJoin(incidents, eq(incidents.id, investigations.incidentId))
    .leftJoin(services, eq(services.id, incidents.serviceId))
    .where(
      and(
        eq(investigations.tenantId, tenantId),
        isNotNull(investigations.reviewState),
        isNotNull(incidents.resolvedAt),
        gte(incidents.resolvedAt, since),
        serviceIds && serviceIds.length ? inArray(incidents.serviceId, serviceIds) : undefined,
      ),
    )
    .orderBy(desc(incidents.resolvedAt))
    .limit(50);
  return rows.map((r) => ({ ...r, resolvedAt: r.resolvedAt!, service: r.service ?? null }));
}

/** The local hour in a time zone. */
export function localHour(now: Date, timeZone: string): number {
  try {
    return Number(
      new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone }).format(now),
    );
  } catch {
    return now.getUTCHours();
  }
}

/**
 * The members whose 09:00 summary is due now: it is between 09:00 and 09:59
 * in the workspace's time zone, they chose the summary, and they have not had
 * one in the last 20 hours. Each comes with what to tell them.
 */
export async function dueSummaries(
  tenantId: string,
  now = new Date(),
): Promise<Array<{ memberId: string; lines: ResolutionLine[] }>> {
  return withTenant(tenantId, async (tx) => {
    const [ws] = await tx
      .select({ tz: workspaces.timezone })
      .from(workspaces)
      .where(eq(workspaces.tenantId, tenantId));
    if (localHour(now, ws?.tz ?? "UTC") !== 9) return [];
    const since = new Date(now.getTime() - 24 * 3_600_000);
    const all = await resolutionsSinceTx(tx, tenantId, since);
    if (all.length === 0) return [];
    const concerned = await concernedMembersTx(
      tx,
      tenantId,
      all.map((l) => l.serviceId).filter((x): x is string => Boolean(x)),
    );
    const modes = await modesTx(tx, tenantId, concerned);
    const prefs = concerned.length
      ? await tx
          .select({ m: atlasNotifyPrefs.memberId, last: atlasNotifyPrefs.lastSummaryAt })
          .from(atlasNotifyPrefs)
          .where(inArray(atlasNotifyPrefs.memberId, concerned))
      : [];
    const last = new Map(prefs.map((p) => [p.m, p.last]));
    const out: Array<{ memberId: string; lines: ResolutionLine[] }> = [];
    for (const m of concerned) {
      if (modes.get(m) !== "summary") continue;
      const l = last.get(m);
      if (l && now.getTime() - l.getTime() < 20 * 3_600_000) continue;
      const lines = all.filter((x) => !l || x.resolvedAt > l);
      if (lines.length) out.push({ memberId: m, lines });
    }
    return out;
  });
}

export async function markSummarySent(tenantId: string, memberId: string, at = new Date()) {
  await withTenant(tenantId, (tx) =>
    tx
      .insert(atlasNotifyPrefs)
      .values({ tenantId, memberId, mode: "summary", lastSummaryAt: at })
      .onConflictDoUpdate({
        target: atlasNotifyPrefs.memberId,
        set: { lastSummaryAt: at },
      }),
  );
}

/**
 * Incidents Atlas resolved that a person reopened since (outside the review
 * queue): the run is marked reopened and the service goes back to L1.
 */
export async function reopenedAfterAtlasTx(tx: Tx, tenantId: string) {
  return tx
    .select({
      inv: investigations.id,
      incidentId: investigations.incidentId,
      serviceId: incidents.serviceId,
    })
    .from(investigations)
    .innerJoin(incidents, eq(incidents.id, investigations.incidentId))
    .where(
      and(
        eq(investigations.tenantId, tenantId),
        inArray(investigations.reviewState, ["pending", "ok"]),
        inArray(incidents.phase, ["triage", "active"]),
        sql`true`,
      ),
    );
}
