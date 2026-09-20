/**
 * Prometheus remote write, into the same metric points everything else makes.
 *
 * The reason this endpoint exists: a great many installations already run
 * Prometheus, and asking them to replace it before they can try this product
 * is asking them not to try it. Remote write is the one line of configuration
 * that sends them here as well, and they can keep everything they have while
 * they decide.
 *
 * Both versions are read. 1.0 is what almost everything still speaks; 2.0
 * carries each string once in a symbol table and refers to it by index, which
 * is most of why it exists. The two arrive at the same `MetricPoint[]`, so
 * nothing downstream learns which one it was.
 *
 * Prometheus has no notion of a service, and this product files everything
 * under one. The mapping is deliberate and stated on the Connect screen: the
 * `job` label becomes `service.name`, because that is what a Prometheus job
 * already is, and a scrape with no job at all is refused rather than filed
 * under a made-up name.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import protobuf from "protobufjs";
import type { MetricDecode, MetricPoint } from "./metrics";
import { snappyDecode } from "./snappy";

const PROTO = join(dirname(fileURLToPath(import.meta.url)), "..", "proto", "prometheus.proto");
const root = protobuf.parse(readFileSync(PROTO, "utf8"), { keepCase: true }).root;
const WriteRequest = root.lookupType("prometheus.WriteRequest");
const V2Request = root.lookupType("prometheus.V2Request");

export class RemoteWriteError extends Error {}

/**
 * Which version a body is, from the header the sender is required to set.
 *
 * Guessing from the bytes is possible and is a bad idea: the two encodings
 * overlap enough that a wrong guess produces plausible garbage rather than an
 * error, and a metric filed under a label read out of the wrong field is worse
 * than a refused request.
 */
export function remoteWriteVersion(headers: Record<string, string | string[] | undefined>): 1 | 2 {
  const version = String(headers["x-prometheus-remote-write-version"] ?? "");
  const contentType = String(headers["content-type"] ?? "");
  if (version.startsWith("2.") || /io\.prometheus\.write\.v2\.Request/.test(contentType)) return 2;
  return 1;
}

/**
 * Counter or gauge, from 2.0's metadata — when there is any.
 *
 * 1.0 carries no type at all, and Prometheus 3.5 was observed sending an empty
 * metadata message on every series in 2.0, so in practice almost everything
 * arrives here as a gauge. That is the honest default rather than a guess: a
 * name ending in `_total` is usually a counter and sometimes is not, and
 * storing a gauge as a counter makes `rate()` invent resets that never
 * happened.
 */
const V2_KINDS: Record<number, "gauge" | "sum"> = { 1: "sum", 2: "gauge" };

export function decodeRemoteWrite(body: Buffer, version: 1 | 2): MetricDecode {
  const raw = snappyDecode(body);
  return version === 2 ? decodeV2(raw) : decodeV1(raw);
}

type Sample = { value?: number; timestamp?: unknown };

function decodeV1(raw: Buffer): MetricDecode {
  const message = WriteRequest.decode(raw) as unknown as {
    timeseries?: Array<{ labels?: Array<{ name?: string; value?: string }>; samples?: Sample[] }>;
  };
  const out: MetricDecode = { points: [], unsupported: [] };
  for (const series of message.timeseries ?? []) {
    const labels: Record<string, string> = {};
    for (const l of series.labels ?? []) if (l.name) labels[l.name] = l.value ?? "";
    push(out, labels, series.samples ?? [], "gauge", "");
  }
  return out;
}

function decodeV2(raw: Buffer): MetricDecode {
  const message = V2Request.decode(raw) as unknown as {
    symbols?: string[];
    timeseries?: Array<{
      label_refs?: number[];
      samples?: Sample[];
      metadata?: { type?: number; unit_ref?: number };
    }>;
  };
  const symbols = message.symbols ?? [];
  const out: MetricDecode = { points: [], unsupported: [] };

  for (const series of message.timeseries ?? []) {
    const refs = series.label_refs ?? [];
    if (refs.length % 2 !== 0) {
      // The refs are name/value pairs. An odd count means the body is not what
      // it says it is, and reading it anyway would mis-name every label after
      // the fault.
      throw new RemoteWriteError("a series has an odd number of label references");
    }
    const labels: Record<string, string> = {};
    for (let i = 0; i < refs.length; i += 2) {
      const name = symbols[refs[i]!];
      if (name === undefined) throw new RemoteWriteError("a label refers outside the symbol table");
      labels[name] = symbols[refs[i + 1]!] ?? "";
    }
    const kind = V2_KINDS[Number(series.metadata?.type ?? 0)] ?? "gauge";
    const unit = symbols[Number(series.metadata?.unit_ref ?? 0)] ?? "";
    push(out, labels, series.samples ?? [], kind, unit);
  }
  return out;
}

function push(
  out: MetricDecode,
  labels: Record<string, string>,
  samples: Sample[],
  kind: "gauge" | "sum",
  unit: string,
): void {
  const metricName = labels.__name__ ?? "";
  if (!metricName) {
    out.unsupported.push("a series with no __name__");
    return;
  }
  const serviceName = labels.job ?? "";
  if (!serviceName) {
    // Refused rather than filed under "unknown": a metric nobody can attribute
    // is a metric nobody finds again, and a placeholder service would collect
    // every such mistake from every sender into one unreadable heap.
    out.unsupported.push(`${metricName} (no job label)`);
    return;
  }

  /*
   * `__name__` becomes the metric name. `job` becomes the service **and stays
   * a label**, which is the whole of the compatibility story: every dashboard
   * and every alert a Prometheus user already has says `job="…"`, and dropping
   * it because we had used it for something else would make all of them return
   * nothing, silently. One duplicated short string per series is the cheapest
   * thing in this pipeline.
   */
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (key === "__name__") continue;
    attributes[key] = value;
  }

  for (const sample of samples) {
    const ms = toMillis(sample.timestamp);
    if (ms === null) continue;
    const value = Number(sample.value ?? 0);
    // NaN is how Prometheus marks a series as stale. It is not a measurement,
    // and storing it would draw a gap as a zero.
    if (!Number.isFinite(value)) continue;
    out.points.push({
      kind,
      serviceName,
      environment: labels.environment ?? labels.env ?? "",
      metricName,
      description: "",
      unit,
      ts: clickhouseTime(ms),
      attributes,
      value,
      ...(kind === "sum" ? { isMonotonic: true, temporality: "cumulative" as const } : {}),
    });
  }
}

/** protobufjs hands back a Long for int64; the rest of the code wants a number. */
function toMillis(timestamp: unknown): number | null {
  if (timestamp === undefined || timestamp === null) return null;
  if (typeof timestamp === "number") return timestamp;
  if (typeof timestamp === "string") return Number(timestamp);
  const long = timestamp as { toNumber?: () => number };
  return typeof long.toNumber === "function" ? long.toNumber() : null;
}

function clickhouseTime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}

export type { MetricPoint };
