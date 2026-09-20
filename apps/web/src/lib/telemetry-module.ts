/**
 * Where a collector should send its OTLP — the address, not a guess at it.
 *
 * The ingestion service is a separate process (D23), so its public address is
 * not the product's: in development it answers on :4318, and in production it
 * sits behind the proxy on a hostname the operator chose. Deriving it from the
 * workspace host printed an address nothing served, which on an onboarding
 * screen is worse than printing nothing — somebody copies it and spends the
 * afternoon on a connection refused.
 *
 * So the operator states it in `TELEMETRY_PUBLIC_ORIGIN`, as §15.3 asks. Unset,
 * the screen falls back to the conventional `otlp.<host>` shape and the
 * install steps say to set it.
 */
export function telemetryInstalled(): boolean {
  return Boolean(process.env.CLICKHOUSE_URL?.trim());
}

export function otlpEndpoints(host: string): { grpc: string; http: string } {
  const origin = process.env.TELEMETRY_PUBLIC_ORIGIN?.trim().replace(/\/$/, "");
  if (origin) {
    return { grpc: origin.replace(/^https?:\/\//, ""), http: origin };
  }
  return { grpc: `otlp.${host}:4317`, http: `https://otlp.${host}` };
}
