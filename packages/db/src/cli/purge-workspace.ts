/**
 * Purges a workspace — the erasure the product promises. Runs as the database
 * owner (DATABASE_ADMIN_URL) and proves what it did: every `app` table is
 * counted for the tenant afterwards, the directory rows are counted, the
 * object-storage prefix is listed, and the command fails if anything remains.
 *
 *   pnpm workspace:purge -- --slug acme --yes
 *
 * Sign-in accounts are shared across workspaces of an instance: a person's
 * account goes only when no other workspace still lists their email.
 */
import { isValidSlug } from "@openincident/config";
import { purgeWorkspace } from "../purge";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const slug = arg("slug");
const yes = process.argv.includes("--yes");
if (!slug || !isValidSlug(slug)) {
  console.error("Usage: pnpm workspace:purge -- --slug <slug> --yes");
  process.exit(2);
}
if (!yes) {
  console.error(`Refusing without --yes: this erases workspace "${slug}" and its files for good.`);
  process.exit(2);
}

const report = await purgeWorkspace(slug, { log: (line) => console.log(line) });
if (!report) {
  console.error(`No workspace "${slug}".`);
  process.exit(1);
}
console.log("");
console.log(
  `Rows deleted: ${report.rowsDeleted} across ${report.tablesTouched} tables · accounts removed: ${report.accountsRemoved} · objects deleted: ${report.objectsDeleted ?? "storage not configured"}`,
);
if (report.remaining.length === 0) {
  console.log(
    `Verified: nothing remains for "${slug}" (${report.tablesChecked} tables, directory, storage prefix).`,
  );
  process.exit(0);
}
console.error(`NOT CLEAN — ${report.remaining.length} leftover(s):`);
for (const r of report.remaining) console.error(`  ${r}`);
process.exit(1);
