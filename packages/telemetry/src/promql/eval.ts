/**
 * Evaluating the subset: ClickHouse filters, this file computes.
 *
 * Compiling arbitrary PromQL into one SQL statement is possible and awful —
 * `rate()` over a counter that resets, aggregation across labels, binary
 * operators between two vectors, each becomes a nest of window functions
 * nobody can read or verify. So the split is: the store does what it is good
 * at, selecting a window of one metric's points by label, and the semantics
 * are computed here, where they can be read against the Prometheus
 * documentation line by line.
 *
 * The volume this puts in memory is bounded by the selector, the window and
 * `maxPoints` — and the query fails loudly past it rather than quietly
 * sampling, because a graph that silently dropped half its points is a graph
 * that lies about an outage.
 */
import { read } from "../query";
import { PromqlError, parsePromql, type Matcher, type Node } from "./parse";

export type Sample = { t: number; v: number };
export type Series = { labels: Record<string, string>; points: Sample[] };

export type EvalOptions = {
  /** Instant query: one timestamp. Range query: start, end and step, in ms. */
  start: number;
  end: number;
  stepMs: number;
  maxPoints?: number;
};

const MAX_POINTS = 1_100_000;

/** `__name__` is Prometheus' own spelling for the metric name. */
function labelsOf(metric: string, attributes: Record<string, string>): Record<string, string> {
  return { __name__: metric, ...attributes };
}

function matches(labels: Record<string, string>, m: Matcher): boolean {
  const value = labels[m.label] ?? "";
  switch (m.op) {
    case "=":
      return value === m.value;
    case "!=":
      return value !== m.value;
    // Prometheus anchors regex matchers at both ends; a matcher that did not
    // would quietly select more series than the same query does upstream.
    case "=~":
      return new RegExp(`^(?:${m.value})$`).test(value);
    case "!~":
      return !new RegExp(`^(?:${m.value})$`).test(value);
  }
}

type RawSeries = { hash: string; labels: Record<string, string>; points: Sample[] };

/**
 * The points a selector needs, read once per evaluation.
 *
 * Reads the raw tables below seven days and the per-minute rollup above,
 * because that is the difference between a month-long graph answering in a
 * second and in a minute. The boundary is visible here rather than hidden in a
 * setting: above it, a point is a minute, and `rate()` over a one-minute
 * rollup is an approximation the caller can reason about.
 */
async function fetchSeries(
  tenantId: string,
  sel: Extract<Node, { kind: "selector" }>,
  from: number,
  to: number,
): Promise<RawSeries[]> {
  const rollup = to - from > 7 * 86_400_000;
  const table = rollup
    ? "metric_1m_t(tenant = {tenant:UUID})"
    : `(SELECT tenant_id, metric_name, attributes_hash, attributes, ts, value FROM otel_metrics_gauge_t(tenant = {tenant:UUID})
        UNION ALL
        SELECT tenant_id, metric_name, attributes_hash, attributes, ts, value FROM otel_metrics_sum_t(tenant = {tenant:UUID}))`;

  const rows = rollup
    ? await read<{ h: string; t: string; v: number }>(
        tenantId,
        `SELECT toString(r.attributes_hash) AS h, toString(toUnixTimestamp64Milli(toDateTime64(r.minute, 3))) AS t, r.last AS v
           FROM ${table} AS r
          WHERE r.metric_name = {name:String} AND r.minute BETWEEN {from:DateTime64(3)} AND {to:DateTime64(3)}
          ORDER BY r.minute`,
        { params: { name: sel.metric, from: from / 1000, to: to / 1000 }, maxRows: MAX_POINTS },
      )
    : await read<{ h: string; t: string; v: number }>(
        tenantId,
        `SELECT toString(p.attributes_hash) AS h, toString(toUnixTimestamp64Milli(p.ts)) AS t, p.value AS v
           FROM ${table} AS p
          WHERE p.metric_name = {name:String} AND p.ts BETWEEN {from:DateTime64(3)} AND {to:DateTime64(3)}
          ORDER BY p.ts`,
        { params: { name: sel.metric, from: from / 1000, to: to / 1000 }, maxRows: MAX_POINTS },
      );

  // Labels come from the catalogue: a series that stopped reporting mid-window
  // still has a name, and dropping it would hide exactly the outage somebody
  // is looking for.
  const labels = await read<{ h: string; a: Record<string, string> }>(
    tenantId,
    `SELECT toString(attributes_hash) AS h, attributes AS a
       FROM metric_series_t(tenant = {tenant:UUID})
      WHERE metric_name = {name:String}`,
    { params: { name: sel.metric } },
  );
  const byHash = new Map(labels.map((l) => [l.h, labelsOf(sel.metric, l.a)]));

  const grouped = new Map<string, Sample[]>();
  for (const r of rows) {
    const list = grouped.get(r.h) ?? [];
    list.push({ t: Number(r.t), v: Number(r.v) });
    grouped.set(r.h, list);
  }

  const out: RawSeries[] = [];
  for (const [hash, l] of byHash) {
    if (!sel.matchers.every((m) => matches(l, m))) continue;
    out.push({ hash, labels: l, points: grouped.get(hash) ?? [] });
  }
  return out;
}

