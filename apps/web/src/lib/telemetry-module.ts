/**
 * Is the telemetry module installed on this instance?
 *
 * Logs, traces and metrics need a store this instance may not run. Rather than
 * draw empty charts, every telemetry surface asks this and says
 * "not installed on this instance" when the answer is no — the same honesty the
 * AI screens apply when no provider is configured.
 *
 * The signal is the store's address: a module without its ClickHouse is not
 * installed, whatever any flag claims.
 */
export function telemetryInstalled(): boolean {
  return Boolean(process.env.CLICKHOUSE_URL?.trim());
}

/** Where a collector should send its OTLP, once the module is installed. */
export function otlpEndpoints(host: string): { grpc: string; http: string } {
  return { grpc: `otlp.${host}:4317`, http: `https://otlp.${host}/v1` };
}
