/**
 * The Opsgenie migration's background work: an inventory being read, an
 * alert history being archived. The screen starts both and advances them
 * while it can; this sweep picks up any run whose lease has lapsed — the
 * page was closed, the web process restarted — and carries on from the
 * cursor stored after the last page. One run at a time, a bounded slice
 * each tick.
 */
import { listLiveTenants } from "@openincident/db";
import { sweepMigrations } from "@openincident/migrate-opsgenie";

export const MIGRATE_QUEUE = "migrate-opsgenie";

export async function migrateSweep(): Promise<void> {
  const tenants = (await listLiveTenants()).map((t) => t.id);
  const n = await sweepMigrations(tenants, 50_000);
  if (n) console.log(`[${MIGRATE_QUEUE}] ${n} run(s) advanced`);
}
