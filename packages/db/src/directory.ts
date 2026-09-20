/**
 * Reads of the `directory` schema — the resolution that happens BEFORE a tenant
 * context exists. Functions, not a client: the apps get exactly these queries.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "./client";
import {
  apiKeyLookup,
  dashboardShare,
  statusSnapshots,
  rumAppLookup,
  telemetryKeyLookup,
  tenants,
  type Tenant,
} from "./schema/directory";

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const [row] = await db.select().from(tenants).where(eq(tenants.slug, slug));
  return row ?? null;
}

export async function getTenantById(id: string): Promise<Tenant | null> {
  const [row] = await db.select().from(tenants).where(eq(tenants.id, id));
  return row ?? null;
}

export async function getTenantByCustomDomain(host: string): Promise<Tenant | null> {
  const [row] = await db.select().from(tenants).where(eq(tenants.customDomain, host));
  return row ?? null;
}

/** Workspaces the worker sweeps — the ones that are alive. */
export async function listLiveTenants(): Promise<Tenant[]> {
  return db
    .select()
    .from(tenants)
    .where(inArray(tenants.status, ["active", "trial"]));
}

/** The workspace an API key belongs to — by the SHA-256 of the key, before any tenant context. */
export async function getTenantIdForApiKeyHash(keyHash: string): Promise<string | null> {
  const [row] = await db
    .select({ tenantId: apiKeyLookup.tenantId })
    .from(apiKeyLookup)
    .where(eq(apiKeyLookup.keyHash, keyHash));
  return row?.tenantId ?? null;
}

/**
 * Registers / forgets a key in the lookup — the application role's one write on
 * the directory. A key already known follows the latest registration: a Slack
 * workspace re-installed on another Open Incident workspace moves with it.
 */
/**
 * The directory row that lets a request find its workspace before any tenant
 * context exists.
 *
 * `on` takes the caller's transaction when there is one. Without it this took a
 * second connection from the pool while the caller still held the first, and a
 * process gets ten: ten callers doing that at once wait on each other for a
 * connection none of them will release. The same shape, in the status page
 * publish path, was measured hanging forever — no error, no timeout.
 */
export async function registerApiKeyLookup(
  keyHash: string,
  tenantId: string,
  on: Pick<typeof db, "delete" | "insert"> = db,
): Promise<void> {
  await on.delete(apiKeyLookup).where(eq(apiKeyLookup.keyHash, keyHash));
  await on.insert(apiKeyLookup).values({ keyHash, tenantId }).onConflictDoNothing();
}
export async function forgetApiKeyLookup(
  keyHash: string,
  on: Pick<typeof db, "delete"> = db,
): Promise<void> {
  await on.delete(apiKeyLookup).where(eq(apiKeyLookup.keyHash, keyHash));
}

/** The public snapshot of a status page, by host — what apps/status serves. */
export async function getStatusSnapshotForHost(
  host: string,
  baseDomain: string,
  defaultSlug?: string,
): Promise<typeof statusSnapshots.$inferSelect | null> {
  const h = host.toLowerCase();
  const base = baseDomain.toLowerCase();
  let slug: string | null = null;
  if (h === base) slug = defaultSlug ?? null;
  else if (h.endsWith(`.${base}`)) slug = h.slice(0, -(base.length + 1));
  if (slug && !slug.includes(".")) {
    const [row] = await db.select().from(statusSnapshots).where(eq(statusSnapshots.slug, slug));
    return row ?? null;
  }
  const [row] = await db.select().from(statusSnapshots).where(eq(statusSnapshots.customDomain, h));
  return row ?? null;
}

export async function upsertStatusSnapshot(input: {
  pageId: string;
  tenantId: string;
  slug: string;
  customDomain: string | null;
  snapshot: Record<string, unknown>;
}): Promise<void> {
  await db
    .insert(statusSnapshots)
    .values({ ...input, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: statusSnapshots.pageId,
      set: {
        slug: input.slug,
        customDomain: input.customDomain,
        snapshot: input.snapshot,
        updatedAt: new Date(),
      },
    });
}

export async function deleteStatusSnapshot(pageId: string): Promise<void> {
  await db.delete(statusSnapshots).where(eq(statusSnapshots.pageId, pageId));
}

export type TelemetryCaller = {
  tenantId: string;
  keyId: string;
  signals: string[];
  pinnedServiceName: string | null;
};

/**
 * The workspace behind an ingestion key, before any tenant context exists.
 *
 * One row, found by a unique digest — so "constant time" is a property of the
 * index rather than of a loop, and the list of valid keys is never held in
 * memory to be walked. A revoked or expired key resolves to nothing, which the
 * ingestion path reports as 401 and never as a silent drop.
 */