/** The value of a series at `t`, Prometheus-style: the last point within 5 minutes. */
function valueAt(points: Sample[], t: number, lookback = 300_000): number | null {
  let out: number | null = null;
  for (const p of points) {
    if (p.t > t) break;
    if (t - p.t <= lookback) out = p.v;
  }
  return out;
}

function windowOf(points: Sample[], t: number, range: number): Sample[] {
  return points.filter((p) => p.t > t - range && p.t <= t);
}

/**
 * `rate` and `increase`, including the counter reset.
 *
 * A counter that goes backwards has restarted, and Prometheus treats the drop
 * as a reset rather than a negative rate. Getting this wrong produces enormous
 * negative spikes at every deploy, which is the single most recognisable sign
 * of a home-made implementation.
 */
function counterDelta(win: Sample[]): number {
  let total = 0;
  for (let i = 1; i < win.length; i++) {
    const prev = win[i - 1]!.v;
    const cur = win[i]!.v;
    total += cur >= prev ? cur - prev : cur;
  }
  return total;
}

function applyOverTime(name: string, win: Sample[]): number | null {
  if (win.length === 0) return null;
  const vs = win.map((p) => p.v);
  switch (name) {
    case "avg_over_time":
      return vs.reduce((a, b) => a + b, 0) / vs.length;
    case "sum_over_time":
      return vs.reduce((a, b) => a + b, 0);
    case "min_over_time":
      return Math.min(...vs);
    case "max_over_time":
      return Math.max(...vs);
    case "count_over_time":
      return vs.length;
    case "last_over_time":
      return vs[vs.length - 1]!;
    default:
      return null;
  }
}

type Ctx = { tenantId: string; grid: number[] };

async function evaluate(node: Node, ctx: Ctx): Promise<Series[]> {
  switch (node.kind) {
    case "number":
      return [{ labels: {}, points: ctx.grid.map((t) => ({ t, v: node.value })) }];

    case "selector": {
      if (node.range !== undefined)
        throw new PromqlError(
          "a range vector must be inside a function such as rate() or avg_over_time()",
          "range vector",
        );
      const shift = node.offset ?? 0;
      const raw = await fetchSeries(
        ctx.tenantId,
        node,
        ctx.grid[0]! - shift - 300_000,
        ctx.grid[ctx.grid.length - 1]! - shift,
      );
      return raw.map((s) => ({
        labels: s.labels,
        points: ctx.grid
          .map((t) => ({ t, v: valueAt(s.points, t - shift) }))
          .filter((p): p is Sample => p.v !== null),
      }));
    }

    case "call":
      return evaluateCall(node, ctx);

    case "aggregation":
      return aggregate(node, await evaluate(node.arg, ctx), ctx);

    case "binary": {
      const [l, r] = await Promise.all([evaluate(node.left, ctx), evaluate(node.right, ctx)]);
      return binary(node.op, l, r);
    }
  }
}

