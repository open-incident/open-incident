/**
 * Volume, for exercising the telemetry screens. NOT the demo seed.
 *
 * `seed/telemetry.ts` writes a handful of traces on purpose, and argues for it:
 * a seed that invents a thousand spans teaches the reader to distrust every
 * number on the screen. That argument holds for the demonstration data set and
 * says nothing about the other need — finding out what a log list does at ten
 * million rows, whether a facet is still fast, whether a histogram is readable
 * at three in the morning. This writes that, says what it is, and is meant to
 * be thrown away.
 *
 * What makes it worth writing rather than looping `INSERT … FROM numbers()`:
 * the shapes. A uniform stream of identical spans exercises nothing — every
 * chart is a flat line, every facet is 20 %, and no screen is ever wrong. So
 * this has a daily traffic curve, a long-tailed latency distribution, a call
 * graph five services deep, two incidents with their own signatures, log lines
 * whose variable parts a pattern view can fold, and exceptions that appear,
 * come back and surge.
 *
 *   pnpm telemetry:load --tenant skylark --days 7 --rate 120
 *   pnpm telemetry:load --tenant skylark --wipe            # start over
 *
 * `--rate` is traces per minute at the daily average; the curve moves around
 * it. 120 is about 7.5 million spans over a week.
 */
import { randomUUID } from "node:crypto";
import { clickhouse, telemetryInstalled } from "@openincident/telemetry";
import { getTenantBySlug } from "../directory";

/* ---------------------------------------------------------------------------
 * The shape of the thing being simulated.
 * ------------------------------------------------------------------------- */

/** One request's worth of work, as a tree of operations. */
type Op = {
  service: string;
  name: string;
  kind: "server" | "client" | "internal" | "producer" | "consumer";
  /** Median duration in milliseconds; the spread is log-normal around it. */
  median: number;
  /** Chance this operation happens at all, for the ones that are conditional. */
  chance?: number;
  /** What this operation calls in turn. */
  calls?: Op[];
  db?: string;
  peer?: string;
};

const ROUTES: Array<{ route: string; weight: number; tree: Op }> = [
  {
    route: "/checkout/confirm",
    weight: 22,
    tree: {
      service: "storefront",
      name: "POST /checkout/confirm",
      kind: "server",
      median: 240,
      calls: [
        {
          service: "checkout-api",
          name: "checkout.confirm",
          kind: "client",
          median: 210,
          calls: [
            {
              service: "payments-worker",
              name: "charge.authorize",
              kind: "client",
              median: 120,
              calls: [
                { service: "payments-worker", name: "pg.acquire", kind: "internal", median: 4 },
                {
                  service: "orders-db",
                  name: "INSERT payments",
                  kind: "client",
                  median: 9,
                  db: "postgresql",
                  peer: "orders-db",
                },
              ],
            },
            {
              service: "orders-db",
              name: "UPDATE orders",
              kind: "client",
              median: 12,
              db: "postgresql",
              peer: "orders-db",
            },
            {
              service: "notify-fanout",
              name: "publish receipt",
              kind: "producer",
              median: 6,
              chance: 0.9,
            },
          ],
        },
      ],
    },
  },
  {
    route: "/cart",
    weight: 30,
    tree: {
      service: "storefront",
      name: "GET /cart",
      kind: "server",
      median: 60,
      calls: [
        {
          service: "checkout-api",
          name: "cart.read",
          kind: "client",
          median: 38,
          calls: [
            {
              service: "orders-db",
              name: "SELECT cart",
              kind: "client",
              median: 7,
              db: "postgresql",
              peer: "orders-db",
            },
          ],
        },
      ],
    },
  },
  {
    route: "/search",
    weight: 28,
    tree: {
      service: "storefront",
      name: "GET /search",
      kind: "server",
      median: 95,
      calls: [
        {
          service: "search-api",
          name: "search.query",
          kind: "client",
          median: 70,
          calls: [{ service: "search-api", name: "index.scan", kind: "internal", median: 44 }],
        },
      ],
    },
  },
  {
    route: "/orders/{id}",
    weight: 14,
    tree: {
      service: "storefront",
      name: "GET /orders/{id}",
      kind: "server",
      median: 80,
      calls: [
        {
          service: "orders-db",
          name: "SELECT orders",
          kind: "client",
          median: 11,
          db: "postgresql",
          peer: "orders-db",
        },
      ],
    },
  },
  {
    route: "/health",
    weight: 6,
    tree: { service: "storefront", name: "GET /health", kind: "server", median: 3 },
  },
];

