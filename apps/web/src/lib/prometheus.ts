/**
 * The Prometheus HTTP API, as Grafana expects to find it.
 *
 * The point of this compatibility layer is not to be Prometheus; it is that
 * every dashboard, every `promtool` check and every runbook a team already has
 * keeps working when the metrics move here. So the envelope is theirs, down to
 * the field names and the string-encoded values — a client that parses
 * `[1609746000, "42"]` must not have to special-case us.
 *
 * Errors follow the same rule. `errorType: "bad_data"` with the construction
 * named is what makes Grafana show "histogram_quantile is not supported yet"
 * in the panel instead of a red triangle with no explanation.
 */
import "server-only";
import { evalPromql, PromqlError, telemetryInstalled, type Series } from "@openincident/telemetry";

export type PromResult =
  | {
      resultType: "vector";
      result: Array<{ metric: Record<string, string>; value: [number, string] }>;
    }
  | {
      resultType: "matrix";
      result: Array<{ metric: Record<string, string>; values: Array<[number, string]> }>;
    };

export function promSuccess(data: unknown): Response {
  return Response.json({ status: "success", data });
}

export function promError(error: string, type = "bad_data", status = 400): Response {
  return Response.json({ status: "error", errorType: type, error }, { status });
}

export function promNotInstalled(): Response {
  return promError("the telemetry module is not installed on this instance", "unavailable", 503);
}

/** Prometheus timestamps are seconds, as a float, and values are strings. */
function seconds(ms: number): number {
  return Math.round(ms) / 1000;
}

function encode(v: number): string {
  return Number.isFinite(v) ? String(v) : "NaN";
}

export function toVector(series: Series[]): PromResult {
  return {
    resultType: "vector",
    result: series
      .map((s) => {
        const last = s.points[s.points.length - 1];
        return last
          ? { metric: s.labels, value: [seconds(last.t), encode(last.v)] as [number, string] }
          : null;
      })
      .filter((x): x is { metric: Record<string, string>; value: [number, string] } => x !== null),
  };
}

export function toMatrix(series: Series[]): PromResult {
  return {
    resultType: "matrix",
    result: series
      .filter((s) => s.points.length > 0)
      .map((s) => ({
        metric: s.labels,
        values: s.points.map((p) => [seconds(p.t), encode(p.v)] as [number, string]),
      })),
  };
}

/** `time`, `start`, `end`: RFC 3339 or a unix timestamp in seconds. */
export function parseTime(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return asNumber * 1000;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** `step`: seconds, or a Prometheus duration. */
export function parseStep(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return asNumber * 1000;
  const m = /^([0-9]+)(ms|s|m|h|d|w)$/.exec(value);
  if (!m) return fallback;
  const unit: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  return Number(m[1]) * unit[m[2]!]!;
}

/**
 * Runs a query and turns any refusal into the envelope Grafana renders.
 *
 * A `PromqlError` is the deliberate half — a construction outside the subset,
 * named. Anything else is ours, and is reported as such rather than dressed up
 * as a syntax problem the user could fix.
 */
export async function runQuery(
  tenantId: string,
  query: string,
  opts: { start: number; end: number; stepMs: number },
  shape: "vector" | "matrix",
): Promise<Response> {
  if (!telemetryInstalled()) return promNotInstalled();
  try {
    const series = await evalPromql(tenantId, query, opts);
    return promSuccess(shape === "vector" ? toVector(series) : toMatrix(series));
  } catch (err) {
    if (err instanceof PromqlError) return promError(err.message);
    console.error("[prometheus] query failed:", err);
    return promError("the query could not be evaluated on this instance", "internal", 500);
  }
}

/** Grafana sends parameters as a form body on POST and as a query string on GET. */
export async function promParams(request: Request): Promise<URLSearchParams> {
  if (request.method === "POST") {
    const body = await request.text();
    return new URLSearchParams(body);
  }
  return new URL(request.url).searchParams;
}