async function evaluateCall(node: Extract<Node, { kind: "call" }>, ctx: Ctx): Promise<Series[]> {
  const RANGE_FUNCTIONS = new Set([
    "rate",
    "irate",
    "increase",
    "delta",
    "avg_over_time",
    "sum_over_time",
    "min_over_time",
    "max_over_time",
    "count_over_time",
    "last_over_time",
  ]);

  if (RANGE_FUNCTIONS.has(node.name)) {
    const arg = node.args[0];
    if (!arg || arg.kind !== "selector" || arg.range === undefined)
      throw new PromqlError(`"${node.name}" needs a range vector such as metric[5m]`, node.name);
    const range = arg.range;
    const shift = arg.offset ?? 0;
    const raw = await fetchSeries(
      ctx.tenantId,
      arg,
      ctx.grid[0]! - shift - range,
      ctx.grid[ctx.grid.length - 1]! - shift,
    );
    return raw.map((s) => ({
      labels:
        node.name === "rate" || node.name === "irate" || node.name === "increase"
          ? withoutName(s.labels)
          : s.labels,
      points: ctx.grid
        .map((t) => {
          const win = windowOf(s.points, t - shift, range);
          if (win.length < 2 && node.name !== "count_over_time" && node.name !== "last_over_time")
            return { t, v: null };
          switch (node.name) {
            case "rate":
              return { t, v: counterDelta(win) / (range / 1000) };
            case "increase":
              return { t, v: counterDelta(win) };
            case "irate": {
              const a = win[win.length - 2]!;
              const b = win[win.length - 1]!;
              const dt = (b.t - a.t) / 1000;
              return { t, v: dt > 0 ? (b.v >= a.v ? b.v - a.v : b.v) / dt : 0 };
            }
            case "delta":
              return { t, v: win[win.length - 1]!.v - win[0]!.v };
            default:
              return { t, v: applyOverTime(node.name, win) };
          }
        })
        .filter((p): p is Sample => p.v !== null && Number.isFinite(p.v)),
    }));
  }

  const inner = await evaluate(node.args[0]!, ctx);
  const scalar = (i: number): number => {
    const a = node.args[i];
    if (!a || a.kind !== "number")
      throw new PromqlError(`"${node.name}" needs a number as argument ${i + 1}`, node.name);
    return a.value;
  };
  const map = (f: (v: number) => number) =>
    inner.map((s) => ({ labels: s.labels, points: s.points.map((p) => ({ t: p.t, v: f(p.v) })) }));

  switch (node.name) {
    case "abs":
      return map(Math.abs);
    case "clamp_min":
      return map((v) => Math.max(v, scalar(1)));
    case "clamp_max":
      return map((v) => Math.min(v, scalar(1)));
    case "round": {
      const to = node.args[1] ? scalar(1) : 1;
      return map((v) => Math.round(v / to) * to);
    }
    default:
      throw new PromqlError(`"${node.name}" is not supported yet`, node.name);
  }
}

/**
 * `rate()` and friends drop `__name__`, as Prometheus does: the result is no
 * longer that metric, it is a rate derived from it, and keeping the name would
 * make two different things collide in an aggregation.
 */
function withoutName(labels: Record<string, string>): Record<string, string> {
  const rest = { ...labels };
  delete rest.__name__;
  return rest;
}

/**
 * The group a series belongs to.
 *
 * The three cases are genuinely three, and treating "no modifier" as "without
 * nothing" is the bug this replaced: `sum(x)` then kept every label, so every
 * series was its own group and the most common expression in PromQL quietly
 * did nothing. A dashboard panel asking for a total drew one line per series
 * and looked plausible.
 */