/**
 * The two incidents, which are what makes the screens worth looking at.
 *
 * A window where everything is normal proves nothing about a chart. Each of
 * these has its own signature — one service, one shape of slowness, one
 * exception type, one burst of log lines — so a reader can find it from any of
 * the four signals and land on the same minute.
 */
const INCIDENTS = [
  {
    /** Days back from now, and how long it lasted. */
    daysAgo: 4.6,
    minutes: 42,
    service: "payments-worker",
    /** Multiplies the latency of that service's operations. */
    slowdown: 14,
    errorRate: 0.28,
    exception: "PoolTimeoutError",
    message: "timed out acquiring a connection from the pool after 3000ms",
    log: "pool timeout after 3000ms — 41 waiters",
  },
  {
    daysAgo: 1.4,
    minutes: 17,
    service: "orders-db",
    slowdown: 7,
    errorRate: 0.06,
    exception: "QueryCanceledError",
    message: "canceling statement due to statement timeout",
    log: "statement timeout on UPDATE orders",
  },
] as const;

const HOSTS = ["web-1.eu-west", "web-2.eu-west", "worker-1.eu-west"];
const CONTAINERS = ["storefront", "checkout-api", "payments-worker", "search-api", "notify-fanout"];
const TIERS = ["free", "pro", "enterprise"];
const BROWSERS = ["Chrome 141", "Safari 26", "Firefox 144", "Edge 141"];
const COUNTRIES = ["FR", "DE", "BE", "ES", "IT", "GB", "US"];

/* ---------------------------------------------------------------------------
 * Randomness, seeded, so two runs of the same command write the same week.
 * ------------------------------------------------------------------------- */

let seed = 0x2f6e2b1;
function rnd(): number {
  // xorshift32: small, fast, and repeatable — a load run somebody is
  // debugging a screen against must not change under them.
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) % 1_000_000) / 1_000_000;
}
function pick<T>(list: readonly T[]): T {
  return list[Math.floor(rnd() * list.length)]!;
}
/** A long tail: most requests are near the median, a few are far away. */
function logNormal(median: number, sigma = 0.55): number {
  const u = Math.max(rnd(), 1e-6);
  const v = Math.max(rnd(), 1e-6);
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return median * Math.exp(sigma * z);
}
function hex(bytes: number): string {
  let out = "";
  for (let i = 0; i < bytes; i++)
    out += Math.floor(rnd() * 256)
      .toString(16)
      .padStart(2, "0");
  return out;
}
/** ClickHouse's DateTime64 spelling. */
function ch(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}

/** How busy the shop is at this hour, as a multiple of the average. */
function trafficAt(ms: number): number {
  const d = new Date(ms);
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
  // A shop: quiet at 04:00, busy mid-afternoon, a small evening bump.
  const curve =
    0.35 + 0.95 * Math.exp(-((hour - 15) ** 2) / 26) + 0.35 * Math.exp(-((hour - 20.5) ** 2) / 5);
  return curve * (weekend ? 0.62 : 1);
}

type Rows = Record<string, unknown>[];

/* ---------------------------------------------------------------------------
 * The run.
 * ------------------------------------------------------------------------- */

type Ctx = {
  tenantId: string;
  serviceIds: Map<string, string>;
  retention: string;
  spans: Rows;
  logs: Rows;
  exceptions: Rows;
  gauges: Rows;
  sums: Rows;
  histograms: Rows;
  rum: Rows;
  appId: string;
  counts: Record<string, number>;
  /**
   * The catalogue, which only the ingestion path writes.
   *
   * `metric_series` is what the metric list, the label pickers and the
   * cardinality budget read; points written straight into the tables leave it
   * empty, and the whole metrics screen then says "nothing has arrived" over
   * a quarter of a million points. Found by looking at the screen.
   */
  series: Map<string, Record<string, unknown>>;
};

