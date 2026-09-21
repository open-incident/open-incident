/**
 * The shape of a window, for the two screens that are searches.
 *
 * A list answers "what happened"; it cannot answer "when, and how much of it".
 * Both of these exist so the reader sees the shape before reading the rows: a
 * log histogram where the spike is obvious and clickable, a latency scatter
 * where the one slow request is a dot away from the cloud the other ten
 * thousand form.
 *
 * Both are cheap by construction. The histogram is one aggregation over the
 * window's partitions; the scatter takes a fixed number of traces per bucket
 * (`LIMIT n BY`) rather than all of them, so its cost is the number of dots
 * drawn and not the number of traces that exist — plus the slowest and the
 * failed ones on purpose, because a sample that drops the outlier drops the
 * only row somebody came for.
 */
import { compileFilter } from "./filter";
import { chTime, read } from "./query";
import { LOGS, SPANS, TRACE_BANDS } from "./views";

export type SeverityBucket = {
  /** Start of the bucket, in epoch milliseconds. */
  at: number;
  error: number;
  warn: number;
  info: number;
};

export type LogShape = {
  buckets: SeverityBucket[];
  /** Bucket width, so the caller can say what a bar covers. */
  stepMs: number;
  totals: { error: number; warn: number; info: number };
};

/** Bars the eye can still separate, over any window. */
const BUCKETS = 72;

function bucketSeconds(from: Date, to: Date): number {
  const span = Math.max(60_000, to.getTime() - from.getTime());
  return Math.max(60, Math.round(span / BUCKETS / 1000));
}

/**
 * How many lines, when, and how bad — for the histogram above the log list.
 *
 * The three severity bands rather than every level: a stacked bar with nine
 * colours is a bar nobody reads, and the question a log histogram answers is
 * "was this normal, noisy, or on fire".
 */
export async function logHistogram(
  tenantId: string,
  opts: { from: Date; to: Date; filter?: string; service?: string },
): Promise<LogShape> {
  const step = bucketSeconds(opts.from, opts.to);
  const where = ["ts >= {fromTs:DateTime64(9)}", "ts <= {toTs:DateTime64(9)}"];
  const params: Record<string, unknown> = {
    fromTs: chTime(opts.from),
    toTs: chTime(opts.to),
    step,
  };
  if (opts.service) {
    where.push("service_name = {service:String}");
    params.service = opts.service;
  }
  if (opts.filter?.trim()) {
    const compiled = compileFilter("logs", opts.filter);
    where.push(compiled.sql);
    Object.assign(params, compiled.params);
  }
  const rows = await read<{ bucket: string; err: string; warn: string; info: string }>(
    tenantId,
    `SELECT toString(toUnixTimestamp(toStartOfInterval(ts, INTERVAL {step:UInt32} SECOND))) AS bucket,
            toString(countIf(severity_number >= 17)) AS err,
            toString(countIf(severity_number >= 13 AND severity_number < 17)) AS warn,
            toString(countIf(severity_number < 13)) AS info
       FROM ${LOGS}
      WHERE ${where.join(" AND ")}
      GROUP BY bucket
      ORDER BY bucket`,
    { params, maxRows: BUCKETS * 4 },
  );
  const buckets = rows.map((r) => ({
    at: Number(r.bucket) * 1000,
    error: Number(r.err),
    warn: Number(r.warn),
    info: Number(r.info),
  }));
  return {
    buckets,
    stepMs: step * 1000,
    totals: {
      error: buckets.reduce((n, b) => n + b.error, 0),
      warn: buckets.reduce((n, b) => n + b.warn, 0),
      info: buckets.reduce((n, b) => n + b.info, 0),
    },
  };
}

export type ScatterPoint = {
  traceId: string;
  /** Epoch milliseconds. */
  at: number;
  ms: number;
  error: boolean;
  root: string;
};

export type LatencyShape = {
  points: ScatterPoint[];
  /** Over the whole window, not over the sample. */
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  traces: number;
};

/**
 * A cloud of requests, and the ones worth clicking.
 *
 * Three groups, deliberately: a fixed number per time bucket so the cloud has
 * an even shape across the window, the slowest of the window so the tail is
 * always drawn, and the failures so they are always drawn. A uniform sample
 * would hide exactly the two kinds of dot somebody opens.
 */
