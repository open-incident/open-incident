import Link from "next/link";
import type { ChartPoint, ChartSpec } from "@openincident/ui";
import {
  serviceDependencies,
  serviceEndpoints,
  serviceGolden,
  serviceMetrics,
  serviceRuntime,
  servicesTable,
  serviceTraceCount,
  type DependencyBucket,
  type GoldenBucket,
  type MetricBucket,
} from "@openincident/telemetry";
import { getT } from "@/i18n/server";
import {
  annotationsFor,
  atlasNote,
  latencyThreshold,
  type TelemetrySearch,
} from "@/lib/telemetry-board";
import { bucketStarts, pickStep, resolveWindow } from "@/lib/telemetry-window";
import { AtlasBanner } from "./atlas-banner";
import { MetricsBoard, type MetricsSection } from "./metrics-board";

/**
 * Telemetry — Metrics (design: "Telemetry — Metrics", delta §7.2).
 *
 * One service at a time, three sections: the golden signals from its entry
 * spans, its runtime from the metrics it reports, and what it calls from its
 * client spans and its queue metric — every chart on the same window and the
 * same crosshair, zoomable together, and comparable with the same window a day
 * earlier (really read again, not redrawn). A series the service does not
 * send is an empty chart that says which metric is missing.
 */
const RANGES = {
  "15m": 15 * 60_000,
  "1h": 3_600_000,
  "6h": 6 * 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
};
const DAY = 86_400_000;

const MEMORY = ["process.memory.rss", "process.memory.usage"];
const CPU = ["process.cpu.utilization"];
const LOOP = ["nodejs.eventloop.delay.p99"];
const GC = ["nodejs.gc.duration.p99", "v8js.gc.duration.p99"];
const POOL_USED = "db.client.connections.usage";
const POOL_MAX = "db.client.connections.max";
const POOL_WAIT = "db.client.connections.pending_requests";
const LIMIT = "k8s.container.memory_limit";
const LAG = "messaging.kafka.consumer.lag";
const METRICS = [...MEMORY, ...CPU, ...LOOP, ...GC, POOL_USED, POOL_MAX, POOL_WAIT, LIMIT, LAG];

const PEER_COLOURS = ["var(--brand)", "var(--ok)", "var(--viol)", "var(--wait)"];

