/**
 * The workspace purge, as a function so a test can run it against a throwaway
 * tenant and check the report — "verified, not promised".
 */
import { eq, sql } from "drizzle-orm";
import { deletePrefix, listKeys, storageConfigured, tenantPrefix } from "@openincident/storage";
import { purgeTenant, telemetryInstalled } from "@openincident/telemetry";
import { adminClient } from "./provision";
import { authUsers } from "./schema/auth";
import { apiKeyLookup, statusSnapshots, telemetryKeyLookup, tenants } from "./schema/directory";

export type PurgeReport = {
  tenantId: string;
  tablesTouched: number;
  tablesChecked: number;
  rowsDeleted: number;
  accountsRemoved: number;
  /** Better Auth SSO providers removed — one per connection the workspace had. */
  ssoProvidersRemoved: number;
  objectsDeleted: number | null;
  /** Rows left in ClickHouse after the purge, or null when the module is absent. */
  telemetryLeft: number | null;
  remaining: string[];
};

export async function purgeWorkspace(
  slug: string,
  opts: { log?: (line: string) => void } = {},
): Promise<PurgeReport | null> {
  const log = opts.log ?? (() => {});
  const { db, end } = adminClient();
  try {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug));
    if (!tenant) return null;
    const tenantId = tenant.id;
    await db.update(tenants).set({ status: "deleting" }).where(eq(tenants.id, tenantId));

    // Every app table with a tenant_id column, whatever migrations added since.
    const tables = (
      await db.execute<{ table_name: string }>(sql`
        select table_name from information_schema.columns
        where table_schema = 'app' and column_name = 'tenant_id' order by table_name`)
    ).map((r) => r.table_name);

    // Emails whose account may go: members here, minus members elsewhere.
    const emails = (
      await db.execute<{ email: string }>(sql`
        select distinct m.email from app.members m
        where m.tenant_id = ${tenantId}
          and not exists (select 1 from app.members o where o.email = m.email and o.tenant_id <> ${tenantId})`)
    ).map((r) => r.email);

    /*
     * The SSO providers to remove, read **before** the app rows go.
     *
     * `auth.sso_provider` is Better Auth's half of an SSO connection and
     * carries no tenant column — the only link is `provider_id`, which lives
     * in `app.sso_connections`. Delete the app row first and the auth row is
     * unreachable for ever.
     *
     * It was, until this was written: a purged workspace left one provider
     * behind per connection, and the command still printed "Verified: nothing
     * remains" because the check only counted `app`, `directory` and storage.
     * Twenty of them had accumulated on one development instance.
     */
    const ssoProviderIds = (
      await db.execute<{ provider_id: string }>(sql`
        select provider_id from app.sso_connections where tenant_id = ${tenantId}`)
    ).map((r) => r.provider_id);

    let rowsDeleted = 0;
    let tablesTouched = 0;
    // Order does not matter: foreign keys inside the tenant cascade, and the
    // loop retries tables blocked by a restrict constraint until none is left.
    let pending = [...tables];
    for (let round = 0; pending.length > 0 && round < 6; round++) {
      const next: string[] = [];
      for (const table of pending) {
        try {
          const res = await db.execute(
            sql`delete from app.${sql.identifier(table)} where tenant_id = ${tenantId}`,
          );
          const n = Number((res as unknown as { count?: number }).count ?? 0);
          if (n > 0) {
            rowsDeleted += n;
            tablesTouched++;
            log(`  app.${table}: ${n} row(s)`);
          }
        } catch {
          next.push(table);
        }
      }
      pending = next;
    }
    for (const table of pending) log(`  app.${table}: could not delete (constraint)`);

    const dir1 = await db
      .delete(apiKeyLookup)
      .where(eq(apiKeyLookup.tenantId, tenantId))
      .returning({ k: apiKeyLookup.keyHash });
    const dir2 = await db
      .delete(statusSnapshots)
      .where(eq(statusSnapshots.tenantId, tenantId))
      .returning({ pageId: statusSnapshots.pageId });
    // The ingestion keys live outside the policies so a collector can be
    // resolved before a tenant context exists; they have to be swept here for
    // the same reason, or a purged workspace keeps accepting telemetry.
    const dir3 = await db
      .delete(telemetryKeyLookup)
      .where(eq(telemetryKeyLookup.tenantId, tenantId))
      .returning({ k: telemetryKeyLookup.keyHash });
    rowsDeleted += dir1.length + dir2.length + dir3.length;
    log(
      `  directory: ${dir1.length} key lookup(s), ${dir2.length} status snapshot(s), ${dir3.length} telemetry key(s)`,
    );

    let accountsRemoved = 0;
    for (const email of emails) {
      const gone = await db
        .delete(authUsers)
        .where(eq(authUsers.email, email))
        .returning({ id: authUsers.id });
      accountsRemoved += gone.length;
    }
    let ssoProvidersRemoved = 0;
    for (const providerId of ssoProviderIds) {
      const gone = await db.execute<{ id: string }>(sql`
        delete from auth.sso_provider where provider_id = ${providerId} returning id`);
      ssoProvidersRemoved += gone.length;
    }
    rowsDeleted += ssoProvidersRemoved;
    log(
      `  auth: ${accountsRemoved} account(s) removed (${emails.length} email(s) only in this workspace), ` +
        `${ssoProvidersRemoved} SSO provider(s)`,
    );

    let objectsDeleted: number | null = null;
    if (storageConfigured()) {
      objectsDeleted = await deletePrefix(tenantPrefix(tenantId));
      log(`  storage: ${objectsDeleted} object(s) under ${tenantPrefix(tenantId)}`);
    } else {
      log("  storage: not configured on this instance — nothing to delete, nothing to list");
    }

    // ClickHouse is a second store with its own deletion semantics, so it gets
    // its own step and its own count. A purge that erased Postgres and left a
    // month of spans behind would satisfy nothing and no regulator.
    let telemetryLeft: number | null = null;
    if (telemetryInstalled()) {
      telemetryLeft = await purgeTenant(tenantId);
      log(
        telemetryLeft === 0
          ? "  clickhouse: telemetry erased"
          : `  clickhouse: ${telemetryLeft} row(s) still present`,
      );
    } else {
      log("  clickhouse: module not installed — nothing to delete, nothing to list");
    }

    // Verification — counted, listed, not assumed.
    const remaining: string[] = [];
    for (const table of tables) {
      const [row] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from app.${sql.identifier(table)} where tenant_id = ${tenantId}`,
      );
      if (row && Number(row.n) > 0) remaining.push(`app.${table}: ${row.n} row(s)`);
    }
    for (const providerId of ssoProviderIds) {
      const [sp] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from auth.sso_provider where provider_id = ${providerId}`,
      );
      if (sp && Number(sp.n) > 0) remaining.push(`auth.sso_provider ${providerId}: ${sp.n}`);
    }
    const [lk] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from directory.api_key_lookup where tenant_id = ${tenantId}`,
    );
    if (lk && Number(lk.n) > 0) remaining.push(`directory.api_key_lookup: ${lk.n}`);
    const [ss] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from directory.status_snapshots where tenant_id = ${tenantId}`,
    );
    if (ss && Number(ss.n) > 0) remaining.push(`directory.status_snapshots: ${ss.n}`);
    if (storageConfigured()) {
      const left = await listKeys(tenantPrefix(tenantId));
      for (const k of left) remaining.push(`storage: ${k}`);
    }
    if (telemetryLeft && telemetryLeft > 0) remaining.push(`clickhouse: ${telemetryLeft} row(s)`);
    if (remaining.length === 0) {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
      log(`  directory.tenants: "${slug}" removed`);
    } else {
      log(`  directory.tenants: "${slug}" kept in status "deleting" because leftovers remain`);
    }
    return {
      tenantId,
      tablesTouched,
      tablesChecked: tables.length,
      rowsDeleted,
      accountsRemoved,
      ssoProvidersRemoved,
      objectsDeleted,
      telemetryLeft,
      remaining,
    };
  } finally {
    await end();
  }
}