export async function traceScatter(
  tenantId: string,
  opts: { from: Date; to: Date; filter?: string; service?: string; perBucket?: number },
): Promise<LatencyShape> {
  const step = bucketSeconds(opts.from, opts.to);
  const params: Record<string, unknown> = {
    fromTs: chTime(opts.from),
    toTs: chTime(opts.to),
    from: chTime(opts.from).slice(0, 19),
    to: chTime(opts.to).slice(0, 19),
    step,
    perBucket: opts.perBucket ?? 20,
    // Empty means every service, which the view reads rather than the caller
    // picking a row out of a per-service grouping.
    serviceOrAll: opts.service ?? "",
  };

  /*
   * The dots come from the root spans, not from the trace index.
   *
   * A root span already carries what a dot needs — when the request started,
   * how long it took, whether it failed — so there is nothing to merge. The
   * first version read the index and merged an aggregate state per trace:
   * 2.3 s and a gigabyte of RAM for one hour of a busy window, against 62 ms
   * and 56 MiB here.
   */
  const where = [
    "s.parent_span_id = ''",
    "s.start_ts >= {fromTs:DateTime64(9)}",
    "s.start_ts <= {toTs:DateTime64(9)}",
  ];
  if (opts.service) {
    where.push("s.service_name = {service:String}");
    params.service = opts.service;
  }
  if (opts.filter?.trim()) {
    const compiled = compileFilter("traces", opts.filter);
    where.push(compiled.sql);
    Object.assign(params, compiled.params);
  }

  const [even, tail, stats] = await Promise.all([
    // An even sample: n per bucket, picked by a hash of the id so the cloud has
    // the shape of the traffic and the same window always draws the same dots.
    read<Dot>(
      tenantId,
      `SELECT s.trace_id AS trace_id,
              toString(toUnixTimestamp64Milli(s.start_ts)) AS at,
              s.duration_ns / 1000000 AS ms,
              toString(s.status_code) AS status,
              s.name AS root
         FROM ${SPANS} AS s
        WHERE ${where.join(" AND ")}
        ORDER BY cityHash64(s.trace_id)
        LIMIT {perBucket:UInt32} BY toStartOfInterval(s.start_ts, INTERVAL {step:UInt32} SECOND)`,
      { params, maxRows: BUCKETS * (opts.perBucket ?? 20) + 200 },
    ),
    // The tail and the failures, which are the dots somebody opens. A sample
    // that loses them is a picture of the boring part of the window.
    read<Dot>(
      tenantId,
      `SELECT s.trace_id AS trace_id,
              toString(toUnixTimestamp64Milli(s.start_ts)) AS at,
              s.duration_ns / 1000000 AS ms,
              toString(s.status_code) AS status,
              s.name AS root
         FROM ${SPANS} AS s
        WHERE ${where.join(" AND ")} AND (s.status_code = 'error' OR s.duration_ns > 0)
        ORDER BY s.status_code = 'error' DESC, s.duration_ns DESC
        LIMIT 160`,
      { params, maxRows: 200 },
    ),
    /*
     * The quantiles come from the per-minute rollup, where they are merged
     * states rather than a scan: exact over the window, and the same cost at
     * any width. Reading them from the traces cost 1.9 s and 280 MiB.
     */
    read<{ p50: number; p95: number; p99: number; n: string }>(
      tenantId,
      // The view has already merged the states into numbers; merging them
      // again here is what the first version tried, and ClickHouse said so.
      `SELECT r.p50_ns / 1000000 AS p50,
              r.p95_ns / 1000000 AS p95,
              r.p99_ns / 1000000 AS p99,
              toString(r.traces) AS n
         FROM trace_1m_all_t(tenant = {tenant:UUID}, from = {from:DateTime},
                             to = {to:DateTime}, service = {serviceOrAll:String}) AS r`,
      { params },
    ),
  ]);

  const byId = new Map<string, ScatterPoint>();
  for (const r of [...even, ...tail]) {
    byId.set(r.trace_id, {
      traceId: r.trace_id,
      at: Number(r.at),
      ms: Number(r.ms),
      error: r.status === "error",
      root: r.root,
    });
  }

  return {
    points: [...byId.values()],
    p50Ms: Number(stats[0]?.p50 ?? 0),
    p95Ms: Number(stats[0]?.p95 ?? 0),
    p99Ms: Number(stats[0]?.p99 ?? 0),
    traces: Number(stats[0]?.n ?? 0),
  };
}

