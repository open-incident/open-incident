/**
 * OTLP over protobuf — the encoding most collectors actually use.
 *
 * The JSON mapping was the honest half to ship first; this is the half that
 * makes "a collector plugged in five minutes" true, because `http/protobuf` is
 * the default of the SDKs and of the OpenTelemetry Collector's OTLP exporter.
 *
 * Decoding produces the same shape as the JSON path, so `ingest.ts` never
 * learns which encoding arrived. The one real difference is identifiers:
 * protobuf carries `trace_id` and `span_id` as raw bytes where JSON carries
 * hex, and a mismatch there would make a trace's spans fail to find each other
 * — so they are hex-encoded here, once, at the boundary.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import protobuf from "protobufjs";
import { nanosToClickhouse, type DecodedLog, type DecodedSpan, MAX_SPAN_EVENTS } from "./otlp";
import { seriesLabels, type MetricDecode } from "./metrics";

const PROTO = join(dirname(fileURLToPath(import.meta.url)), "..", "proto", "otlp.proto");

/** Parsed once: the schema does not change between requests. */
const root = protobuf.parse(readFileSync(PROTO, "utf8"), { keepCase: true }).root;
const LogsRequest = root.lookupType("opentelemetry.proto.ExportLogsServiceRequest");
const TraceRequest = root.lookupType("opentelemetry.proto.ExportTraceServiceRequest");
const LogsResponse = root.lookupType("opentelemetry.proto.ExportLogsServiceResponse");
const TraceResponse = root.lookupType("opentelemetry.proto.ExportTraceServiceResponse");

const KINDS = ["unspecified", "internal", "server", "client", "producer", "consumer"] as const;
const STATUSES = ["unset", "ok", "error"] as const;

function hex(v: Uint8Array | undefined): string {
  return v && v.length ? Buffer.from(v).toString("hex") : "";
}

/**
 * protobufjs decodes `fixed64` as a Long object unless told otherwise; the rest
 * of the pipeline speaks nanosecond strings, so normalise here.
 */
function nanos(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  const l = v as { toString(): string };
  const s = l.toString();
  return s === "0" ? undefined : s;
}

/**
 * Attributes, read with the protobuf field names.
 *
 * `keepCase: true` keeps the wire spelling — `string_value`, not
 * `stringValue` — so the JSON decoder's reader finds nothing here and every
 * resource looks empty. Which is exactly how this was caught: a real SDK
 * exporter answered "missing service.name" on a payload that plainly had one.
 */
function attrs(list: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of (list ?? []) as Array<{ key?: string; value?: unknown }>) {
    if (kv.key) out[kv.key] = anyValue(kv.value);
  }
  return out;
}

function resourceOf(resource: { attributes?: unknown } | undefined) {
  const ra = attrs(resource?.attributes);
  return {
    ra,
    serviceName: ra["service.name"] ?? "",
    environment: ra["deployment.environment"] ?? ra["deployment.environment.name"] ?? "",
    serviceVersion: ra["service.version"] ?? "",
  };
}

export function decodeLogsProto(body: Buffer): DecodedLog[] {
  const msg = LogsRequest.toObject(LogsRequest.decode(body), { bytes: Buffer, defaults: true });
  const out: DecodedLog[] = [];
  for (const rl of (msg.resource_logs ?? []) as Array<Record<string, unknown>>) {
    const { ra, serviceName, environment } = resourceOf(rl.resource as { attributes?: unknown });
    for (const sl of (rl.scope_logs ?? []) as Array<Record<string, unknown>>) {
      const scopeName = String((sl.scope as { name?: string } | undefined)?.name ?? "");
      for (const r of (sl.log_records ?? []) as Array<Record<string, unknown>>) {
        out.push({
          serviceName,
          environment,
          ts: nanosToClickhouse(nanos(r.time_unix_nano)),
          observedTs: nanosToClickhouse(nanos(r.observed_time_unix_nano)),
          severityNumber: Number(r.severity_number ?? 0),
          severityText: String(r.severity_text ?? ""),
          body: anyValue(r.body),
          traceId: hex(r.trace_id as Uint8Array | undefined),
          spanId: hex(r.span_id as Uint8Array | undefined),
          scopeName,
          attributes: attrs(r.attributes),
          resourceAttributes: ra,
        });
      }
    }
  }
  return out;
}

