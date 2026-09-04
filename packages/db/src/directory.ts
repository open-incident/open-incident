/**
 * Reads of the `directory` schema — the resolution that happens BEFORE a tenant
 * context exists. Functions, not a client: the apps get exactly these queries.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "./client";
import { apiKeyLookup, statusSnapshots, tenants, type Tenant } from "./schema/directory";

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
export async function registerApiKeyLookup(keyHash: string, tenantId: string): Promise<void> {
  await db.delete(apiKeyLookup).where(eq(apiKeyLookup.keyHash, keyHash));
  await db.insert(apiKeyLookup).values({ keyHash, tenantId }).onConflictDoNothing();
}
export async function forgetApiKeyLookup(keyHash: string): Promise<void> {
  await db.delete(apiKeyLookup).where(eq(apiKeyLookup.keyHash, keyHash));
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
