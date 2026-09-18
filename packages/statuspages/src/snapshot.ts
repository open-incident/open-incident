/**
 * The projection: everything the public page shows, as one JSON document per
 * page, written to directory.status_snapshots on every change.
 */
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import {
  componentImpactHistory,
  monitorDays,
  monitors,
  statusPageComponents,
  statusPageIncidentUpdates,
  statusPageIncidents,
  statusPageMaintenanceUpdates,
  statusPageMaintenances,
  statusPageSubscribers,
  statusPages,
  type Tx,
  upsertStatusSnapshot,
  withTenant,
  workspaces,
} from "@openincident/db";
import { computeUptime, dayTicks, overallState } from "./uptime";

export type Snapshot = {
  page: {
    id: string;
    name: string;
    slug: string;
    customDomain: string | null;
    customDomainVerified: boolean;
    locale: string;
    accentColor: string;
    logoUrl: string | null;
    visibility: "public" | "internal";
    noindex: boolean;
    privacyUrl: string | null;
    legalUrl: string | null;
  };
  overall: string;
  components: Array<{
    id: string;
    name: string;
    groupName: string | null;
    /** The five component states, plus `unknown` when a tracked monitor has never answered. */
    state: string;
    /** Null when nothing is known yet — a monitor without a single rolled-up day. */
    uptime90: number | null;
    /** One per day, oldest first; `none` is a day without any measurement. */
    ticks: string[];
    /** Where the state comes from: a monitor decides it, or a human does. */
    source: "monitor" | "manual";
    monitorId: string | null;
    monitorName: string | null;
  }>;
  incidents: Array<{
    id: string;
    title: string;
    status: string;
    impact: string;
    components: string[];
    startedAt: string;
    resolvedAt: string | null;
    updates: Array<{ status: string; body: string; at: string }>;
  }>;
  maintenances: Array<{
    id: string;
    title: string;
    body: string;
    status: string;
    components: string[];
    startAt: string;
    endAt: string;
    updates: Array<{ status: string; body: string; at: string }>;
  }>;
  subscribers: number;
  generatedAt: string;
};

const DAY = 86_400_000;

/**
 * What a monitor's own verdict says about the component tracking it. A monitor
 * that has never run, or that is paused, says `unknown`: the page states that
 * nothing is measured rather than painting a green it has not earned.
 */
const MONITOR_STATE: Record<string, string> = {
  online: "operational",
  degraded: "degraded",
  offline: "major_outage",
  paused: "unknown",
  waiting: "unknown",
};

/** The day keys the monitor bars are drawn on, oldest first, so gaps still line up. */
function dayKeys(n: number, now: Date): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--)
    out.push(new Date(now.getTime() - i * DAY).toISOString().slice(0, 10));
  return out;
}