export async function MetricsView({ tenantId, sp }: { tenantId: string; sp: TelemetrySearch }) {
  const t = await getT();
  const win = resolveWindow(sp, RANGES, "1h");
  const from = new Date(win.from);
  const to = new Date(win.to);
  const step = pickStep(win.to - win.from, { points: 80, min: 10_000 });
  const metricStep = Math.max(step, 60_000);
  const grid = bucketStarts(win.from, win.to, step);
  const mgrid = bucketStarts(win.from, win.to, metricStep);
  const compare = sp.cmp === "1";

  // The services to choose from: whatever reported in the last day, the
  // most troubled first — which is the one somebody opened this tab for.
  const now = Date.now();
  const day = await servicesTable(tenantId, { from: new Date(now - DAY), to: new Date(now) }, 4);
  const chips = [...day]
    .sort((a, b) => b.errorRate - a.errorRate || b.rps - a.rps)
    .map((s) => ({
      n: s.service,
      dot: s.errorRate > 0.05 ? "var(--dang)" : s.errorRate > 0.01 ? "var(--wait)" : "var(--ok)",
    }));
  // A service named in the address is honoured even when it was quiet today.
  const service = sp.service || chips[0]?.n;

  if (!service) {
    return (
      <div
        data-screen-label="Telemetry — Metrics"
        style={{
          border: "1px dashed var(--line)",
          borderRadius: "var(--radius-card)",
          padding: 28,
          fontSize: 13,
          color: "var(--ink-2)",
        }}
      >
        {t("tel2.metricsEmpty")}
      </div>
    );
  }

  const w = { from, to, stepSeconds: step / 1000 };
  const mw = { from, to, stepSeconds: metricStep / 1000 };
  const shifted = (x: { from: Date; to: Date; stepSeconds: number }) => ({
    from: new Date(x.from.getTime() - DAY),
    to: new Date(x.to.getTime() - DAY),
    stepSeconds: x.stepSeconds,
  });
  const [
    golden,
    deps,
    metrics,
    runtime,
    endpoints,
    notes,
    threshold,
    note,
    traces,
    yGolden,
    yDeps,
    yMetrics,
  ] = await Promise.all([
    serviceGolden(tenantId, service, w),
    serviceDependencies(tenantId, service, w),
    serviceMetrics(tenantId, service, METRICS, mw),
    serviceRuntime(tenantId, service),
    serviceEndpoints(tenantId, service, { from, to }),
    annotationsFor(tenantId, service, from, to),
    latencyThreshold(tenantId, service),
    atlasNote(tenantId, service),
    serviceTraceCount(tenantId, service, { from, to }),
    compare ? serviceGolden(tenantId, service, shifted(w)) : Promise.resolve([] as GoldenBucket[]),
    compare
      ? serviceDependencies(tenantId, service, shifted(w))
      : Promise.resolve([] as DependencyBucket[]),
    compare
      ? serviceMetrics(tenantId, service, METRICS, shifted(mw))
      : Promise.resolve([] as MetricBucket[]),
  ]);

  // ---- Helpers that put rows on the grid ----------------------------------
  const onGrid = <R extends { t: number }>(
    rows: R[],
    pick: (r: R) => number | null,
    g = grid,
    shift = 0,
  ): ChartPoint[] => {
    const byT = new Map(rows.map((r) => [r.t + shift, pick(r)]));
    return g.map((x) => [x, byT.has(x) ? (byT.get(x) ?? null) : null]);
  };
  const metricOf = (rows: MetricBucket[], names: string[], label = "") => {
    const name = names.find((n) => rows.some((r) => r.metric === n && r.label === label));
    return {
      name: name ?? names[0]!,
      rows: rows.filter((r) => r.metric === name && r.label === label),
    };
  };
  const scale = (v: number | null, k: number) => (v == null ? null : v * k);

  const marks: NonNullable<ChartSpec["marks"]> = [
    ...notes.changes.map((c) => ({
      t: c.t,
      l: c.title.length > 40 ? `${c.title.slice(0, 39)}…` : c.title,
    })),
    ...notes.declared.map((d) => ({
      t: d.t,
      l: t("mon2.declared", { ref: d.ref }),
      c: "var(--dang)",
      bg: "var(--dang-t)",
    })),
  ];
  const bands = notes.open.map((o) => ({ a: o.a, b: o.b, l: t("tel2.bandOpen", { ref: o.ref }) }));
  const hot = notes.open.length > 0;
  const base = { marks, bands, stepMs: step };
  const notCollected = (metric: string) => t("tel2.notCollected", { service, metric });

  // ---- Golden signals ------------------------------------------------------
  const perSecond = (n: number) => n / (step / 1000);
  const latency: ChartSpec = {
    ...base,
    title: t("tel2.latency"),
    sub: t("tel2.latencySub", { service }),
    unit: "ms",
    hot,
    threshold: threshold
      ? { v: threshold, l: t("mon2.thresholdDegraded", { value: msShort(threshold) }) }
      : null,
    empty: t("tel2.noSpans", { service }),
    series: [
      { n: "p99", c: "var(--dang)", points: onGrid(golden, (b) => b.p99) },
      { n: "p95", c: "var(--wait)", points: onGrid(golden, (b) => b.p95) },
      { n: "p50", c: "var(--brand)", points: onGrid(golden, (b) => b.p50), fill: true },
    ],
    compare: compare ? onGrid(yGolden, (b) => b.p99, grid, DAY) : undefined,
  };
  const throughput: ChartSpec = {
    ...base,
    title: t("tel2.throughput"),
    sub: t("tel2.throughputSub"),
    unit: "rps",
    kind: "area",
    empty: t("tel2.noSpans", { service }),
    series: [
      { n: "2xx", c: "var(--ok)", points: onGrid(golden, (b) => perSecond(b.c2xx)) },
      { n: "4xx", c: "var(--wait)", points: onGrid(golden, (b) => perSecond(b.c4xx)), fill: false },
      { n: "5xx", c: "var(--dang)", points: onGrid(golden, (b) => perSecond(b.c5xx)), fill: false },
    ],
    compare: compare ? onGrid(yGolden, (b) => perSecond(b.c2xx), grid, DAY) : undefined,
  };
  const rate = (b: GoldenBucket) => (b.total > 0 ? (b.c5xx / b.total) * 100 : null);
  const errorRate: ChartSpec = {
    ...base,
    title: t("tel2.errorRate"),
    sub: t("tel2.errorRateSub"),
    unit: "%",
    kind: "area",
    hot,
    empty: t("tel2.noSpans", { service }),
    series: [{ n: t("tel2.errorRateSeries"), c: "var(--dang)", points: onGrid(golden, rate) }],
    compare: compare ? onGrid(yGolden, rate, grid, DAY) : undefined,
  };
  const used = metrics.filter((r) => r.metric === POOL_USED && r.label === "used");
  const poolMax = Math.max(0, ...metrics.filter((r) => r.metric === POOL_MAX).map((r) => r.max));
  const pool: ChartSpec = used.length
    ? {
        ...base,
        stepMs: metricStep,
        title: t("tel2.pool"),
        sub: t("tel2.poolSub"),
        unit: "n",
        hot,
        threshold: poolMax > 0 ? { v: poolMax, l: t("tel2.poolMax", { n: poolMax }) } : null,
        series: [
          {
            n: t("tel2.poolInUse"),
            c: "var(--brand)",
            points: onGrid(used, (r) => r.max, mgrid),
            fill: true,
          },
          {
            n: t("tel2.poolWaiting"),
            c: "var(--wait)",
            points: onGrid(
              metrics.filter((r) => r.metric === POOL_WAIT),
              (r) => r.max,
              mgrid,
            ),
          },
        ],
        compare: compare
          ? onGrid(
              yMetrics.filter((r) => r.metric === POOL_USED && r.label === "used"),
              (r) => r.max,
              mgrid,
              DAY,
            )
          : undefined,
      }
    : {
        ...base,
        title: t("tel2.pool"),
        sub: POOL_USED,
        unit: "n",
        empty: notCollected(POOL_USED),
        series: [{ n: t("tel2.poolInUse"), c: "var(--brand)", points: [] }],
      };

  // ---- Runtime -------------------------------------------------------------
  const cpu = metricOf(metrics, CPU);
  const yCpu = metricOf(yMetrics, CPU);
  const mem = metricOf(metrics, MEMORY);
  const yMem = metricOf(yMetrics, MEMORY);
  const loop = metricOf(metrics, LOOP);
  const yLoop = metricOf(yMetrics, LOOP);
  const gc = metricOf(metrics, GC);
  const limit = Math.max(0, ...metrics.filter((r) => r.metric === LIMIT).map((r) => r.max));
  const pods = runtime.pods || Math.max(0, ...cpu.rows.map((r) => r.series));
  const MB = 1024 * 1024;
  const runtimeCharts: ChartSpec[] = [
    {
      ...base,
      stepMs: metricStep,
      title: t("tel2.cpu"),
      sub: pods ? t("tel2.cpuSub", { metric: cpu.name, n: pods }) : cpu.name,
      unit: "%",
      max: 100,
      empty: notCollected(cpu.name),
      series: [
        {
          n: t("tel2.maxPod"),
          c: "var(--wait)",
          points: onGrid(cpu.rows, (r) => scale(r.max, 100), mgrid),
        },
        {
          n: t("tel2.avg"),
          c: "var(--brand)",
          points: onGrid(cpu.rows, (r) => scale(r.avg, 100), mgrid),
          fill: true,
        },
      ],
      compare: compare ? onGrid(yCpu.rows, (r) => scale(r.max, 100), mgrid, DAY) : undefined,
    },
    {
      ...base,
      stepMs: metricStep,
      title: t("tel2.memory"),
      sub: t("tel2.memorySub", { metric: mem.name }),
      unit: "mb",
      threshold: limit > 0 ? { v: limit / MB, l: t("tel2.limit", { value: bytes(limit) }) } : null,
      max: limit > 0 ? (limit / MB) * 1.25 : undefined,
      empty: notCollected(mem.name),
      series: [
        {
          n: "rss",
          c: "var(--viol)",
          points: onGrid(mem.rows, (r) => scale(r.avg, 1 / MB), mgrid),
          fill: true,
        },
      ],
      compare: compare ? onGrid(yMem.rows, (r) => scale(r.avg, 1 / MB), mgrid, DAY) : undefined,
    },
    {
      ...base,
      stepMs: metricStep,
      title: t("tel2.eventLoop"),
      sub: `${loop.name}`,
      unit: "ms",
      empty: notCollected(loop.name),
      series: [
        {
          n: "p99",
          c: "var(--brand-2)",
          points: onGrid(loop.rows, (r) => scale(r.max, 1000), mgrid),
        },
        {
          n: t("tel2.gcPause"),
          c: "var(--ink-3)",
          points: onGrid(gc.rows, (r) => scale(r.max, 1000), mgrid),
        },
      ],
      compare: compare ? onGrid(yLoop.rows, (r) => scale(r.max, 1000), mgrid, DAY) : undefined,
    },
  ];

  // ---- Dependencies --------------------------------------------------------
  const known = new Set(day.map((s) => s.service));
  const dbRows = deps.filter((d) => d.kind === "db");
  const acquireRows = deps.filter((d) => d.kind === "acquire");
  const system = dbRows[0]?.target ?? "postgresql";
  const depCharts: ChartSpec[] = [];
  if (dbRows.length || acquireRows.length) {
    const acquirePoints = onGrid(acquireRows, (r) => r.p95);
    depCharts.push({
      ...base,
      title: t("tel2.database"),
      sub: acquireRows.length
        ? t("tel2.databaseSubAcquire", { system })
        : t("tel2.databaseSub", { system }),
      unit: "ms",
      hot: acquireRows.some((r) => r.p95 > 1000),
      series: [
        ...(acquireRows.length
          ? [{ n: t("tel2.acquireP95"), c: "var(--dang)", points: acquirePoints }]
          : []),
        { n: t("tel2.queryP95"), c: "var(--brand)", points: onGrid(dbRows, (r) => r.p95) },
      ],
      compare: compare
        ? onGrid(
            yDeps.filter((d) => d.kind === (acquireRows.length ? "acquire" : "db")),
            (r) => r.p95,
            grid,
            DAY,
          )
        : undefined,
    });
  }
  const peers = [...new Set(deps.filter((d) => d.kind === "peer").map((d) => d.target))].filter(
    (p) => p && p !== "kafka",
  );
  const external = peers.filter((p) => !known.has(p));
  const internal = peers.filter((p) => known.has(p));
  for (const peer of external.slice(0, 2)) {
    const rows = deps.filter((d) => d.kind === "peer" && d.target === peer);
    const host = rows.find((r) => r.host)?.host ?? peer;
    depCharts.push({
      ...base,
      title: peer,
      sub: t("tel2.peerSub", { host }),
      unit: "ms",
      series: [
        { n: "p95", c: "var(--brand)", points: onGrid(rows, (r) => r.p95) },
        { n: "p50", c: "var(--brand-b)", points: onGrid(rows, (r) => r.p50) },
      ],
      compare: compare
        ? onGrid(
            yDeps.filter((d) => d.kind === "peer" && d.target === peer),
            (r) => r.p95,
            grid,
            DAY,
          )
        : undefined,
    });
  }
  if (internal.length) {
    depCharts.push({
      ...base,
      title: t("tel2.upstreamCalls"),
      sub: t("tel2.upstreamSub"),
      unit: "ms",
      series: internal.slice(0, 4).map((p, i) => ({
        n: p,
        c: PEER_COLOURS[i % PEER_COLOURS.length]!,
        points: onGrid(
          deps.filter((d) => d.kind === "peer" && d.target === p),
          (r) => r.p95,
        ),
      })),
    });
  }
  const lag = metrics.filter((r) => r.metric === LAG);
  if (lag.length) {
    const topic = await topicOf(tenantId, service);
    depCharts.push({
      ...base,
      stepMs: metricStep,
      title: t("tel2.queue"),
      sub: t("tel2.queueSub", { topic: topic ?? LAG }),
      unit: "n",
      series: [
        {
          n: t("tel2.lag"),
          c: "var(--wait)",
          points: onGrid(lag, (r) => r.max, mgrid),
          fill: true,
        },
      ],
      compare: compare
        ? onGrid(
            yMetrics.filter((r) => r.metric === LAG),
            (r) => r.max,
            mgrid,
            DAY,
          )
        : undefined,
    });
  }

  const col = (spec: ChartSpec, full = false) => ({ spec, h: full ? 210 : 150, hint: full, full });
  const sections: MetricsSection[] = [
    {
      t: t("tel2.golden"),
      d: t("tel2.goldenSub"),
      charts: [col(latency, true), col(throughput), col(errorRate), col(pool)],
    },
    {
      t: t("tel2.runtime"),
      d: pods
        ? runtime.runtime
          ? t("tel2.runtimeSub", { n: pods, runtime: runtime.runtime })
          : t("tel2.runtimePods", { n: pods })
        : t("tel2.runtimeNone"),
      charts: runtimeCharts.map((c) => col(c)),
    },
    {
      t: t("tel2.dependencies"),
      d: t("tel2.dependenciesSub", { service }),
      charts: depCharts.map((c) => col(c)),
    },
  ];

  const fmtMs = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
  const endpointRows = endpoints.map((e) => {
    const top = Math.max(1, ...e.spark.map((b) => b.p99));
    return {
      route: e.route,
      rps: e.rps >= 10 ? String(Math.round(e.rps)) : e.rps.toFixed(2),
      err: `${(e.errorRate * 100).toFixed(1)} %`,
      errInk: e.errorRate > 0.02 ? "var(--dang)" : "var(--ink)",
      p50: fmtMs(e.p50),
      p99: fmtMs(e.p99),
      p99Ink: e.p99 >= 2000 ? "var(--dang)" : "var(--ink)",
      spark: e.spark.map((b) => ({
        h: `${b.p99 ? Math.max(14, Math.round((b.p99 / top) * 100)) : 14}%`,
        c: b.failed >= 0.05 ? "var(--dang)" : b.p99 ? "var(--brand-b)" : "var(--line-2)",
      })),
      href: `/app/telemetry?tab=traces&service=${encodeURIComponent(service)}&from=${win.from}&to=${win.to}`,
    };
  });

  return (
    <div
      data-screen-label="Telemetry — Metrics"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        animation: "oi-rise .16s ease backwards",
      }}
    >
      <MetricsBoard
        service={service}
        chips={chips}
        range={win.range}
        from={win.from}
        to={win.to}
        zoomed={win.zoomed}
        compare={compare}
        traces={traces}
        sections={sections}
        atlas={note ? <AtlasBanner note={note} /> : null}
        endpoints={
          <div
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-card)",
              boxShadow: "var(--shadow-card)",
              overflowX: "auto",
            }}
            data-testid="telemetry-endpoints"
          >
            <div style={{ minWidth: 760 }}>
              <div
                style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "12px 16px" }}
              >
                <span style={{ fontSize: 14, fontWeight: 600 }}>{t("tel2.endpoints")}</span>
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {t("tel2.endpointsSub", { service })}
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: EP_GRID,
                  gap: 12,
                  padding: "8px 16px",
                  borderTop: "1px solid var(--line)",
                  background: "var(--sunk)",
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  color: "var(--ink-3)",
                }}
              >
                <span>{t("tel2.route")}</span>
                <span style={{ textAlign: "right" }}>{t("tel2.reqs")}</span>
                <span style={{ textAlign: "right" }}>{t("telemetry.servicesErrors")}</span>
                <span style={{ textAlign: "right" }}>p50</span>
                <span style={{ textAlign: "right" }}>p99</span>
                <span>{t("tel2.p99Range")}</span>
              </div>
              {endpointRows.length === 0 && (
                <div
                  style={{
                    padding: "12px 16px",
                    fontSize: 12.5,
                    color: "var(--ink-3)",
                    borderTop: "1px solid var(--line-2)",
                  }}
                >
                  {t("tel2.noSpans", { service })}
                </div>
              )}
              {endpointRows.map((ep) => (
                <Link
                  key={ep.route}
                  href={ep.href}
                  className="oi-hover"
                  style={{
                    display: "grid",
                    gridTemplateColumns: EP_GRID,
                    gap: 12,
                    padding: "9px 16px",
                    borderTop: "1px solid var(--line-2)",
                    alignItems: "center",
                    fontSize: 12.5,
                    cursor: "pointer",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {ep.route}
                  </span>
                  <span style={{ textAlign: "right", fontFamily: "var(--mono)" }}>{ep.rps}</span>
                  <span
                    style={{
                      textAlign: "right",
                      fontFamily: "var(--mono)",
                      color: ep.errInk,
                      fontWeight: 600,
                    }}
                  >
                    {ep.err}
                  </span>
                  <span style={{ textAlign: "right", fontFamily: "var(--mono)" }}>{ep.p50}</span>
                  <span
                    style={{
                      textAlign: "right",
                      fontFamily: "var(--mono)",
                      color: ep.p99Ink,
                      fontWeight: 600,
                    }}
                  >
                    {ep.p99}
                  </span>
                  <span style={{ display: "flex", alignItems: "flex-end", gap: 1.5, height: 20 }}>
                    {ep.spark.map((b, i) => (
                      <span
                        key={i}
                        style={{
                          flex: 1,
                          borderRadius: "1.5px 1.5px 0 0",
                          background: b.c,
                          height: b.h,
                        }}
                      />
                    ))}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        }
      />
    </div>
  );
}

const EP_GRID = "minmax(220px,1.6fr) 80px 80px 90px 90px minmax(140px,1fr)";

function msShort(v: number): string {
  return v >= 1000 ? `${+(v / 1000).toFixed(2)} s` : `${v} ms`;
}

function bytes(v: number): string {
  const gb = v / 1024 ** 3;
  if (gb >= 1) return `${+gb.toFixed(1)} GB`;
  return `${Math.round(v / 1024 ** 2)} MB`;
}

/** The topic a service's consumer-lag metric is about. */
async function topicOf(tenantId: string, service: string): Promise<string | null> {
  const { read } = await import("@openincident/telemetry");
  const [row] = await read<{ topic: string; sys: string }>(
    tenantId,
    `SELECT any(c.attributes['messaging.destination.name']) AS topic,
            any(c.attributes['messaging.system']) AS sys
       FROM metric_series_t(tenant = {tenant:UUID}) AS c
      WHERE c.metric_name = {metric:String} AND c.service_name = {service:String}`,
    { params: { metric: LAG, service } },
  ).catch(() => []);
  if (!row?.topic) return null;
  return row.sys ? `${row.sys} · ${row.topic}` : row.topic;
}