type Dot = { trace_id: string; at: string; ms: number; status: string; root: string };

export type LatencyBand = {
  /** Start of the bucket, in epoch milliseconds. */
  at: number;
  traces: number;
  errors: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  slowestMs: number;
};

export type BandShape = { bands: LatencyBand[]; stepMs: number };

/**
 * The shape of a window at any width, from the rollup.
 *
 * This is what replaced the scatter as the default drawing, and the reason is
 * arithmetic rather than taste: a dot is one trace, so a cloud costs the
 * window. Seven days of traces was 7 million rows merged and 22 seconds; the
 * same seven days of bands is ten thousand rows and under a second.
 *
 * `service` is honoured — the rollup is keyed by the root service — and a
 * field filter is not: there is nothing in a pre-aggregated minute to apply
 * `http_route = '/pay'` to. The screen says so rather than drawing a shape
 * that ignores the filter above it.
 */
export async function latencyBands(
  tenantId: string,
  opts: { from: Date; to: Date; service?: string },
): Promise<BandShape> {
  const step = bucketSeconds(opts.from, opts.to);
  const params: Record<string, unknown> = {
    from: chTime(opts.from).slice(0, 19),
    to: chTime(opts.to).slice(0, 19),
    step,
  };
  const where: string[] = [];
  if (opts.service) {
    where.push("b.root_service = {service:String}");
    params.service = opts.service;
  }
  const rows = await read<{
    at: string;
    traces: string;
    errors: string;
    p50: number;
    p95: number;
    p99: number;
    slowest: number;
  }>(
    tenantId,
    `SELECT toString(toUnixTimestamp(b.bucket)) AS at,
            toString(sum(b.traces)) AS traces,
            toString(sum(b.errors)) AS errors,
            max(b.p50_ns) / 1000000 AS p50,
            max(b.p95_ns) / 1000000 AS p95,
            max(b.p99_ns) / 1000000 AS p99,
            max(b.slowest_ns) / 1000000 AS slowest
       FROM ${TRACE_BANDS} AS b
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY at
      ORDER BY at`,
    { params, maxRows: BUCKETS * 4 },
  );
  return {
    stepMs: step * 1000,
    bands: rows.map((r) => ({
      at: Number(r.at) * 1000,
      traces: Number(r.traces),
      errors: Number(r.errors),
      p50Ms: Number(r.p50),
      p95Ms: Number(r.p95),
      p99Ms: Number(r.p99),
      slowestMs: Number(r.slowest),
    })),
  };
}

export type MetricLine = { label: string; points: Array<{ at: number; value: number }> };
export type MetricGraph = {
  lines: MetricLine[];
  stepMs: number;
  /** Which label the lines were split on, and which ones could be. */
  groupBy: string | null;
  labelKeys: string[];
  agg: "avg" | "sum" | "max";
};

/**
 * One metric, as one chart.
 *
 * The screen used to draw a separate little chart per series, stacked — so a
 * metric with four hosts was four drawings whose y axes had nothing to do with
 * each other, and comparing two hosts meant comparing two pictures. Lines in
 * one box, on one scale, is the whole point of a chart.
 *
 * The aggregation is stated rather than assumed: a gauge is averaged over the
 * bucket, a counter is summed, and the screen says which. Both are computed
 * from the per-minute rollup, so the cost is the number of buckets drawn.
 */
