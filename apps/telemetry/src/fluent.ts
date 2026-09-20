/**
 * A Fluent Bit HTTP batch into logs.
 *
 * Fluent's records are whatever the parser produced: there is no schema, and a
 * Docker source, a Kubernetes filter and a tail input all put the message
 * under a different key. So the mapping is a short list of the names actually
 * used, tried in order, and everything not consumed becomes an attribute —
 * because a Kubernetes filter's dozen fields are the difference between "an
 * error happened" and "this pod, this container, this namespace".
 */
import { nanosToClickhouse, type DecodedLog } from "./otlp";

/** The keys a message hides behind, in the order senders use them. */
const BODY_KEYS = ["log", "message", "msg", "short_message", "MESSAGE"];
const LEVEL_KEYS = ["level", "severity", "severity_text", "loglevel", "PRIORITY"];
const TIME_KEYS = ["date", "time", "timestamp", "@timestamp", "ts"];

/** Every spelling of a level anybody writes, onto OTel's numbers. */
const LEVELS: Array<[RegExp, number, string]> = [
  [/^(fatal|crit|critical|emerg|emergency|alert|panic)$/i, 21, "FATAL"],
  [/^(err|error|severe)$/i, 17, "ERROR"],
  [/^(warn|warning)$/i, 13, "WARN"],
  [/^(info|notice|information)$/i, 9, "INFO"],
  [/^(debug|fine|verbose)$/i, 5, "DEBUG"],
  [/^(trace|finest)$/i, 1, "TRACE"],
];

export function decodeFluent(payload: unknown, tag: string): DecodedLog[] {
  // Fluent Bit's HTTP output sends an array; a hand-rolled sender might send
  // one object. Both are read, because refusing the second would be refusing
  // somebody's `curl` for no reason.
  const records = Array.isArray(payload) ? payload : [payload];
  const out: DecodedLog[] = [];

  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const record = { ...(raw as Record<string, unknown>) };

    const body = take(record, BODY_KEYS);
    if (body === null) continue;
    const level = take(record, LEVEL_KEYS);
    const when = take(record, TIME_KEYS);
    const { number, text } = severityOf(level);

    // The tag names the service, because a Fluent tag is exactly "which thing
    // this came from" — and its last segment is the useful half: a tag of
    // `kube.var.log.containers.checkout-api` is one service, not five.
    const kubernetes = (record.kubernetes ?? {}) as Record<string, unknown>;
    const service =
      String(kubernetes.container_name ?? record.container_name ?? "") ||
      tag.split(".").filter(Boolean).pop() ||
      "fluent";

    const attributes: Record<string, string> = { "fluent.tag": tag };
    flatten(record, "", attributes);

    out.push({
      ts: timeOf(when),
      observedTs: nanosToClickhouse(String(Date.now() * 1e6)),
      serviceName: service,
      environment: String(record.environment ?? record.env ?? ""),
      severityNumber: number,
      severityText: text,
      body,
      traceId: String(record.trace_id ?? record.traceId ?? ""),
      spanId: String(record.span_id ?? record.spanId ?? ""),
      scopeName: "fluent",
      attributes,
      resourceAttributes: {},
    });
  }
  return out;
}

/** Reads and removes the first key present, so it does not become an attribute too. */
function take(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      const value = String(record[key]);
      delete record[key];
      return value;
    }
  }
  return null;
}

function severityOf(level: string | null): { number: number; text: string } {
  if (!level) return { number: 9, text: "INFO" };
  for (const [pattern, number, text] of LEVELS) {
    if (pattern.test(level.trim())) return { number, text };
  }
  // A numeric level: syslog's scale, which is what journald sends.
  const n = Number(level);
  if (Number.isFinite(n) && n >= 0 && n <= 7) {
    return severityOf(["emerg", "alert", "crit", "err", "warn", "notice", "info", "debug"][n]!);
  }
  return { number: 9, text: "INFO" };
}

/**
 * Fluent's time, in whichever of its three shapes arrived.
 *
 * Seconds as a float is the native one, milliseconds is what a JSON parser
 * produces, and a string is what a date parser left behind. Telling them apart
 * by magnitude is crude and correct for every year this product will see.
 */
function timeOf(value: string | null): string {
  const now = new Date();
  if (!value) return stamp(now);
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) {
    // Below ten billion it is seconds; above, milliseconds. The boundary is
    // the year 2286 in one reading and 1970 in the other.
    const ms = n < 1e10 ? n * 1000 : n;
    const at = new Date(ms);
    return Number.isFinite(at.getTime()) ? stamp(at) : stamp(now);
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? stamp(new Date(parsed)) : stamp(now);
}

function stamp(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}

/**
 * A record's fields, one level of nesting flattened.
 *
 * Fluent's Kubernetes filter puts everything useful inside a `kubernetes`
 * object — namespace, pod, container, labels — and stringifying it whole makes
 * "which pod" a question nobody can filter on. Flattened to
 * `kubernetes.pod_name`, it is a field like any other.
 *
 * One level, and then JSON. Deeper structures exist and nesting without a
 * bound is how one record becomes four hundred columns in the attribute map.
 */
function flatten(
  value: Record<string, unknown>,
  prefix: string,
  into: Record<string, string>,
  depth = 0,
): void {
  for (const [key, raw] of Object.entries(value)) {
    if (raw === null || raw === undefined) continue;
    const name = (prefix ? `${prefix}.${key}` : key).slice(0, 120);
    if (typeof raw === "object" && !Array.isArray(raw) && depth < 1) {
      flatten(raw as Record<string, unknown>, name, into, depth + 1);
      continue;
    }
    into[name] = (typeof raw === "object" ? JSON.stringify(raw) : String(raw)).slice(0, 1000);
  }
}
