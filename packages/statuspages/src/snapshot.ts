/**
 * The projection: everything the public page shows, as one JSON document per
 * page, written to directory.status_snapshots on every change.
 */
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import {
  componentImpactHistory,
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
    state: string;
    uptime90: number;
    ticks: string[];
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
    overall: overallState(comps.map((c) => c.state)),
    components: comps.map((c) => {
      const mine = history
        .filter((h) => h.componentId === c.id)
        .map((h) => ({ state: h.state, fromAt: h.fromAt, toAt: h.toAt }));
      return {
        id: c.id,
        name: c.name,
        groupName: c.groupName,
        state: c.state,
        uptime90: computeUptime(mine, since90, now),
        ticks: dayTicks(mine, 30, now),
      };
    }),
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