async function flush(ctx: Ctx, force = false): Promise<void> {
  const ch = clickhouse();
  const jobs: Array<Promise<unknown>> = [];
  const send = (table: string, rows: Rows, cap: number) => {
    if (rows.length === 0 || (!force && rows.length < cap)) return;
    const values = rows.splice(0, rows.length);
    ctx.counts[table] = (ctx.counts[table] ?? 0) + values.length;
    jobs.push(ch.insert({ table, format: "JSONEachRow", values }));
  };
  send("otel_spans", ctx.spans, 40_000);
  send("otel_logs", ctx.logs, 40_000);
  send("otel_exceptions", ctx.exceptions, 20_000);
  send("otel_metrics_gauge", ctx.gauges, 40_000);
  send("otel_metrics_sum", ctx.sums, 40_000);
  send("otel_metrics_histogram", ctx.histograms, 20_000);
  send("rum_events", ctx.rum, 20_000);
  await Promise.all(jobs);
}

/** One trace, written into the batch. */
function writeTrace(
  ctx: Ctx,
  startMs: number,
  route: string,
  tree: Op,
  incident: (typeof INCIDENTS)[number] | null,
): void {
  const traceId = hex(16);
  const tier = pick(TIERS);
  const failed = incident ? rnd() < incident.errorRate : rnd() < 0.006;
  const failingService = failed
    ? (incident?.service ?? pick(["payments-worker", "orders-db"]))
    : null;
  let anyException = false;

  const emit = (op: Op, parent: string, at: number): number => {
    const slow = incident && op.service === incident.service ? incident.slowdown : 1;
    const own = logNormal(op.median) * slow;
    const spanId = hex(8);
    let childEnd = at;
    let childrenMs = 0;
    for (const child of op.calls ?? []) {
      if (child.chance !== undefined && rnd() > child.chance) continue;
      const took = emit(child, spanId, childEnd + 1);
      childEnd += took + 1;
      childrenMs += took + 1;
    }
    const duration = Math.max(own, childrenMs + own * 0.2);
    /*
     * The root span carries the failure too.
     *
     * A request that breaks three services down still returns 500 to the
     * caller, so its root span is an error — and every roll-up that answers
     * "how many requests failed" reads exactly that. Without it the generated
     * week had a visible latency spike and, beside it, zero failures: the
     * first thing the band chart said, and it was the data that was wrong.
     */
    const isRoot = parent === "";
    const isFailing = failingService === op.service || (isRoot && failed);
    const status = isFailing ? "error" : "ok";
    const httpStatus = op.kind === "server" ? (failed ? 500 : 200) : 0;
    const events: Array<Record<string, unknown>> = [];
    if (isFailing && incident) {
      events.push({
        ts: ch(at + duration * 0.9),
        name: "exception",
        attributes: { "exception.type": incident.exception },
      });
      anyException = true;
    } else if (duration > op.median * 6) {
      events.push({ ts: ch(at + duration * 0.5), name: "retry", attributes: { attempt: "2" } });
    }
    ctx.spans.push({
      tenant_id: ctx.tenantId,
      service_id: ctx.serviceIds.get(op.service) ?? ctx.serviceIds.get("storefront")!,
      service_name: op.service,
      environment: "production",
      service_version: op.service === "payments-worker" ? "2.32.0" : "1.14.3",
      start_ts: ch(at),
      end_ts: ch(at + duration),
      duration_ns: Math.round(duration * 1e6),
      trace_id: traceId,
      span_id: spanId,
      parent_span_id: parent,
      name: op.name,
      kind: op.kind,
      status_code: status,
      status_message: isFailing && incident ? incident.message : "",
      http_method: op.kind === "server" ? (route.startsWith("/checkout") ? "POST" : "GET") : "",
      http_route: op.kind === "server" ? route : "",
      http_status_code: httpStatus,
      db_system: op.db ?? "",
      rpc_service: "",
      peer_service: op.peer ?? "",
      attributes: {
        ...(op.kind === "server"
          ? {
              "http.route": route,
              "user.tier": tier,
              "http.method": route.startsWith("/checkout") ? "POST" : "GET",
            }
          : {}),
        ...(op.db ? { "db.system": op.db, "db.statement": op.name } : {}),
        ...(op.name === "pg.acquire" && incident
          ? { "pool.waiters": String(30 + Math.floor(rnd() * 20)) }
          : {}),
      },
      resource_attributes: {},
      events,
      links: [],
      has_exception: isFailing && Boolean(incident) && failingService === op.service,
      sampled_ratio: 1,
      retention_at: ctx.retention,
    });
    if (isFailing && incident && failingService === op.service) {
      ctx.exceptions.push({
        tenant_id: ctx.tenantId,
        service_id: ctx.serviceIds.get(op.service) ?? ctx.serviceIds.get("storefront")!,
        service_name: op.service,
        environment: "production",
        release: op.service === "payments-worker" ? "2.32.0" : "1.14.3",
        ts: ch(at + duration * 0.9),
        fingerprint: `${incident.exception}:${op.name}`.slice(0, 64),
        type: incident.exception,
        message: incident.message,
        stacktrace: `${incident.exception}: ${incident.message}\n    at ${op.name} (${op.service}/src/index.ts:214:11)\n    at handler (${op.service}/src/http.ts:88:3)`,
        frames: [],
        trace_id: traceId,
        span_id: spanId,
        attributes: { "user.tier": tier },
        retention_at: ctx.retention,
      });
    }
    return duration;
  };

  const total = emit(tree, "", startMs);

  /* The lines a request writes. One at the end, always; more when it went
   * wrong. The variable parts are what a pattern view folds. */
  const rootSpan = ctx.spans[ctx.spans.length - 1]!;
  const line = (sev: number, text: string, atMs: number, span = String(rootSpan.span_id)) => {
    ctx.logs.push({
      tenant_id: ctx.tenantId,
      service_id: rootSpan.service_id,
      service_name: rootSpan.service_name,
      environment: "production",
      ts: ch(atMs),
      observed_ts: ch(atMs),
      severity_number: sev,
      severity_text: sev >= 21 ? "FATAL" : sev >= 17 ? "ERROR" : sev >= 13 ? "WARN" : "INFO",
      body: text,
      trace_id: traceId,
      span_id: span,
      scope_name: "http",
      attributes: { "http.route": route, "user.tier": tier },
      resource_attributes: {},
      retention_at: ctx.retention,
    });
  };
  const ms = Math.round(total);
  /*
   * Two lines for a normal request and four for a broken one, which is about
   * what a real service writes — and the reason a log screen needs volume of
   * its own rather than one line per trace. Every body carries a variable part
   * (an order number, a duration, a cache key), so the pattern view has
   * something to fold and the facets something to count.
   */
  line(
    9,
    `${route} handled in ${ms}ms for order ${100000 + Math.floor(rnd() * 900000)}`,
    startMs + total,
  );
  if (rnd() < 0.55) {
    line(
      9,
      rnd() < 0.5
        ? `cache hit for key cart:${100000 + Math.floor(rnd() * 900000)}`
        : `session refreshed for user ${hex(4)}`,
      startMs + total * 0.4,
    );
  }
  if (failed) {
    line(17, `request failed: ${route} returned 500 in ${ms}ms`, startMs + total);
    if (incident) line(17, incident.log, startMs + total * 0.8);
  }
  if (!failed && rnd() < 0.04) {
    line(13, `slow downstream call: ${route} took ${ms}ms, budget 250ms`, startMs + total);
  }
  if (anyException && rnd() < 0.3) {
    line(21, `unhandled ${incident?.exception} while serving ${route}`, startMs + total);
  }
}