export async function buildSnapshot(
  tx: Tx,
  tenantId: string,
  pageId: string,
  now = new Date(),
): Promise<Snapshot | null> {
  const [page] = await tx
    .select()
    .from(statusPages)
    .where(and(eq(statusPages.tenantId, tenantId), eq(statusPages.id, pageId)));
  if (!page) return null;
  const comps = await tx
    .select()
    .from(statusPageComponents)
    .where(eq(statusPageComponents.pageId, page.id))
    .orderBy(asc(statusPageComponents.position), asc(statusPageComponents.name));
  const since90 = new Date(now.getTime() - 90 * DAY);
  const history = comps.length
    ? await tx
        .select()
        .from(componentImpactHistory)
        .where(
          and(
            inArray(
              componentImpactHistory.componentId,
              comps.map((c) => c.id),
            ),
            gte(componentImpactHistory.fromAt, new Date(since90.getTime() - 31 * DAY)),
          ),
        )
    : [];
  // Components tracking a monitor read their state, uptime and bars off that
  // monitor's day rollup — never off the impact history a human writes.
  const monitorIds = [...new Set(comps.map((c) => c.monitorId).filter((x) => x !== null))];
  const tracked = monitorIds.length
    ? await tx
        .select({ id: monitors.id, name: monitors.name, state: monitors.state })
        .from(monitors)
        .where(and(eq(monitors.tenantId, tenantId), inArray(monitors.id, monitorIds)))
    : [];
  const rollup = monitorIds.length
    ? await tx
        .select()
        .from(monitorDays)
        .where(
          and(
            inArray(monitorDays.monitorId, monitorIds),
            gte(monitorDays.day, dayKeys(90, now)[0]!),
          ),
        )
    : [];
  const daysOf = new Map<string, Map<string, (typeof rollup)[number]>>();
  for (const d of rollup) {
    const mine = daysOf.get(d.monitorId) ?? new Map();
    mine.set(d.day, d);
    daysOf.set(d.monitorId, mine);
  }
  const barKeys = dayKeys(30, now);
  const monitorView = (id: string) => {
    const m = tracked.find((r) => r.id === id);
    const mine = daysOf.get(id);
    let up = 0;
    let total = 0;
    for (const d of mine?.values() ?? []) {
      up += d.onlineSeconds;
      total += d.onlineSeconds + d.degradedSeconds + d.offlineSeconds;
    }
    return {
      name: m?.name ?? null,
      state: MONITOR_STATE[m?.state ?? "waiting"] ?? "unknown",
      uptime90: total > 0 ? Math.round((up / total) * 10_000) / 100 : null,
      ticks: barKeys.map((k) => {
        const d = mine?.get(k);
        if (!d) return "none";
        if (d.offlineSeconds > 0) return "major_outage";
        if (d.degradedSeconds > 0) return "degraded";
        return "operational";
      }),
    };
  };
  const nameOf = new Map(comps.map((c) => [c.id, c.name]));
  const incidents = await tx
    .select()
    .from(statusPageIncidents)
    .where(
      and(eq(statusPageIncidents.pageId, page.id), gte(statusPageIncidents.startedAt, since90)),
    )
    .orderBy(desc(statusPageIncidents.startedAt))
    .limit(50);
  const updates = incidents.length
    ? await tx
        .select()
        .from(statusPageIncidentUpdates)
        .where(
          inArray(
            statusPageIncidentUpdates.statusPageIncidentId,
            incidents.map((i) => i.id),
          ),
        )
        .orderBy(desc(statusPageIncidentUpdates.publishedAt))
    : [];
  const maints = await tx
    .select()
    .from(statusPageMaintenances)
    .where(
      and(eq(statusPageMaintenances.pageId, page.id), gte(statusPageMaintenances.endAt, since90)),
    )
    .orderBy(desc(statusPageMaintenances.startAt))
    .limit(30);
  const mUpdates = maints.length
    ? await tx
        .select()
        .from(statusPageMaintenanceUpdates)
        .where(
          inArray(
            statusPageMaintenanceUpdates.maintenanceId,
            maints.map((m) => m.id),
          ),
        )
        .orderBy(desc(statusPageMaintenanceUpdates.publishedAt))
    : [];
  const [{ n } = { n: 0 }] = await tx
    .select({ n: statusPageSubscribers.id })
    .from(statusPageSubscribers)
    .where(and(eq(statusPageSubscribers.pageId, page.id)))
    .then((rows) => [{ n: rows.filter(() => true).length }]);
  const confirmed = await tx
    .select({ id: statusPageSubscribers.id, confirmedAt: statusPageSubscribers.confirmedAt })
    .from(statusPageSubscribers)
    .where(eq(statusPageSubscribers.pageId, page.id));
  void n;
  const [ws] = await tx
    .select({ branding: workspaces.branding })
    .from(workspaces)
    .where(eq(workspaces.tenantId, tenantId));
  // A maintenance under way is a human statement the monitor cannot make: the
  // component says "maintenance" rather than the outage the probe is seeing.
  const underMaintenance = new Set(
    maints.filter((m) => m.status === "in_progress").flatMap((m) => m.componentIds),
  );
  const components = comps.map((c) => {
    if (c.monitorId) {
      const v = monitorView(c.monitorId);
      return {
        id: c.id,
        name: c.name,
        groupName: c.groupName,
        state: underMaintenance.has(c.id) ? "maintenance" : v.state,
        uptime90: v.uptime90,
        ticks: v.ticks,
        source: "monitor" as const,
        monitorId: c.monitorId,
        monitorName: v.name,
      };
    }
    const mine = history
      .filter((h) => h.componentId === c.id)
      .map((h) => ({ state: h.state, fromAt: h.fromAt, toAt: h.toAt }));
    return {
      id: c.id,
      name: c.name,
      groupName: c.groupName,
      state: c.state as string,
      uptime90: computeUptime(mine, since90, now),
      ticks: dayTicks(mine, 30, now),
      source: "manual" as const,
      monitorId: null,
      monitorName: null,
    };
  });
  return {
    page: {
      id: page.id,
      name: page.name,
      slug: page.slug,
      customDomain: page.customDomain,
      customDomainVerified: Boolean(page.customDomainVerifiedAt),
      locale: page.locale,
      accentColor: page.accentColor,
      logoUrl: ws?.branding.logoUrl ?? null,
      visibility: page.visibility,
      noindex: page.noindex,
      privacyUrl: page.privacyUrl,
      legalUrl: page.legalUrl,
    },
    overall: overallState(components.map((c) => c.state)),
    components,
    incidents: incidents.map((i) => ({
      id: i.id,
      title: i.title,
      status: i.status,
      impact: i.impact,
      components: i.componentIds.map((id) => nameOf.get(id) ?? "").filter(Boolean),
      startedAt: i.startedAt.toISOString(),
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
      updates: updates
        .filter((u) => u.statusPageIncidentId === i.id)
        .map((u) => ({ status: u.status, body: u.body, at: u.publishedAt.toISOString() })),
    })),
    maintenances: maints.map((m) => ({
      id: m.id,
      title: m.title,
      body: m.body,
      status: m.status,
      components: m.componentIds.map((id) => nameOf.get(id) ?? "").filter(Boolean),
      startAt: m.startAt.toISOString(),
      endAt: m.endAt.toISOString(),
      updates: mUpdates
        .filter((u) => u.maintenanceId === m.id)
        .map((u) => ({ status: u.status, body: u.body, at: u.publishedAt.toISOString() })),
    })),
    subscribers: confirmed.filter((s) => s.confirmedAt).length,
    generatedAt: now.toISOString(),
  };
}

