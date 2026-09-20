/**
 * ClickHouse migrations — a second journal, next to the Postgres one.
 *
 * Deliberately not drizzle: the two stores have different lifecycles and
 * different failure modes, and a single journal would make an instance without
 * ClickHouse look like an instance with migrations pending. The files in
 * `sql/` are applied once each, in name order, and recorded in
 * `schema_migrations`.
 *
 * ClickHouse has no transactional DDL, so a file that fails halfway leaves
 * what it already created. Every statement is therefore written to be
 * re-runnable (`IF NOT EXISTS`), and a failed migration is simply not recorded
 * — the next run picks it up from the start.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clickhouse } from "./client";

const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "sql");

/** One statement per `;` at end of line — enough for DDL, and it keeps the files readable. */
function statements(sql: string): string[] {
  return sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(--[^\n]*\n?)*$/.test(s));
}

export type MigrationResult = { applied: string[]; skipped: string[] };

export async function migrateClickhouse(dir = SQL_DIR): Promise<MigrationResult> {
  const ch = clickhouse();
  await ch.command({
    query: `CREATE TABLE IF NOT EXISTS schema_migrations (
      name String,
      applied_at DateTime DEFAULT now()
    ) ENGINE = MergeTree ORDER BY name`,
  });

  const done = new Set<string>();
  const rows = await ch.query({
    query: "SELECT name FROM schema_migrations",
    format: "JSONEachRow",
  });
  for (const r of await rows.json<{ name: string }>()) done.add(r.name);

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const out: MigrationResult = { applied: [], skipped: [] };

  for (const file of files) {
    if (done.has(file)) {
      out.skipped.push(file);
      continue;
    }
    for (const query of statements(readFileSync(join(dir, file), "utf8"))) {
      await ch.command({ query });
    }
    await ch.insert({
      table: "schema_migrations",
      values: [{ name: file }],
      format: "JSONEachRow",
    });
    out.applied.push(file);
  }
  return out;
}