function keyFor(
  labels: Record<string, string>,
  grouping: "none" | "by" | "without",
  chosen: string[],
): string {
  const entries =
    grouping === "none"
      ? []
      : Object.entries(labels).filter(([k]) =>
          grouping === "by" ? chosen.includes(k) : !chosen.includes(k) && k !== "__name__",
        );
  entries.sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

function aggregate(
  node: Extract<Node, { kind: "aggregation" }>,
  input: Series[],
  ctx: Ctx,
): Series[] {
  if (node.op === "topk" || node.op === "bottomk") {
    const k = node.param?.kind === "number" ? node.param.value : 0;
    const last = (s: Series) => s.points[s.points.length - 1]?.v ?? Number.NaN;
    const ranked = [...input].sort((a, b) =>
      node.op === "topk" ? last(b) - last(a) : last(a) - last(b),
    );
    return ranked.slice(0, Math.max(0, k));
  }

  const groups = new Map<string, { labels: Record<string, string>; series: Series[] }>();
  for (const s of input) {
    const key = keyFor(s.labels, node.grouping, node.labels);
    const labels = Object.fromEntries(JSON.parse(key) as [string, string][]);
    const g = groups.get(key) ?? { labels, series: [] };
    g.series.push(s);
    groups.set(key, g);
  }

  return [...groups.values()].map((g) => ({
    labels: g.labels,
    points: ctx.grid
      .map((t) => {
        const values = g.series
          .map((s) => s.points.find((p) => p.t === t)?.v)
          .filter((v): v is number => v !== undefined);
        if (values.length === 0) return { t, v: null };
        switch (node.op) {
          case "sum":
            return { t, v: values.reduce((a, b) => a + b, 0) };
          case "avg":
            return { t, v: values.reduce((a, b) => a + b, 0) / values.length };
          case "min":
            return { t, v: Math.min(...values) };
          case "max":
            return { t, v: Math.max(...values) };
          case "count":
            return { t, v: values.length };
          default:
            return { t, v: null };
        }
      })
      .filter((p): p is Sample => p.v !== null),
  }));
}

const OPS: Record<string, (a: number, b: number) => number> = {
  "+": (a, b) => a + b,
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "/": (a, b) => (b === 0 ? Number.NaN : a / b),
  "%": (a, b) => (b === 0 ? Number.NaN : a % b),
  "^": (a, b) => a ** b,
  "==": (a, b) => (a === b ? a : Number.NaN),
  "!=": (a, b) => (a !== b ? a : Number.NaN),
  ">": (a, b) => (a > b ? a : Number.NaN),
  "<": (a, b) => (a < b ? a : Number.NaN),
  ">=": (a, b) => (a >= b ? a : Number.NaN),
  "<=": (a, b) => (a <= b ? a : Number.NaN),
};

function binary(op: string, left: Series[], right: Series[]): Series[] {
  const f = OPS[op];
  if (!f) throw new PromqlError(`operator "${op}" is not supported yet`, op);

  const scalarOf = (side: Series[]): number | null =>
    side.length === 1 && Object.keys(side[0]!.labels).length === 0
      ? (side[0]!.points[0]?.v ?? null)
      : null;

  const rs = scalarOf(right);
  if (rs !== null) return apply(left, (v) => f(v, rs));
  const ls = scalarOf(left);
  if (ls !== null) return apply(right, (v) => f(ls, v));

  // Vector-to-vector needs label matching, which is where Prometheus'
  // semantics get genuinely subtle. Refused by name rather than approximated.
  throw new PromqlError(
    `"${op}" between two vectors is not supported yet — one side must be a scalar`,
    "vector matching",
  );
}

function apply(series: Series[], f: (v: number) => number): Series[] {
  return series.map((s) => ({
    labels: s.labels,
    points: s.points.map((p) => ({ t: p.t, v: f(p.v) })).filter((p) => Number.isFinite(p.v)),
  }));
}

export async function evalPromql(
  tenantId: string,
  query: string,
  opts: EvalOptions,
): Promise<Series[]> {
  const grid: number[] = [];
  const step = Math.max(1000, opts.stepMs);
  for (let t = opts.start; t <= opts.end; t += step) grid.push(t);
  if (grid.length === 0) grid.push(opts.end);
  if (grid.length > (opts.maxPoints ?? 11_000))
    throw new PromqlError(
      `this range and step would produce ${grid.length} points; widen the step`,
      "step",
    );
  return evaluate(parsePromql(query), { tenantId, grid });
}