/** A minute of infrastructure and application metrics. */
function writeMetrics(ctx: Ctx, minuteMs: number, load: number, incident: boolean): void {
  const stamp = ch(minuteMs);
  /** The hash, and the catalogue row that makes the series findable. */
  const catalogued = (
    name: string,
    attributes: Record<string, string>,
    type: string,
    unit: string,
    service: string,
  ): string => {
    const h = hash(name + JSON.stringify(attributes));
    catalogue(name, h, type, unit, service, attributes);
    return h;
  };

  /** One catalogue row per series, first seen kept, last seen moved forward. */
  const catalogue = (
    name: string,
    hash: string,
    type: string,
    unit: string,
    service: string,
    attributes: Record<string, string>,
  ) => {
    const key = `${name} ${hash}`;
    const held = ctx.series.get(key);
    if (held) {
      held.last_seen = stamp.slice(0, 19);
      return;
    }
    ctx.series.set(key, {
      tenant_id: ctx.tenantId,
      metric_name: name,
      attributes_hash: hash,
      type,
      unit,
      service_name: service,
      attributes,
      first_seen: stamp.slice(0, 19),
      last_seen: stamp.slice(0, 19),
    });
  };

  const gauge = (
    name: string,
    value: number,
    attributes: Record<string, string>,
    unit = "1",
    service = "infra",
  ) =>
    ctx.gauges.push({
      tenant_id: ctx.tenantId,
      service_id: ctx.serviceIds.get(service) ?? ctx.serviceIds.get("storefront")!,
      service_name: service,
      environment: "production",
      metric_name: name,
      description: "",
      unit,
      ts: stamp,
      value,
      attributes,
      attributes_hash: catalogued(name, attributes, "gauge", unit, service),
      exemplars: [],
      retention_at: ctx.retention,
    });
  const sum = (
    name: string,
    value: number,
    attributes: Record<string, string>,
    unit = "1",
    service = "infra",
  ) =>
    ctx.sums.push({
      tenant_id: ctx.tenantId,
      service_id: ctx.serviceIds.get(service) ?? ctx.serviceIds.get("storefront")!,
      service_name: service,
      environment: "production",
      metric_name: name,
      description: "",
      unit,
      ts: stamp,
      value,
      is_monotonic: true,
      aggregation_temporality: "cumulative",
      attributes,
      attributes_hash: catalogued(name, attributes, "sum", unit, service),
      exemplars: [],
      retention_at: ctx.retention,
    });

  for (const host of HOSTS) {
    const busy = Math.min(
      0.97,
      load * (0.32 + rnd() * 0.1) + (incident && host.startsWith("worker") ? 0.45 : 0),
    );
    gauge("system.cpu.utilization", 1 - busy, { "host.name": host, state: "idle", cpu: "cpu0" });
    gauge("system.cpu.utilization", busy, { "host.name": host, state: "user", cpu: "cpu0" });
    gauge("system.memory.utilization", Math.min(0.95, 0.42 + load * 0.2 + (incident ? 0.2 : 0)), {
      "host.name": host,
      state: "used",
    });
    gauge("system.filesystem.utilization", host.startsWith("web") ? 0.61 : 0.88, {
      "host.name": host,
      device: "/dev/nvme0n1p1",
      mountpoint: "/",
      type: "ext4",
      mode: "rw",
    });
    gauge("system.cpu.load_average.1m", 2 + load * 4 + (incident ? 9 : 0), { "host.name": host });
    sum(
      "system.network.io",
      Math.round(load * 4_000_000 * (1 + rnd())),
      {
        "host.name": host,
        device: "eth0",
        direction: "receive",
      },
      "By",
    );
  }
  for (const container of CONTAINERS) {
    gauge(
      "container.cpu.utilization",
      Math.min(
        0.99,
        load * 0.3 + rnd() * 0.15 + (incident && container === "payments-worker" ? 0.5 : 0),
      ),
      {
        "container.name": container,
      },
    );
    gauge(
      "container.memory.percent",
      30 + load * 18 + (incident && container === "payments-worker" ? 40 : 0),
      {
        "container.name": container,
      },
    );
  }
  gauge(
    "postgresql.backends",
    Math.round(12 + load * 40 + (incident ? 90 : 0)),
    {
      "postgresql.database.name": "orders",
    },
    "1",
    "orders-db",
  );
  gauge("postgresql.connection.max", 150, {}, "1", "orders-db");
  sum(
    "postgresql.commits",
    Math.round(load * 900),
    { "postgresql.database.name": "orders" },
    "1",
    "orders-db",
  );
  sum(
    "postgresql.rollbacks",
    Math.round(load * (incident ? 90 : 3)),
    { "postgresql.database.name": "orders" },
    "1",
    "orders-db",
  );
  gauge(
    "postgresql.db_size",
    4_800_000_000 + minuteMs / 1000,
    { "postgresql.database.name": "orders" },
    "By",
    "orders-db",
  );

  for (const { route, weight } of ROUTES) {
    const requests = Math.max(0, Math.round(load * weight * 2.2));
    sum(
      "http.server.requests",
      requests,
      { "http.route": route, "http.status_code": "200" },
      "1",
      "storefront",
    );
    if (incident || rnd() < 0.25)
      sum(
        "http.server.requests",
        Math.round(requests * (incident ? 0.28 : 0.006)),
        { "http.route": route, "http.status_code": "500" },
        "1",
        "storefront",
      );
    const median = ROUTES.find((r) => r.route === route)!.tree.median * (incident ? 6 : 1);
    ctx.histograms.push({
      tenant_id: ctx.tenantId,
      service_id: ctx.serviceIds.get("storefront")!,
      service_name: "storefront",
      environment: "production",
      metric_name: "http.server.duration",
      description: "",
      unit: "ms",
      ts: stamp,
      count: requests,
      sum: requests * median,
      min: median * 0.3,
      max: median * 9,
      bucket_counts: [
        Math.round(requests * 0.5),
        Math.round(requests * 0.3),
        Math.round(requests * 0.15),
        Math.round(requests * 0.04),
        Math.round(requests * 0.01),
      ],
      explicit_bounds: [50, 100, 250, 1000],
      aggregation_temporality: "delta",
      attributes: { "http.route": route },
      attributes_hash: catalogued(
        "http.server.duration",
        { "http.route": route },
        "histogram",
        "ms",
        "storefront",
      ),
      exemplars: [],
      retention_at: ctx.retention,
    });
  }
}