export async function metricGraph(
  tenantId: string,
  opts: {
    metric: string;
    from: Date;
    to: Date;
    /** A label key to split the lines on; without it, one line. */
    groupBy?: string;
    agg?: "avg" | "sum" | "max";
    /** How many lines before the rest are dropped, loudest first. */
    lines?: number;
  },
): Promise<MetricGraph> {
  const step = bucketSeconds(opts.from, opts.to);
  const agg = opts.agg ?? "avg";
  const params: Record<string, unknown> = {
    metric: opts.metric,
    fromTs: chTime(opts.from),
    toTs: chTime(opts.to),
    step,
  };

  const keys = await read<{ key: string }>(
    tenantId,
    `SELECT DISTINCT arrayJoin(mapKeys(c.attributes)) AS key
       FROM metric_series_t(tenant = {tenant:UUID}) AS c
      WHERE c.metric_name = {metric:String}`,
    { params: { metric: opts.metric }, maxRows: 60 },
  );
  const labelKeys = keys.map((k) => k.key).sort();
  const groupBy = opts.groupBy && labelKeys.includes(opts.groupBy) ? opts.groupBy : null;
  if (groupBy) params.groupBy = groupBy;

  /*
   * The value read per minute is `last` — the newest sample of that minute —
   * and the bucket aggregates those. A gauge asked for its average over ten
   * minutes means the average of its values, not of its samples, and the
   * rollup is the only place that distinction survives.
   */
  const value = agg === "sum" ? "sum(s.sum)" : agg === "max" ? "max(s.max)" : "avg(s.last)";
  const rows = await read<{ at: string; label: string; value: number }>(
    tenantId,
    `SELECT toString(toUnixTimestamp(toStartOfInterval(s.minute, INTERVAL {step:UInt32} SECOND))) AS at,
            ${groupBy ? "c.attributes[{groupBy:String}]" : "''"} AS label,
            ${value} AS value
       FROM metric_1m_t(tenant = {tenant:UUID}) AS s
       ${
         groupBy
           ? `INNER JOIN metric_series_t(tenant = {tenant:UUID}) AS c
                ON c.metric_name = s.metric_name AND c.attributes_hash = s.attributes_hash`
           : ""
       }
      WHERE s.metric_name = {metric:String}
        AND s.minute >= {fromTs:DateTime64(3)}
        AND s.minute <= {toTs:DateTime64(3)}
      GROUP BY at, label
      ORDER BY at`,
    { params, maxRows: 20_000 },
  );

  const byLabel = new Map<string, MetricLine>();
  for (const r of rows) {
    const key = r.label || "—";
    const line = byLabel.get(key) ?? { label: key, points: [] };
    line.points.push({ at: Number(r.at) * 1000, value: Number(r.value) });
    byLabel.set(key, line);
  }
  const cap = opts.lines ?? 8;
  const lines = [...byLabel.values()]
    // Loudest first, so the cap drops the quiet ones rather than the first
    // eight the store happened to return.
    .sort(
      (a, b) =>
        Math.max(...b.points.map((p) => p.value)) - Math.max(...a.points.map((p) => p.value)),
    )
    .slice(0, cap);

  return { lines, stepMs: step * 1000, groupBy, labelKeys, agg };
}

/** A sparkline per metric, for the catalogue: which of these is moving. */
export async function metricSparklines(
  tenantId: string,
  opts: { from: Date; to: Date; buckets?: number },
): Promise<Map<string, number[]>> {
  const span = Math.max(60_000, opts.to.getTime() - opts.from.getTime());
  const step = Math.max(60, Math.round(span / (opts.buckets ?? 24) / 1000));
  const rows = await read<{ metric: string; at: string; value: number }>(
    tenantId,
    `SELECT s.metric_name AS metric,
            toString(toUnixTimestamp(toStartOfInterval(s.minute, INTERVAL {step:UInt32} SECOND))) AS at,
            avg(s.last) AS value
       FROM metric_1m_t(tenant = {tenant:UUID}) AS s
      WHERE s.minute >= {fromTs:DateTime64(3)} AND s.minute <= {toTs:DateTime64(3)}
      GROUP BY metric, at
      ORDER BY metric, at`,
    {
      params: { fromTs: chTime(opts.from), toTs: chTime(opts.to), step },
      maxRows: 20_000,
    },
  );
  const out = new Map<string, number[]>();
  for (const r of rows) {
    const list = out.get(r.metric) ?? [];
    list.push(Number(r.value));
    out.set(r.metric, list);
  }
  return out;
}