/** Rebuilds and stores the projection of one page. Never throws: a snapshot that fails is logged, the gesture that caused it is done. */
export async function refreshStatusSnapshot(tenantId: string, pageId: string): Promise<boolean> {
  try {
    const snap = await withTenant(tenantId, (tx) => buildSnapshot(tx, tenantId, pageId));
    if (!snap) return false;
    await upsertStatusSnapshot({
      pageId,
      tenantId,
      slug: snap.page.slug,
      customDomain: snap.page.customDomainVerified ? snap.page.customDomain : null,
      snapshot: snap as unknown as Record<string, unknown>,
    });
    return true;
  } catch (err) {
    console.error("[status] snapshot refresh failed:", err);
    return false;
  }
}

export async function refreshAllStatusSnapshots(tenantId: string): Promise<number> {
  const pages = await withTenant(tenantId, (tx) =>
    tx.select({ id: statusPages.id }).from(statusPages).where(eq(statusPages.tenantId, tenantId)),
  );
  let n = 0;
  for (const p of pages) if (await refreshStatusSnapshot(tenantId, p.id)) n++;
  return n;
}

/** The public address of a page: its verified custom domain, else its slug on the instance's status domain. */
export function statusPageUrl(page: {
  slug: string;
  customDomain: string | null;
  customDomainVerifiedAt?: Date | null;
  customDomainVerified?: boolean;
}): string {
  const verified = page.customDomainVerified ?? Boolean(page.customDomainVerifiedAt);
  if (page.customDomain && verified) return `https://${page.customDomain}`;
  const base = process.env.STATUS_BASE_DOMAIN ?? "status.localhost:3107";
  const proto = /localhost|127\.0\.0\.1/.test(base) ? "http" : "https";
  return `${proto}://${page.slug}.${base}`;
}