/** Browser sessions, for the real-user screens. */
function writeRum(ctx: Ctx, minuteMs: number, sessions: number, incident: boolean): void {
  for (let i = 0; i < sessions; i++) {
    const sessionId = hex(8);
    const viewId = hex(8);
    const route = pick(ROUTES).route;
    const browser = pick(BROWSERS);
    const country = pick(COUNTRIES);
    const base = {
      tenant_id: ctx.tenantId,
      app_id: ctx.appId,
      session_id: sessionId,
      view_id: viewId,
      url: `https://shop.example${route}`,
      route,
      browser,
      os: browser.startsWith("Safari") ? "macOS" : "Windows",
      device: rnd() < 0.42 ? "mobile" : "desktop",
      country,
      user_hash: hex(8),
      trace_id: "",
      error_type: "",
      error_message: "",
      error_stack: "",
      attributes: {},
      retention_at: ctx.retention,
    };
    ctx.rum.push({
      ...base,
      ts: ch(minuteMs),
      event_type: "view",
      vital_name: "",
      vital_value: 0,
      vital_rating: "",
    });
    const lcp = logNormal(incident ? 4200 : 1650, 0.4);
    for (const [name, value] of [
      ["LCP", lcp],
      ["INP", logNormal(incident ? 420 : 140, 0.5)],
      ["CLS", logNormal(0.06, 0.8)],
    ] as const) {
      const rating =
        name === "LCP"
          ? value < 2500
            ? "good"
            : value < 4000
              ? "needs-improvement"
              : "poor"
          : name === "INP"
            ? value < 200
              ? "good"
              : value < 500
                ? "needs-improvement"
                : "poor"
            : value < 0.1
              ? "good"
              : value < 0.25
                ? "needs-improvement"
                : "poor";
      ctx.rum.push({
        ...base,
        ts: ch(minuteMs + 1200),
        event_type: "vital",
        vital_name: name,
        vital_value: value,
        vital_rating: rating,
      });
    }
    if (rnd() < (incident ? 0.2 : 0.02)) {
      ctx.rum.push({
        ...base,
        ts: ch(minuteMs + 2500),
        event_type: "error",
        vital_name: "",
        vital_value: 0,
        vital_rating: "",
        error_type: "TypeError",
        error_message: "Cannot read properties of undefined (reading 'total')",
        error_stack: "at CartSummary (cart.tsx:88:12)",
      });
    }
  }
}

