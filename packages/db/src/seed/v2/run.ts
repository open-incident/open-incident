/**
 * Replays the V2 demo parts on one workspace, without the rest of the seed:
 *   pnpm --filter @openincident/db exec tsx src/seed/v2/run.ts --tenant v2 [--part atlas-core]
 */
import { eq, sql } from "drizzle-orm";
import { adminClient } from "../../provision";
import { tenants } from "../../schema/directory";
import { seedV2 } from "./index";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const slug = arg("tenant") ?? "v2";
const part = arg("part");
const { db, end } = adminClient();
try {
  const [t] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (!t) throw new Error(`no workspace "${slug}"`);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${t.id}, true)`);
    await seedV2(tx, t.id, part);
  });
  console.log(`V2 demo rows ${part ? `(${part}) ` : ""}in place on "${slug}".`);
} finally {
  await end();
}
process.exit(0);
