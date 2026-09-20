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
import { nanosToClickhouse, type DecodedLog, type DecodedSpan } from "./otlp";

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
        const events = (s.events ?? []) as Array<{ name?: string }>;
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
