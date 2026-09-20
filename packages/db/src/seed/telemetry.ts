/**
 * Demo telemetry — a handful of traces, so the screens are not empty.
 *
 * Only when the module is installed. An instance without ClickHouse must seed
 * exactly as it does today, and the telemetry screens must keep saying the
 * module is absent rather than showing rows from nowhere.
 *
 * What is written is deliberately small and deliberately real: one healthy
 * request path, one that fails at the database, and the logs that carry the
 * same trace ids. Enough to see a waterfall and the correlation, not enough to
 * pretend the demo workspace is under load — a seed that invents a thousand
 * spans teaches the reader to distrust every number on the screen.
 */
import { randomUUID } from "node:crypto";
import { clickhouse, telemetryInstalled } from "@openincident/telemetry";

const SERVICES = [
  { name: "checkout-api", stack: "nodejs" },
  { name: "payments-worker", stack: "go" },
  { name: "orders-db", stack: "" },
];

function hex(bytes: number): string {
  return Array.from(
    { length: bytes * 2 },
    () => "0123456789abcdef"[Math.floor(Math.random() * 16)],
  ).join("");
}

function at(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString().replace("T", " ").replace("Z", "");
}

/** Far enough out that the demo survives a week of TTL merges. */
const RETENTION = new Date(Date.now() + 30 * 86_400_000)
  .toISOString()
  .slice(0, 19)
  .replace("T", " ");

type SpanSeed = {
  service: string;
  name: string;
  kind: "server" | "client" | "internal";
  offsetMs: number;
  durationMs: number;
  error?: boolean;
  http?: number;
};

const JOURNEYS: Array<{ minutesAgo: number; spans: SpanSeed[]; log: string; severity: number }> = [
  {
    minutesAgo: 4,
    severity: 9,
    log: "checkout completed in 61 ms",
    spans: [
      {
        service: "checkout-api",
        name: "GET /checkout",
        kind: "server",
        offsetMs: 0,
        durationMs: 61,
        http: 200,
      },
      { service: "orders-db", name: "SELECT orders", kind: "client", offsetMs: 6, durationMs: 41 },
    ],
  },
  {
    minutesAgo: 11,
    severity: 17,
    log: "charge failed: card declined",
    spans: [
      {
        service: "payments-worker",
        name: "POST /charge",
        kind: "server",
        offsetMs: 0,
        durationMs: 402,
        error: true,
        http: 500,
      },
      {
        service: "payments-worker",
        name: "stripe.charge",
        kind: "client",
        offsetMs: 12,
        durationMs: 380,
        error: true,
      },
    ],
  },
  {
    minutesAgo: 19,
    severity: 9,
    log: "checkout completed in 48 ms",
    spans: [
      {
        service: "checkout-api",
        name: "GET /checkout",
        kind: "server",
        offsetMs: 0,
        durationMs: 48,
        http: 200,
      },
      { service: "orders-db", name: "SELECT orders", kind: "client", offsetMs: 4, durationMs: 30 },
    ],
  },
];

export async function seedTelemetry(tenantId: string): Promise<number> {
  if (!telemetryInstalled()) return 0;
  const ch = clickhouse();
  const ids = new Map(SERVICES.map((s) => [s.name, randomUUID()]));

  const spans: Record<string, unknown>[] = [];
  const logs: Record<string, unknown>[] = [];

  for (const journey of JOURNEYS) {
    const traceId = hex(16);
    const base = journey.minutesAgo * 60_000;
    let rootSpanId = "";
    journey.spans.forEach((s, i) => {
      const spanId = hex(8);
      if (i === 0) rootSpanId = spanId;
      spans.push({
        tenant_id: tenantId,
        service_id: ids.get(s.service) ?? randomUUID(),
        service_name: s.service,
        environment: "production",
        service_version: "2.31.0",
        start_ts: at(base - s.offsetMs),
        end_ts: at(base - s.offsetMs - s.durationMs),
        duration_ns: s.durationMs * 1_000_000,
        trace_id: traceId,
        span_id: spanId,
        parent_span_id: i === 0 ? "" : rootSpanId,
        name: s.name,
        kind: s.kind,
        status_code: s.error ? "error" : "ok",
        status_message: s.error ? "card declined" : "",
        http_method: s.http ? "GET" : "",
        http_route: s.http ? "/checkout" : "",
        http_status_code: s.http ?? 0,
        db_system: s.service === "orders-db" ? "postgresql" : "",
        rpc_service: "",
        peer_service: "",
        attributes: {},
        resource_attributes: {
          "telemetry.sdk.language": SERVICES.find((x) => x.name === s.service)?.stack ?? "",
        },
        events: [],
        links: [],
        has_exception: Boolean(s.error),
        sampled_ratio: 1,
        retention_at: RETENTION,
      });
    });
    logs.push({
      tenant_id: tenantId,
      service_id: ids.get(journey.spans[0]!.service) ?? randomUUID(),
      service_name: journey.spans[0]!.service,
      environment: "production",
      ts: at(base),
      observed_ts: at(base),
      severity_number: journey.severity,
      severity_text: journey.severity >= 17 ? "ERROR" : "INFO",
      body: journey.log,
      trace_id: traceId,
      span_id: rootSpanId,
      scope_name: "app",
      attributes: {},
      resource_attributes: {},
      retention_at: RETENTION,
    });
  }

  await ch.insert({ table: "otel_spans", format: "JSONEachRow", values: spans });
  await ch.insert({ table: "otel_logs", format: "JSONEachRow", values: logs });
  await ch.command({ query: "SYSTEM FLUSH ASYNC INSERT QUEUE" });
  return spans.length + logs.length;
}
