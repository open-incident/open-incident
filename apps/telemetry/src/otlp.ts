/**
 * OTLP/JSON → rows.
 *
 * Only the JSON encoding for now. Protobuf is the default of most SDKs and is
 * the next commit; until it lands, the onboarding screen and the docs tell a
 * collector to set `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`, and the ingestion
 * path answers 415 with that sentence rather than accepting bytes it cannot
 * read. Half a feature that says which half is better than one that drops
 * spans quietly.
 *
 * The shapes below follow the OTLP JSON mapping: identifiers are hex strings,
 * timestamps are nanoseconds as strings, and an attribute is a `{key, value}`
 * pair whose value is a one-field union.
 */

export type AnyValue = {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string | number;
  doubleValue?: number;
  arrayValue?: { values?: AnyValue[] };
  kvlistValue?: { values?: KeyValue[] };
  bytesValue?: string;
};
export type KeyValue = { key?: string; value?: AnyValue };

/** Everything becomes a string: ClickHouse stores a Map(String, String). */
export function flatten(v: AnyValue | undefined): string {
  if (!v) return "";
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.boolValue !== undefined) return String(v.boolValue);
  if (v.intValue !== undefined) return String(v.intValue);
  if (v.doubleValue !== undefined) return String(v.doubleValue);
  if (v.bytesValue !== undefined) return v.bytesValue;
  if (v.arrayValue?.values) return JSON.stringify(v.arrayValue.values.map(flatten));
  if (v.kvlistValue?.values) return JSON.stringify(attrs(v.kvlistValue.values));
  return "";
}

export function attrs(list: KeyValue[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of list ?? []) if (kv.key) out[kv.key] = flatten(kv.value);
  return out;
}

/** OTLP nanoseconds → the `YYYY-MM-DD hh:mm:ss.fffffffff` ClickHouse expects. */
export function nanosToClickhouse(
  nanos: string | number | undefined,
  fallback = Date.now(),
): string {
  const n = nanos === undefined ? BigInt(fallback) * 1_000_000n : BigInt(nanos);
  const ms = Number(n / 1_000_000n);
  const rest = (n % 1_000_000n).toString().padStart(6, "0");
  return `${new Date(ms).toISOString().replace("T", " ").replace("Z", "")}${rest}`;
}

export type DecodedLog = {
  serviceName: string;
  environment: string;
  ts: string;
  observedTs: string;
  severityNumber: number;
  severityText: string;
  body: string;
  traceId: string;
  spanId: string;
  scopeName: string;
  attributes: Record<string, string>;
  resourceAttributes: Record<string, string>;
};

export type DecodedSpan = {
  serviceName: string;
  environment: string;
  serviceVersion: string;
  startTs: string;
  endTs: string;
  durationNs: number;
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  kind: string;
  statusCode: string;
  statusMessage: string;
  httpMethod: string;
  httpRoute: string;
  httpStatusCode: number;
  dbSystem: string;
  rpcService: string;
  peerService: string;
  attributes: Record<string, string>;
  resourceAttributes: Record<string, string>;
  hasException: boolean;
};

const KINDS = ["unspecified", "internal", "server", "client", "producer", "consumer"] as const;
const STATUSES = ["unset", "ok", "error"] as const;

function resourceOf(resource: { attributes?: KeyValue[] } | undefined) {
  const ra = attrs(resource?.attributes);
  return {
    ra,
    // `service.name` is required by the spec; the caller decides what to do
    // when it is missing, because that decision is a rejection, not a default.
    serviceName: ra["service.name"] ?? "",
    environment: ra["deployment.environment"] ?? ra["deployment.environment.name"] ?? "",
    serviceVersion: ra["service.version"] ?? "",
  };
}

export function decodeLogs(payload: unknown): DecodedLog[] {
  const root = payload as { resourceLogs?: Array<Record<string, unknown>> };
  const out: DecodedLog[] = [];
  for (const rl of root.resourceLogs ?? []) {
    const { ra, serviceName, environment } = resourceOf(
      rl.resource as { attributes?: KeyValue[] } | undefined,
    );
    for (const sl of (rl.scopeLogs ?? []) as Array<Record<string, unknown>>) {
      const scopeName = ((sl.scope as { name?: string } | undefined)?.name ?? "") as string;
      for (const r of (sl.logRecords ?? []) as Array<Record<string, unknown>>) {
        out.push({
          serviceName,
          environment,
          ts: nanosToClickhouse(r.timeUnixNano as string | undefined),
          observedTs: nanosToClickhouse(r.observedTimeUnixNano as string | undefined),
          severityNumber: Number(r.severityNumber ?? 0),
          severityText: String(r.severityText ?? ""),
          body: flatten(r.body as AnyValue | undefined),
          traceId: String(r.traceId ?? ""),
          spanId: String(r.spanId ?? ""),
          scopeName,
          attributes: attrs(r.attributes as KeyValue[] | undefined),
          resourceAttributes: ra,
        });
      }
    }
  }
  return out;
}

export function decodeSpans(payload: unknown): DecodedSpan[] {
  const root = payload as { resourceSpans?: Array<Record<string, unknown>> };
  const out: DecodedSpan[] = [];
  for (const rs of root.resourceSpans ?? []) {
    const { ra, serviceName, environment, serviceVersion } = resourceOf(
      rs.resource as { attributes?: KeyValue[] } | undefined,
    );
    for (const ss of (rs.scopeSpans ?? []) as Array<Record<string, unknown>>) {
      for (const s of (ss.spans ?? []) as Array<Record<string, unknown>>) {
        const a = attrs(s.attributes as KeyValue[] | undefined);
        const start = BigInt((s.startTimeUnixNano as string) ?? "0");
        const end = BigInt((s.endTimeUnixNano as string) ?? "0");
        const events = (s.events ?? []) as Array<{ name?: string }>;
        out.push({
          serviceName,
          environment,
          serviceVersion,
          startTs: nanosToClickhouse(s.startTimeUnixNano as string | undefined),
          endTs: nanosToClickhouse(s.endTimeUnixNano as string | undefined),
          durationNs: end > start ? Number(end - start) : 0,
          traceId: String(s.traceId ?? ""),
          spanId: String(s.spanId ?? ""),
          parentSpanId: String(s.parentSpanId ?? ""),
          name: String(s.name ?? ""),
          kind: KINDS[Number(s.kind ?? 0)] ?? "unspecified",
          statusCode:
            STATUSES[Number((s.status as { code?: number } | undefined)?.code ?? 0)] ?? "unset",
          statusMessage: String((s.status as { message?: string } | undefined)?.message ?? ""),
          // Both the current and the legacy semconv spellings, because a fleet
          // is never on one version of the SDK at the same time.
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