/** The oneof, after `toObject`: exactly one of these keys is set. */
function anyValue(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  const o = v as Record<string, unknown>;
  if (typeof o.string_value === "string") return o.string_value;
  if (o.bool_value !== undefined && o.bool_value !== null) return String(o.bool_value);
  if (o.int_value !== undefined && o.int_value !== null) return String(o.int_value);
  if (o.double_value !== undefined && o.double_value !== null) return String(o.double_value);
  if (o.bytes_value) return Buffer.from(o.bytes_value as Uint8Array).toString("base64");
  if (o.array_value)
    return JSON.stringify(
      ((o.array_value as { values?: unknown[] }).values ?? []).map((x) => anyValue(x)),
    );
  if (o.kvlist_value) return JSON.stringify(attrs((o.kvlist_value as { values?: unknown }).values));
  return "";
}

export function decodeSpansProto(body: Buffer): DecodedSpan[] {
  const msg = TraceRequest.toObject(TraceRequest.decode(body), { bytes: Buffer, defaults: true });
  const out: DecodedSpan[] = [];
  for (const rs of (msg.resource_spans ?? []) as Array<Record<string, unknown>>) {
    const { ra, serviceName, environment, serviceVersion } = resourceOf(
      rs.resource as { attributes?: unknown },
    );
    for (const ss of (rs.scope_spans ?? []) as Array<Record<string, unknown>>) {
      for (const s of (ss.spans ?? []) as Array<Record<string, unknown>>) {
        const a = attrs(s.attributes);
        const start = BigInt(nanos(s.start_time_unix_nano) ?? "0");
        const end = BigInt(nanos(s.end_time_unix_nano) ?? "0");
        const status = s.status as { code?: number; message?: string } | undefined;
        const events = (s.events ?? []) as Array<{
          name?: string;
          time_unix_nano?: unknown;
          attributes?: unknown;
        }>;
        out.push({
          serviceName,
          environment,
          serviceVersion,
          startTs: nanosToClickhouse(nanos(s.start_time_unix_nano)),
          endTs: nanosToClickhouse(nanos(s.end_time_unix_nano)),
          durationNs: end > start ? Number(end - start) : 0,
          traceId: hex(s.trace_id as Uint8Array | undefined),
          spanId: hex(s.span_id as Uint8Array | undefined),
          parentSpanId: hex(s.parent_span_id as Uint8Array | undefined),
          name: String(s.name ?? ""),
          kind: KINDS[Number(s.kind ?? 0)] ?? "unspecified",
          statusCode: STATUSES[Number(status?.code ?? 0)] ?? "unset",
          statusMessage: String(status?.message ?? ""),
          httpMethod: a["http.request.method"] ?? a["http.method"] ?? "",
          httpRoute: a["http.route"] ?? "",
          httpStatusCode: Number(a["http.response.status_code"] ?? a["http.status_code"] ?? 0),
          dbSystem: a["db.system.name"] ?? a["db.system"] ?? "",
          rpcService: a["rpc.service"] ?? "",
          peerService: a["peer.service"] ?? a["server.address"] ?? "",
          attributes: a,
          resourceAttributes: ra,
          // `time_unix_nano` here, `timeUnixNano` in the JSON path: protobufjs
          // is decoded with the field names the .proto declares, and OTLP/JSON
          // uses lowerCamelCase. Two spellings of one field, and getting it
          // wrong gives every event the epoch rather than an error.
          events: events.slice(0, MAX_SPAN_EVENTS).map((e) => ({
            ts: nanosToClickhouse(nanos(e.time_unix_nano)),
            name: String(e.name ?? ""),
            attributes: attrs(e.attributes),
          })),
          hasException: events.some((e) => e.name === "exception"),
        });
      }
    }
  }
  return out;
}

/**
 * The answer a protobuf sender expects.
 *
 * An empty message means full success — the SDKs read zero bytes as "all of it
 * landed". When part of the batch was refused, `partial_success` carries the
 * count and a sentence, which is how a collector learns it is sending spans
 * without `service.name` without anybody reading our logs.
 */
export function encodeLogsResponse(rejected: number, message = ""): Buffer {
  const payload = rejected
    ? { partial_success: { rejected_log_records: rejected, error_message: message } }
    : {};
  return Buffer.from(LogsResponse.encode(LogsResponse.create(payload)).finish());
}

export function encodeTraceResponse(rejected: number, message = ""): Buffer {
  const payload = rejected
    ? { partial_success: { rejected_spans: rejected, error_message: message } }
    : {};
  return Buffer.from(TraceResponse.encode(TraceResponse.create(payload)).finish());
}

