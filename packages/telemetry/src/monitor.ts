/**
 * Evaluating a telemetry monitor — one value per series, from the column store.
 *
 * The other monitor types ask "does it answer?" and get back one sample. These
 * four ask "what is it saying about itself?" and get back as many values as
 * there are series: "error rate above 5 % **by route**" is one monitor and,
 * the day two routes break, two alerts. That difference is why this evaluator
 * exists beside `performCheck` rather than inside it.
 *
 * Nothing here writes, pages or remembers. It reads ClickHouse through the
 * tenant views and returns numbers; deciding what a number means, holding it
 * for `for` evaluations and posting the alert belong to the sweep, which lives
 * with the other monitors in `@openincident/oncall`.
 */
import { read, chTime } from "./query";
import { evalPromql } from "./promql/eval";
import { SOURCES, columnOf, compileFilter, fieldsOf, TelemetryFilterError } from "./filter";

export type TelemetryMonitorKind = "logs" | "traces" | "metrics" | "exceptions";

export type TelemetryAggregate =
  "count" | "rate" | "sum" | "avg" | "min" | "max" | "p50" | "p95" | "p99";

export type TelemetryCondition =
  | { kind: "threshold"; op: ">" | ">=" | "<" | "<=" | "==" | "!="; value: number }
  | { kind: "anomaly"; direction: "high" | "low" | "any" };

export type TelemetryMonitorQuery = {
  query: string;
  aggregate: TelemetryAggregate;
  /** The numeric column the aggregate runs on. Unused by `count` and `rate`. */
  field?: string;
  windowMinutes: number;
  condition: TelemetryCondition;
  forEvaluations: number;
  groupBy: string[];
  noData: "ignore" | "trigger" | "zero";
  severity?: "P1" | "P2" | "P3" | "P4";
};

/** One line of the answer: a series, its labels, and the number it produced. */
export type SeriesValue = {
  /** Stable across evaluations: the alert's dedup key is built on it. */
  key: string;
  labels: Record<string, string>;
  value: number;
};

/**
 * Kept as a name of its own, re-exported from the filter module: callers catch
 * "the monitor refused this", and the fact that most refusals come from the
 * filter compiler is an implementation detail they should not have to know.
 */
export { TelemetryFilterError as TelemetryMonitorError, compileFilter, fieldsOf };

function aggregateSql(kind: TelemetryMonitorKind, q: TelemetryMonitorQuery): string {
  const seconds = q.windowMinutes * 60;
  if (q.aggregate === "count") return "toFloat64(count())";
  if (q.aggregate === "rate") return `count() / ${seconds}`;
  if (!q.field) {
    throw new TelemetryFilterError(`${q.aggregate} needs a field to run on`);
  }
  const column = columnOf(kind, q.field, {});
  if (!column.numeric) throw new TelemetryFilterError(`${q.field} is not a number`);
  const quantile = /^p(\d+)$/.exec(q.aggregate);
  if (quantile) return `quantile(0.${quantile[1]})(${column.sql})`;
  return `${q.aggregate}(${column.sql})`;
}

/** The label set of a series, spelled the same way everywhere it is used. */
export function seriesKeyOf(labels: Record<string, string>): string {
  const pairs = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return pairs.length === 0 ? "*" : pairs.map(([k, v]) => `${k}=${v}`).join(",");
}

/* ---------- Evaluation ---------- */

export async function evaluate(
  tenantId: string,
  kind: TelemetryMonitorKind,
  q: TelemetryMonitorQuery,
  at: Date = new Date(),
): Promise<SeriesValue[]> {
  if (q.windowMinutes < 1 || q.windowMinutes > 60) {
    throw new TelemetryFilterError("the window is between 1 and 60 minutes");
  }
  return kind === "metrics" ? evaluatePromql(tenantId, q, at) : evaluateRows(tenantId, kind, q, at);
}

async function evaluatePromql(
  tenantId: string,
  q: TelemetryMonitorQuery,
  at: Date,
): Promise<SeriesValue[]> {
  // An instant query: PromQL already says over what range it looks, and a
  // second window on top of it would mean two different answers to "what does
  // this monitor watch".
  const end = at.getTime();
  const series = await evalPromql(tenantId, q.query, { start: end, end, stepMs: 60_000 });
  const out: SeriesValue[] = [];
  for (const s of series) {
    const last = s.points.at(-1);
    if (!last || !Number.isFinite(last.v)) continue;
    const labels = q.groupBy.length
      ? Object.fromEntries(q.groupBy.filter((l) => l in s.labels).map((l) => [l, s.labels[l]!]))
      : s.labels;
    out.push({ key: seriesKeyOf(labels), labels, value: last.v });
  }
  return out;
}

