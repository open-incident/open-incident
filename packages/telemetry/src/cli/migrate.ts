/** Applies the ClickHouse migrations. `pnpm --filter @openincident/telemetry ch:migrate`. */
import { closeClickhouse, telemetryInstalled } from "../client";
import { migrateClickhouse } from "../migrate";

if (!telemetryInstalled()) {
  console.error("CLICKHOUSE_URL is not set: the telemetry module is not installed here.");
  process.exit(1);
}

const { applied, skipped } = await migrateClickhouse();
console.log(
  applied.length
    ? `ClickHouse: applied ${applied.length} migration(s) — ${applied.join(", ")}`
    : "ClickHouse: already up to date",
);
if (skipped.length) console.log(`  (${skipped.length} already applied)`);
await closeClickhouse();