/* ---------- metrics ---------- */

const MetricsRequest = root.lookupType("opentelemetry.proto.ExportMetricsServiceRequest");
const MetricsResponse = root.lookupType("opentelemetry.proto.ExportMetricsServiceResponse");

const TEMPORALITY = ["unspecified", "delta", "cumulative"] as const;

/**
 * A number point's value is a oneof between a double and a signed integer.
 * With `defaults: true`, protobufjs materialises both — so the presence of the
 * field is not the test; which one the encoder actually set is, and that is
 * what `oneofs` reports.
 */
function pointValue(p: Record<string, unknown>): number {
  const which = (p as { data?: string }).data;
  if (which === "as_int") return Number(p.as_int ?? 0);
  if (which === "as_double") return Number(p.as_double ?? 0);
  // No oneof marker (a hand-rolled sender): prefer whichever is non-zero.
  return Number(p.as_double ?? 0) || Number(p.as_int ?? 0);
}

export function decodeMetricsProto(body: Buffer): MetricDecode {
  const msg = MetricsRequest.toObject(MetricsRequest.decode(body), {
    bytes: Buffer,
    defaults: true,
    oneofs: true,
  });
  const out: MetricDecode = { points: [], unsupported: [] };
  for (const rm of (msg.resource_metrics ?? []) as Array<Record<string, unknown>>) {
    const { serviceName, environment, ra } = resourceOf(rm.resource as { attributes?: unknown });
    const labels = seriesLabels(ra);
    for (const sm of (rm.scope_metrics ?? []) as Array<Record<string, unknown>>) {
      for (const m of (sm.metrics ?? []) as Array<Record<string, unknown>>) {
        const which = (m as { data?: string }).data;
        const base = {
          serviceName,
          environment,
          metricName: String(m.name ?? ""),
          description: String(m.description ?? ""),
          unit: String(m.unit ?? ""),
        };
        if (which === "exponential_histogram" || which === "summary") {
          out.unsupported.push(base.metricName);
          continue;
        }
        if (which === "gauge") {
          const g = m.gauge as { data_points?: Array<Record<string, unknown>> };
          for (const p of g?.data_points ?? []) {
            out.points.push({
              ...base,
              kind: "gauge",
              ts: nanosToClickhouse(nanos(p.time_unix_nano)),
              attributes: { ...labels, ...attrs(p.attributes) },
              value: pointValue(p),
            });
          }
        } else if (which === "sum") {
          const s = m.sum as {
            data_points?: Array<Record<string, unknown>>;
            is_monotonic?: boolean;
            aggregation_temporality?: number;
          };
          for (const p of s?.data_points ?? []) {
            out.points.push({
              ...base,
              kind: "sum",
              ts: nanosToClickhouse(nanos(p.time_unix_nano)),
              attributes: { ...labels, ...attrs(p.attributes) },
              value: pointValue(p),
              isMonotonic: Boolean(s?.is_monotonic),
              temporality: TEMPORALITY[Number(s?.aggregation_temporality ?? 0)] ?? "unspecified",
            });
          }
        } else if (which === "histogram") {
          const h = m.histogram as {
            data_points?: Array<Record<string, unknown>>;
            aggregation_temporality?: number;
          };
          for (const p of h?.data_points ?? []) {
            out.points.push({
              ...base,
              kind: "histogram",
              ts: nanosToClickhouse(nanos(p.time_unix_nano)),
              attributes: { ...labels, ...attrs(p.attributes) },
              count: Number(nanos(p.count) ?? 0),
              sum: Number(p.sum ?? 0),
              min: Number(p.min ?? 0),
              max: Number(p.max ?? 0),
              bucketCounts: ((p.bucket_counts ?? []) as unknown[]).map((x) =>
                Number(nanos(x) ?? 0),
              ),
              explicitBounds: ((p.explicit_bounds ?? []) as unknown[]).map(Number),
              temporality: TEMPORALITY[Number(h?.aggregation_temporality ?? 0)] ?? "unspecified",
            });
          }
        }
      }
    }
  }
  return out;
}

export function encodeMetricsResponse(rejected: number, message = ""): Buffer {
  const payload = rejected
    ? { partial_success: { rejected_data_points: rejected, error_message: message } }
    : {};
  return Buffer.from(MetricsResponse.encode(MetricsResponse.create(payload)).finish());
}