async function evaluateRows(
  tenantId: string,
  kind: Exclude<TelemetryMonitorKind, "metrics">,
  q: TelemetryMonitorQuery,
  at: Date,
): Promise<SeriesValue[]> {
  const source = SOURCES[kind];
  const filter = compileFilter(kind, q.query);
  const params: Record<string, unknown> = { ...filter.params };
  const groups = q.groupBy.map((field, i) => {
    const column = columnOf(kind, field, params);
    return { alias: `g${i}`, field, sql: column.sql };
  });
  const select = [
    `${aggregateSql(kind, q)} AS value`,
    ...groups.map((g) => `toString(${g.sql}) AS ${g.alias}`),
  ];

  const from = new Date(at.getTime() - q.windowMinutes * 60_000);
  params.from = chTime(from);
  params.to = chTime(at);

  const rows = await read<Record<string, string>>(
    tenantId,
    `SELECT ${select.join(", ")}
       FROM ${source.from}
      WHERE ${source.ts} >= {from:DateTime64(9)} AND ${source.ts} < {to:DateTime64(9)}
        AND ${filter.sql}
      ${groups.length ? `GROUP BY ${groups.map((g) => g.alias).join(", ")}` : ""}
      ORDER BY value DESC
      LIMIT 500`,
    { params },
  );

  const out: SeriesValue[] = [];
  for (const r of rows) {
    const labels: Record<string, string> = {};
    for (const g of groups) labels[g.field] = r[g.alias] ?? "";
    // An average over no rows comes back null, and null is not a value: the
    // series is absent, which is what the monitor's no-data policy is there to
    // answer. A count over no rows really is zero, and ClickHouse says so with
    // a zero. Reading the null as a zero — which `Number(null)` quietly does —
    // would turn "the service stopped reporting" into "its latency is 0 ms".
    if (r.value === null || r.value === undefined) continue;
    const value = Number(r.value);
    if (!Number.isFinite(value)) continue;
    out.push({ key: seriesKeyOf(labels), labels, value });
  }
  return out;
}

/* ---------- Anomaly ---------- */

export type Baseline = { median: number; mad: number; samples: number; days: number };

/**
 * What normal looks like for this monitor, per series.
 *
 * Median and MAD rather than mean and standard deviation, because the thing
 * being learned from is a month of production and a month of production
 * contains the incidents: one four-hour outage drags a mean and inflates a
 * standard deviation enough to hide the next outage, and leaves a median where
 * it was.
 *
 * The comparison is against the **same hour of the week** over four weeks, not
 * against the whole month. Traffic at Sunday 04:00 has nothing to say about
 * Tuesday 14:00, and a baseline that mixes them calls every Monday morning an
 * anomaly.
 */
export async function baselines(
  tenantId: string,
  kind: TelemetryMonitorKind,
  q: TelemetryMonitorQuery,
  at: Date = new Date(),
): Promise<Map<string, Baseline>> {
  if (kind === "metrics") return baselinesFromPromql(tenantId, q, at);

  const source = SOURCES[kind as Exclude<TelemetryMonitorKind, "metrics">];
  const filter = compileFilter(kind, q.query);
  const params: Record<string, unknown> = { ...filter.params };
  const groups = q.groupBy.map((field, i) => {
    const column = columnOf(kind, field, params);
    return { alias: `g${i}`, field, sql: column.sql };
  });

  params.from = chTime(new Date(at.getTime() - BASELINE_DAYS * 86_400_000));
  params.to = chTime(at);
  params.window = q.windowMinutes;
  params.dow = at.getUTCDay() === 0 ? 7 : at.getUTCDay();
  params.hour = at.getUTCHours();

  const rows = await read<Record<string, string>>(
    tenantId,
    `SELECT ${aggregateSql(kind, q)} AS value,
            toStartOfInterval(${source.ts}, INTERVAL {window:UInt8} MINUTE) AS slot,
            min(toDateTime(${source.ts})) AS oldest
            ${groups.length ? "," : ""} ${groups.map((g) => `toString(${g.sql}) AS ${g.alias}`).join(", ")}
       FROM ${source.from}
      WHERE ${source.ts} >= {from:DateTime64(9)} AND ${source.ts} < {to:DateTime64(9)}
        AND toDayOfWeek(${source.ts}) = {dow:UInt8}
        AND toHour(${source.ts}) = {hour:UInt8}
        AND ${filter.sql}
      GROUP BY slot${groups.length ? `, ${groups.map((g) => g.alias).join(", ")}` : ""}
      LIMIT 20000`,
    { params, maxRows: 20_000 },
  );

  const bySeries = new Map<string, { values: number[]; oldest: number }>();
  for (const r of rows) {
    const labels: Record<string, string> = {};
    for (const g of groups) labels[g.field] = r[g.alias] ?? "";
    const key = seriesKeyOf(labels);
    const entry = bySeries.get(key) ?? { values: [], oldest: Number.POSITIVE_INFINITY };
    entry.values.push(Number(r.value ?? 0));
    const oldest = Date.parse(`${(r.oldest ?? "").replace(" ", "T")}Z`);
    if (Number.isFinite(oldest)) entry.oldest = Math.min(entry.oldest, oldest);
    bySeries.set(key, entry);
  }

  const out = new Map<string, Baseline>();
  for (const [key, entry] of bySeries) {
    const days = Number.isFinite(entry.oldest) ? (at.getTime() - entry.oldest) / 86_400_000 : 0;
    out.set(key, { ...spread(entry.values), samples: entry.values.length, days });
  }
  return out;
}