function hash(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (const ch of text)
    h = ((h ^ BigInt(ch.charCodeAt(0))) * 0x100000001b3n) & 0xffffffffffffffffn;
  return h.toString();
}

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? (process.argv[at + 1] ?? fallback) : fallback;
}

async function main(): Promise<void> {
  if (!telemetryInstalled()) {
    console.error("no CLICKHOUSE_URL: there is nowhere to write telemetry.");
    process.exit(1);
  }
  const slug = arg("tenant", "skylark");
  const days = Number(arg("days", "7"));
  const rate = Number(arg("rate", "120"));
  const wipe = process.argv.includes("--wipe");

  const tenant = await getTenantBySlug(slug);
  if (!tenant) {
    console.error(`no workspace "${slug}".`);
    process.exit(1);
  }

  const ch = clickhouse();
  if (wipe) {
    // Synthetic load is the only thing this deletes, and it deletes all of it:
    // a half-wiped week is worse than either.
    for (const table of [
      "otel_spans",
      "otel_logs",
      "otel_exceptions",
      "otel_metrics_gauge",
      "otel_metrics_sum",
      "otel_metrics_histogram",
      "otel_traces_index",
      "metric_1m",
      "metric_series",
      "exception_groups_1h",
      "rum_events",
      "rum_sessions_agg",
    ]) {
      await ch.command({
        query: `ALTER TABLE ${table} DELETE WHERE tenant_id = {tenant:UUID}`,
        query_params: { tenant: tenant.id },
      });
    }
    console.log(`[load] wiped the telemetry of "${slug}" (mutations run in the background)`);
  }

  const ctx: Ctx = {
    tenantId: tenant.id,
    serviceIds: new Map(
      [
        "storefront",
        "checkout-api",
        "payments-worker",
        "orders-db",
        "notify-fanout",
        "search-api",
        "infra",
      ].map((name) => [name, randomUUID()]),
    ),
    retention: ch2(Date.now() + 30 * 86_400_000),
    spans: [],
    logs: [],
    exceptions: [],
    gauges: [],
    sums: [],
    histograms: [],
    rum: [],
    appId: randomUUID(),
    counts: {},
    series: new Map(),
  };

  const weights = ROUTES.reduce((n, r) => n + r.weight, 0);
  const now = Date.now();
  const minutes = Math.round(days * 1440);
  const started = Date.now();

  for (let m = minutes; m > 0; m--) {
    const minuteMs = now - m * 60_000;
    const load = trafficAt(minuteMs);
    const incident =
      INCIDENTS.find(
        (i) =>
          minuteMs >= now - i.daysAgo * 86_400_000 &&
          minuteMs < now - i.daysAgo * 86_400_000 + i.minutes * 60_000,
      ) ?? null;

    const traces = Math.max(1, Math.round(rate * load));
    for (let i = 0; i < traces; i++) {
      const roll = rnd() * weights;
      let acc = 0;
      const chosen = ROUTES.find((r) => (acc += r.weight) >= roll) ?? ROUTES[0]!;
      writeTrace(ctx, minuteMs + Math.floor(rnd() * 60_000), chosen.route, chosen.tree, incident);
    }
    writeMetrics(ctx, minuteMs, load, Boolean(incident));
    if (m % 2 === 0) writeRum(ctx, minuteMs, Math.max(1, Math.round(load * 6)), Boolean(incident));

    await flush(ctx);
    if (m % 720 === 0) {
      const done = ((minutes - m) / minutes) * 100;
      console.log(
        `[load] ${done.toFixed(0)} % — ${(ctx.counts.otel_spans ?? 0).toLocaleString("en-US")} spans, ` +
          `${(ctx.counts.otel_logs ?? 0).toLocaleString("en-US")} logs`,
      );
    }
  }
  await flush(ctx, true);

  // The catalogue last, once, because it is one row per series rather than per
  // point: a few hundred rows for a week of metrics.
  if (ctx.series.size > 0) {
    await clickhouse().insert({
      table: "metric_series",
      format: "JSONEachRow",
      values: [...ctx.series.values()],
    });
    ctx.counts.metric_series = ctx.series.size;
  }

  const seconds = (Date.now() - started) / 1000;
  console.log(`\n[load] ${slug}: ${days} days at ${rate} traces/min, in ${seconds.toFixed(0)} s`);
  for (const [table, n] of Object.entries(ctx.counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${table.padEnd(24)} ${n.toLocaleString("en-US").padStart(12)}`);
  }
  console.log("\nThe rollups (trace index, metric minutes, exception hours, RUM sessions)");
  console.log("are materialised views: they filled as this wrote.");
}

/** The same spelling as `ch`, for a moment in the future. */
function ch2(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "").slice(0, 19);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
