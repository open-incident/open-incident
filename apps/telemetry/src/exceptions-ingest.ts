/**
 * Writing the exceptions a batch of logs and spans contained.
 *
 * Extraction happens at ingestion, not at read: the fingerprint is the key a
 * group is built on, and recomputing it later — after improving the
 * algorithm, say — would split a group in two and reset a history somebody was
 * watching. The recipe is frozen with the row.
 *
 * Two sources, per §15.4 step 5. A span carries them as `exception` events
 * with semantic-convention attributes, which is what an instrumented framework
 * produces. A log carries one when it has `exception.stacktrace`, or when its
 * body plainly is a stack trace — which is what a logger writing `err.stack`
 * produces, and that is most of them.
 */
import { clickhouse } from "@openincident/telemetry";
import type { Caller } from "./auth";
import { retentionAt, scrub, scrubAttributes, type Settings } from "./shared";
import { exceptionFromAttributes, type ExceptionEvent } from "./exceptions";
import type { DecodedLog, DecodedSpan } from "./otlp";

type Row = {
  event: ExceptionEvent;
  serviceName: string;
  serviceId: string;
  environment: string;
  release: string;
  ts: string;
};

export function fromLogs(
  logs: DecodedLog[],
  serviceOf: (name: string) => string,
  pinned: string | null,
): Row[] {
  const out: Row[] = [];
  for (const l of logs) {
    const service = pinned ?? l.serviceName;
    if (!service) continue;
    const event = exceptionFromAttributes(l.attributes, l.body, {
      traceId: l.traceId,
      spanId: l.spanId,
    });
    if (!event) continue;
    out.push({
      event,
      serviceName: service,
      serviceId: serviceOf(service),
      environment: l.environment,
      release: l.resourceAttributes["service.version"] ?? "",
      ts: l.ts,
    });
  }
  return out;
}

export function fromSpans(
  spans: DecodedSpan[],
  serviceOf: (name: string) => string,
  pinned: string | null,
): Row[] {
  const out: Row[] = [];
  for (const s of spans) {
    if (!s.hasException) continue;
    const service = pinned ?? s.serviceName;
    if (!service) continue;
    // The span's own attributes stand in for the event's: the decoder keeps
    // `hasException` but not the event bodies, and an instrumented span that
    // recorded an exception copies the semantic attributes onto itself in
    // every SDK we have seen. When it did not, the status message is still a
    // better group key than nothing.
    const event = exceptionFromAttributes(s.attributes, s.statusMessage || s.name, {
      traceId: s.traceId,
      spanId: s.spanId,
    });
    if (!event) continue;
    out.push({
      event,
      serviceName: service,
      serviceId: serviceOf(service),
      environment: s.environment,
      release: s.serviceVersion,
      ts: s.startTs,
    });
  }
  return out;
}

export async function writeExceptions(
  caller: Caller,
  settings: Settings,
  rows: Row[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const until = retentionAt(settings.retentionLogsDays);
  await clickhouse().insert({
    table: "otel_exceptions",
    format: "JSONEachRow",
    values: rows.map((r) => ({
      tenant_id: caller.tenantId,
      service_id: r.serviceId,
      service_name: r.serviceName,
      environment: r.environment,
      release: r.release,
      ts: r.ts,
      fingerprint: r.event.fingerprint,
      type: r.event.type,
      // Scrubbed like everything else: a stack trace is one of the likeliest
      // places for a connection string to appear.
      message: scrub(r.event.message, settings.scrubRules),
      stacktrace: scrub(r.event.stacktrace, settings.scrubRules),
      // A named tuple arrives as an object, not as an array: ClickHouse reads
      // `Tuple(function String, …)` from JSON by field name, and a positional
      // array is refused outright. The same applies to a span's `events` and a
      // metric's `exemplars` the day they stop being empty.
      frames: r.event.frames,
      trace_id: r.event.traceId,
      span_id: r.event.spanId,
      attributes: scrubAttributes({}, settings.scrubRules),
      retention_at: until,
    })),
  });
  return rows.length;
}