async function baselinesFromPromql(
  tenantId: string,
  q: TelemetryMonitorQuery,
  at: Date,
): Promise<Map<string, Baseline>> {
  const out = new Map<string, Baseline>();
  const step = Math.max(q.windowMinutes, 1) * 60_000;
  // Four separate one-hour ranges, one per week, rather than one month-long
  // range: the same hour of the week is the comparison, and asking for the
  // month would be a hundred thousand points to throw away.
  const gathered = new Map<string, { values: number[]; oldest: number }>();
  for (let week = 1; week <= 4; week++) {
    const end = at.getTime() - week * 7 * 86_400_000;
    const series = await evalPromql(tenantId, q.query, {
      start: end - 3_600_000,
      end,
      stepMs: step,
    });
    for (const s of series) {
      const labels = q.groupBy.length
        ? Object.fromEntries(q.groupBy.filter((l) => l in s.labels).map((l) => [l, s.labels[l]!]))
        : s.labels;
      const key = seriesKeyOf(labels);
      const entry = gathered.get(key) ?? { values: [], oldest: Number.POSITIVE_INFINITY };
      for (const p of s.points) {
        if (!Number.isFinite(p.v)) continue;
        entry.values.push(p.v);
        entry.oldest = Math.min(entry.oldest, p.t);
      }
      gathered.set(key, entry);
    }
  }
  for (const [key, entry] of gathered) {
    const days = Number.isFinite(entry.oldest) ? (at.getTime() - entry.oldest) / 86_400_000 : 0;
    out.set(key, { ...spread(entry.values), samples: entry.values.length, days });
  }
  return out;
}

export const BASELINE_DAYS = 28;
/** Below this, a baseline is a guess: the monitor says `learning` and never fires. */
export const LEARNING_DAYS = 14;
/** MAD to a standard deviation, for a normal distribution. */
const MAD_TO_SIGMA = 1.4826;
/** Robust z above which a value is called an anomaly. */
export const ANOMALY_Z = 3;

/** The spread of a set of samples, as the anomaly rule reads it. */
export function baselineOf(values: number[], days: number): Baseline {
  return { ...spread(values), samples: values.length, days };
}

function spread(values: number[]): { median: number; mad: number } {
  if (values.length === 0) return { median: 0, mad: 0 };
  const median = medianOf(values);
  const mad = medianOf(values.map((v) => Math.abs(v - median)));
  return { median, mad };
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** How far from normal, in robust standard deviations. */
export function robustZ(value: number, baseline: Baseline): number {
  // A MAD of zero means a series that never moved. Comparing against a spread
  // of nothing would make every change infinitely anomalous, so a floor of one
  // per cent of the median stands in — and a flat-zero series with a flat-zero
  // median only counts as anomalous once it is no longer zero.
  const sigma = baseline.mad * MAD_TO_SIGMA || Math.abs(baseline.median) * 0.01 || 0;
  if (sigma === 0) return value === baseline.median ? 0 : Number.POSITIVE_INFINITY;
  return (value - baseline.median) / sigma;
}

/* ---------- The verdict ---------- */

export type Verdict = "ok" | "breaching" | "learning";

export function verdictFor(
  value: number,
  condition: TelemetryCondition,
  baseline?: Baseline,
): { verdict: Verdict; why: string } {
  if (condition.kind === "threshold") {
    const breached = compare(value, condition.op, condition.value);
    return {
      verdict: breached ? "breaching" : "ok",
      why: `${round(value)} ${breached ? "" : "not "}${condition.op} ${condition.value}`,
    };
  }
  if (!baseline || baseline.samples === 0) {
    return { verdict: "learning", why: "no history to compare against yet" };
  }
  if (baseline.days < LEARNING_DAYS) {
    return {
      verdict: "learning",
      why: `${Math.floor(baseline.days)} of ${LEARNING_DAYS} days of history`,
    };
  }
  const z = robustZ(value, baseline);
  const wanted =
    condition.direction === "high" ? z : condition.direction === "low" ? -z : Math.abs(z);
  const breached = wanted > ANOMALY_Z;
  return {
    verdict: breached ? "breaching" : "ok",
    why: `${round(value)} against a usual ${round(baseline.median)} (${round(z)} σ)`,
  };
}

function compare(value: number, op: string, against: number): boolean {
  switch (op) {
    case ">":
      return value > against;
    case ">=":
      return value >= against;
    case "<":
      return value < against;
    case "<=":
      return value <= against;
    case "==":
      return value === against;
    case "!=":
      return value !== against;
    default:
      return false;
  }
}

function round(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return Math.abs(n) >= 100 ? n.toFixed(0) : Number(n.toFixed(3)).toString();
}
