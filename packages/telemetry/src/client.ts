/**
 * The column store, and the rule that the product runs without it.
 *
 * Telemetry lives in ClickHouse; configuration and state stay in PostgreSQL
 * (spec 15 §15.2). The separation is not decoration: an instance that never
 * enables the module must start, serve incidents and page people with no
 * ClickHouse anywhere, and every screen that would need one says so instead of
 * drawing an empty chart.
 *
 * So there is exactly one place that answers "is it there?", and nothing else
 * in the codebase reads `CLICKHOUSE_URL` directly.
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";

export type TelemetryConfig = {
  url: string;
  username: string;
  password: string;
  database: string;
};

/**
 * The instance's ClickHouse, or null when the module is not installed.
 *
 * A URL alone is enough: the username, password and database have the same
 * defaults as the compose service, so a developer who starts the profile has
 * nothing else to write.
 */
export function telemetryConfig(env = process.env): TelemetryConfig | null {
  const url = env.CLICKHOUSE_URL?.trim();
  if (!url) return null;
  return {
    url,
    username: env.CLICKHOUSE_USER?.trim() || "openincident",
    password: env.CLICKHOUSE_PASSWORD ?? "openincident",
    database: env.CLICKHOUSE_DATABASE?.trim() || "openincident",
  };
}

export function telemetryInstalled(env = process.env): boolean {
  return telemetryConfig(env) !== null;
}

let shared: ClickHouseClient | null = null;

/**
 * The shared client. Kept as a module singleton for the same reason the
 * Postgres pool is: a web process that opened one connection per request would
 * spend its life in handshakes.
 */
export function clickhouse(env = process.env): ClickHouseClient {
  if (shared) return shared;
  const cfg = telemetryConfig(env);
  if (!cfg) throw new Error("telemetry is not configured on this instance (CLICKHOUSE_URL)");
  shared = createClient({
    url: cfg.url,
    username: cfg.username,
    password: cfg.password,
    database: cfg.database,
    clickhouse_settings: {
      // Inserts arrive in small batches from several ingestion replicas;
      // letting the server group them is what keeps the part count sane.
      // We still wait for the acknowledgement, because an ingestion endpoint
      // that answers 200 before the row is durable is lying.
      async_insert: 1,
      wait_for_async_insert: 1,
    },
  });
  return shared;
}

/** For tests and short-lived CLIs: drop the singleton and close its sockets. */
export async function closeClickhouse(): Promise<void> {
  if (!shared) return;
  await shared.close();
  shared = null;
}