export async function resolveTelemetryKey(keyHash: string): Promise<TelemetryCaller | null> {
  const [row] = await db
    .select()
    .from(telemetryKeyLookup)
    .innerJoin(tenants, eq(tenants.id, telemetryKeyLookup.tenantId))
    .where(eq(telemetryKeyLookup.keyHash, keyHash));
  if (!row) return null;
  const k = row.telemetry_key_lookup;
  if (k.revoked) return null;
  if (k.expiresAt && k.expiresAt <= new Date()) return null;
  if (row.tenants.status === "suspended" || row.tenants.status === "deleting") return null;
  return {
    tenantId: k.tenantId,
    keyId: k.keyId,
    signals: k.signals,
    pinnedServiceName: k.pinnedServiceName,
  };
}

/** Mirrors an ingestion key into the lookup. Called wherever the key row is written. */
export async function registerTelemetryKey(
  entry: TelemetryCaller & { keyHash: string; expiresAt?: Date | null; revoked?: boolean },
  on: Pick<typeof db, "delete" | "insert"> = db,
): Promise<void> {
  await on.delete(telemetryKeyLookup).where(eq(telemetryKeyLookup.keyHash, entry.keyHash));
  await on.insert(telemetryKeyLookup).values({
    keyHash: entry.keyHash,
    tenantId: entry.tenantId,
    keyId: entry.keyId,
    signals: entry.signals,
    pinnedServiceName: entry.pinnedServiceName,
    revoked: entry.revoked ?? false,
    expiresAt: entry.expiresAt ?? null,
  });
}

export async function forgetTelemetryKey(
  keyHash: string,
  on: Pick<typeof db, "delete"> = db,
): Promise<void> {
  await on.delete(telemetryKeyLookup).where(eq(telemetryKeyLookup.keyHash, keyHash));
}

export type RumCaller = {
  tenantId: string;
  appId: string;
  allowedOrigins: string[];
  sampleRate: number;
  replayEnabled: boolean;
  replaySampleRate: number;
  replayUnmask: string[];
  mobileEnabled: boolean;
};

/**
 * The workspace behind a RUM application id, before any tenant context exists.
 *
 * Unlike every other resolver here, the identifier is **public**: it is shipped
 * in a page and anybody who loads the page can read it. So this returns the
 * origin list rather than treating the id as proof of anything, and the caller
 * decides — an event from an origin the workspace did not name is refused even
 * though the id was right. An application with no origins accepts nothing,
 * which is the safe reading of "somebody pasted this into a page before
 * thinking about it".
 */
export async function resolveRumApp(appId: string): Promise<RumCaller | null> {
  const [row] = await db
    .select()
    .from(rumAppLookup)
    .innerJoin(tenants, eq(tenants.id, rumAppLookup.tenantId))
    .where(eq(rumAppLookup.appId, appId));
  if (!row) return null;
  const a = row.rum_app_lookup;
  if (!a.active) return null;
  if (row.tenants.status === "suspended" || row.tenants.status === "deleting") return null;
  return {
    tenantId: a.tenantId,
    appId: a.appId,
    allowedOrigins: a.allowedOrigins,
    sampleRate: a.sampleRate,
    replayEnabled: a.replayEnabled,
    replaySampleRate: a.replaySampleRate,
    replayUnmask: a.replayUnmask,
    mobileEnabled: a.mobileEnabled,
  };
}

/** Mirrors a RUM application into the lookup. Called wherever the row is written. */
export async function registerRumApp(
  entry: RumCaller & { active?: boolean },
  on: Pick<typeof db, "delete" | "insert"> = db,
): Promise<void> {
  await on.delete(rumAppLookup).where(eq(rumAppLookup.appId, entry.appId));
  await on.insert(rumAppLookup).values({
    appId: entry.appId,
    tenantId: entry.tenantId,
    allowedOrigins: entry.allowedOrigins,
    sampleRate: entry.sampleRate,
    replayEnabled: entry.replayEnabled,
    replaySampleRate: entry.replaySampleRate,
    replayUnmask: entry.replayUnmask,
    mobileEnabled: entry.mobileEnabled,
    active: entry.active ?? true,
  });
}

export async function forgetRumApp(
  appId: string,
  on: Pick<typeof db, "delete"> = db,
): Promise<void> {
  await on.delete(rumAppLookup).where(eq(rumAppLookup.appId, appId));
}

/** The workspace behind a public dashboard link, before any session exists. */
export async function resolveDashboardShare(
  token: string,
): Promise<{ tenantId: string; dashboardId: string } | null> {
  const [row] = await db.select().from(dashboardShare).where(eq(dashboardShare.token, token));
  return row ? { tenantId: row.tenantId, dashboardId: row.dashboardId } : null;
}

export async function registerDashboardShare(
  token: string,
  tenantId: string,
  dashboardId: string,
): Promise<void> {
  await db.delete(dashboardShare).where(eq(dashboardShare.dashboardId, dashboardId));
  await db.insert(dashboardShare).values({ token, tenantId, dashboardId });
}

export async function forgetDashboardShare(dashboardId: string): Promise<void> {
  await db.delete(dashboardShare).where(eq(dashboardShare.dashboardId, dashboardId));
}
