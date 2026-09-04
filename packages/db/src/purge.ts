/**
 * The workspace purge, as a function so a test can run it against a throwaway
 * tenant and check the report — "verified, not promised".
 */
import { eq, sql } from "drizzle-orm";
import { deletePrefix, listKeys, storageConfigured, tenantPrefix } from "@openincident/storage";
import { adminClient } from "./provision";
import { authUsers } from "./schema/auth";
import { apiKeyLookup, statusSnapshots, tenants } from "./schema/directory";

export type PurgeReport = {
  tenantId: string;
  tablesTouched: number;
  tablesChecked: number;
  rowsDeleted: number;
  accountsRemoved: number;
  objectsDeleted: number | null;
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
    rowsDeleted += dir1.length + dir2.length;
    log(`  directory: ${dir1.length} key lookup(s), ${dir2.length} status snapshot(s)`);

    let accountsRemoved = 0;
    for (const email of emails) {
      const gone = await db
        .delete(authUsers)
        .where(eq(authUsers.email, email))
        .returning({ id: authUsers.id });
      accountsRemoved += gone.length;
    }
    log(
      `  auth: ${accountsRemoved} account(s) removed (${emails.length} email(s) only in this workspace)`,
    );

    let objectsDeleted: number | null = null;
    if (storageConfigured()) {
      objectsDeleted = await deletePrefix(tenantPrefix(tenantId));
      log(`  storage: ${objectsDeleted} object(s) under ${tenantPrefix(tenantId)}`);
    } else {
      log("  storage: not configured on this instance — nothing to delete, nothing to list");
    }

    // Verification — counted, listed, not assumed.
    const remaining: string[] = [];
    for (const table of tables) {
      const [row] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from app.${sql.identifier(table)} where tenant_id = ${tenantId}`,
      );
      if (row && Number(row.n) > 0) remaining.push(`app.${table}: ${row.n} row(s)`);
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
      objectsDeleted,
      remaining,
    };
  } finally {
    await end();
  }
}
