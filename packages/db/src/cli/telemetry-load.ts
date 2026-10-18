/**
 * Volume, for exercising the telemetry screens. NOT the demo seed.
 *
 * `seed/telemetry.ts` writes a handful of traces on purpose, and argues for it:
 * a seed that invents a thousand spans teaches the reader to distrust every
 * number on the screen. That argument holds for the demonstration data set and
 * says nothing about the other need — finding out what a log list does at ten
 * million rows, whether a chart is still fast, whether a histogram is readable
 * at three in the morning. This writes that, says what it is, and is meant to
 * be thrown away.
 *
 * What makes it worth writing rather than looping `INSERT … FROM numbers()`:
 * the shapes. A uniform stream of identical spans exercises nothing — every
 * chart is a flat line, every facet is 20 %, and no screen is ever wrong. So
 * this has a daily traffic curve, a long-tailed latency distribution, a call
 * graph four services deep where each service enters through a server span
 * and calls its database and its peers through client spans, incidents with
 * their own signatures, log lines whose variable parts a pattern view can
 * fold, exceptions that appear, come back and surge — and the runtime metrics
 * a service reports about itself: CPU and memory per pod, the event loop, the
 * connection pool, the queue it consumes.
 *
 * One incident is not invented: when the workspace has an incident still open
 * on a service this simulates, its signature runs from a few minutes before it
 * was declared until now, so the charts show what the incident is about at
 * the moment it was declared. The deploys recorded for that service in the
 * window write their "deploy started" lines too.
 *
 *   pnpm telemetry:load --tenant skylark --days 7 --rate 120
 *   pnpm telemetry:load --tenant skylark --wipe            # start over
 *
 * `--rate` is traces per minute at the daily average; the curve moves around
 * it. 120 is about 7.5 million spans over a week.
 */
import { randomUUID } from "node:crypto";
import { and, eq, gte, isNull } from "drizzle-orm";
import { clickhouse, telemetryInstalled } from "@openincident/telemetry";
import { getTenantBySlug } from "../directory";
import { adminClient } from "../provision";
import { changeEvents, incidents, services } from "../schema/app";

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
  /** A database call: the system, and the statement. */
  db?: string;
  /** Who is called: a logical name (`Stripe API`, `orders-db`). */
  peer?: string;
  /** The host the peer answers on. */
  host?: string;
  /** A server span's route and method. */
  route?: string;
  method?: string;
  /** Messaging destination for producers and consumers. */
  topic?: string;
};

const db = (service: string, statement: string, median: number): Op => ({
  service,
  name: statement,
  kind: "client",
  median,
  db: "postgresql",
  peer: "orders-db",
  host: "db-primary.skylark.internal",
});

const ROUTES: Array<{ route: string; weight: number; tree: Op }> = [
  {
    route: "/checkout/confirm",
    weight: 20,
    tree: {
      service: "web-storefront",
      name: "POST /checkout/confirm",
      kind: "server",
      route: "/checkout/confirm",
      method: "POST",
      median: 60,
      calls: [
        {
          service: "checkout-api",
          name: "confirmOrder",
          kind: "server",
          route: "/checkout/confirm",
          method: "POST",
          median: 30,
          calls: [
            {
              service: "auth-service",
              name: "verifySession",
              kind: "server",
              route: "/session/verify",
              method: "GET",
              median: 24,
            },
            { service: "checkout-api", name: "validateCart", kind: "internal", median: 40 },
            {
              service: "payments-worker",
              name: "capturePayment",
              kind: "server",
              route: "/payments/capture",
              method: "POST",
              median: 30,
              calls: [
                { service: "payments-worker", name: "pg.acquire", kind: "internal", median: 2 },
                db("payments-worker", "INSERT payments", 12),
                {
                  service: "payments-worker",
                  name: "stripe.charges.create",
                  kind: "client",
                  median: 210,
                  peer: "Stripe API",
                  host: "api.stripe.com",
                },
              ],
            },
            db("checkout-api", "UPDATE orders", 11),
            {
              service: "checkout-api",
              name: "emit order.confirmed",
              kind: "producer",
              median: 4,
              topic: "orders.events",
              peer: "kafka",
              host: "kafka-1.skylark.internal",
            },
          ],
        },
      ],
    },
  },
  {
    route: "/cart",
    weight: 26,
    tree: {
      service: "web-storefront",
      name: "GET /cart",
      kind: "server",
      route: "/cart",
      method: "GET",
      median: 30,
      calls: [
        {
          service: "checkout-api",
          name: "GET /cart",
          kind: "server",
          route: "/cart",
          method: "GET",
          median: 12,
          calls: [db("checkout-api", "SELECT cart", 6)],
        },
      ],
    },
  },
  {
    route: "/cart/items",
    weight: 12,
    tree: {
      service: "web-storefront",
      name: "POST /cart/items",
      kind: "server",
      route: "/cart/items",
      method: "POST",
      median: 40,
      calls: [
        {
          service: "checkout-api",
          name: "POST /cart/items",
          kind: "server",
          route: "/cart/items",
          method: "POST",
          median: 20,
          calls: [db("checkout-api", "INSERT cart_items", 9)],
        },
      ],
    },
  },
  {
    route: "/search",
    weight: 22,
    tree: {
      service: "web-storefront",
      name: "GET /search",
      kind: "server",
      route: "/search",
      method: "GET",
      median: 40,
      calls: [
        {
          service: "search-indexer",
          name: "GET /search",
          kind: "server",
          route: "/search",
          method: "GET",
          median: 90,
          calls: [{ service: "search-indexer", name: "index.scan", kind: "internal", median: 160 }],
        },
      ],
    },
  },
  {
    route: "/login",
    weight: 8,
    tree: {
      service: "web-storefront",
      name: "POST /login",
      kind: "server",
      route: "/login",
      method: "POST",
      median: 25,
      calls: [
        {
          service: "auth-service",
          name: "POST /login",
          kind: "server",
          route: "/login",
          method: "POST",
          median: 30,
          calls: [db("auth-service", "SELECT users", 5)],
        },
      ],
    },
  },
  {
    route: "/health",
    weight: 4,
    tree: {
      service: "web-storefront",
      name: "GET /health",
      kind: "server",
      route: "/health",
      method: "GET",
      median: 3,
    },
  },
  /*
   * Stripe calling back. A root of its own: it does not come through the
   * storefront, and during the pool incident it is the second victim.
   */
  {
    route: "/payments/webhooks/stripe",
    weight: 10,
    tree: {
      service: "payments-worker",
      name: "POST /payments/webhooks/stripe",
      kind: "server",
      route: "/payments/webhooks/stripe",
      method: "POST",
      median: 20,
      calls: [
        { service: "payments-worker", name: "pg.acquire", kind: "internal", median: 2 },
        db("payments-worker", "UPDATE payments", 10),
        {
          service: "payments-worker",
          name: "publish payments.webhooks",
          kind: "producer",
          median: 3,
          topic: "payments.webhooks",
          peer: "kafka",
          host: "kafka-1.skylark.internal",
        },
      ],
    },
  },
  {
    route: "/payments/refund",
    weight: 2,
    tree: {
      service: "payments-worker",
      name: "POST /payments/refund",
      kind: "server",
      route: "/payments/refund",
      method: "POST",
      median: 60,
      calls: [
        { service: "payments-worker", name: "pg.acquire", kind: "internal", median: 2 },
        {
          service: "payments-worker",
          name: "stripe.refunds.create",
          kind: "client",
          median: 180,
          peer: "Stripe API",
          host: "api.stripe.com",
        },
      ],
    },
  },
  {
    route: "/payments/{id}",
    weight: 3,
    tree: {
      service: "payments-worker",
      name: "GET /payments/{id}",
      kind: "server",
      route: "/payments/{id}",
      method: "GET",
      median: 4,
      calls: [db("payments-worker", "SELECT payments", 5)],
    },
  },
];

type Incident = {
  /** Window, epoch milliseconds. */
  from: number;
  to: number;
  service: string;
  /** Multiplies the latency of that service's operations; the pool wait gets its own. */
  slowdown: number;
  errorRate: number;
  exception: string;
  message: string;
  log: string;
  /** A connection-pool incident: the wait for a connection is what takes the time. */
  pool?: boolean;
};

/**
 * Past incidents, at fixed distances from now, each with its own signature —
 * one service, one shape of slowness, one exception type, one burst of log
 * lines — so a reader can find it from any of the four signals and land on
 * the same minute.
 */
function pastIncidents(now: number): Incident[] {
  const at = (daysAgo: number, minutes: number) => ({
    from: now - daysAgo * 86_400_000,
    to: now - daysAgo * 86_400_000 + minutes * 60_000,
  });
  return [
    {
      ...at(4.6, 42),
      service: "payments-worker",
      slowdown: 14,
      errorRate: 0.28,
      exception: "PoolTimeoutError",
      message: "timed out acquiring a connection from the pool after 3000ms",
      log: "pool timeout after 3000ms — 41 waiters",
      pool: true,
    },
    {
      ...at(1.4, 17),
      service: "checkout-api",
      slowdown: 7,
      errorRate: 0.06,
      exception: "QueryCanceledError",
      message: "canceling statement due to statement timeout",
      log: "statement timeout on UPDATE orders",
    },
  ];
}

/** The signature an incident still open on a simulated service runs with. */
const LIVE_SIGNATURE: Record<string, Omit<Incident, "from" | "to" | "service">> = {
  "payments-worker": {
    slowdown: 1.4,
    errorRate: 0.068,
    exception: "PoolTimeoutError",
    message: "pg.acquire: timeout after 3000ms — pool exhausted (max=20, in_use=20, waiting=41)",
    log: "pg.acquire timeout after 3000ms — pool exhausted (max=20 in_use=20 waiting=41)",
    pool: true,
  },
  "checkout-api": {
    slowdown: 3,
    errorRate: 0.03,
    exception: "TypeError",
    message: "Cannot read properties of undefined (reading 'address')",
    log: "confirmOrder failed: address form returned no address",
  },
  "web-storefront": {
    slowdown: 2,
    errorRate: 0.04,
    exception: "UpstreamError",
    message: "upstream returned 502",
    log: "upstream 502 from CDN edge",
  },
  "auth-service": {
    slowdown: 1.5,
    errorRate: 0.042,
    exception: "TokenRefreshError",
    message: "token refresh failed: issuer unreachable",
    log: "token refresh failed for issuer sso.skylark.dev",
  },
};

/** Pods per service, and the runtime each reports. */
const PODS: Record<string, { pods: number; runtime: string }> = {
  "web-storefront": { pods: 4, runtime: "node 20" },
  "checkout-api": { pods: 4, runtime: "node 20" },
  "payments-worker": { pods: 6, runtime: "node 20" },
  "auth-service": { pods: 3, runtime: "node 20" },
  "search-indexer": { pods: 2, runtime: "jvm 21" },
};

const HOSTS = ["web-1.eu-west", "web-2.eu-west", "worker-1.eu-west"];
const CONTAINERS = Object.keys(PODS);
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
function writeTrace(ctx: Ctx, startMs: number, route: string, tree: Op, active: Incident[]): void {
  const traceId = hex(16);
  const tier = pick(TIERS);
  const order = `ord_${hex(2)}`;
  // Which incident, if any, this request runs into: the first one whose
  // service it touches.
  const touches = (op: Op, svc: string): boolean =>
    op.service === svc || (op.calls ?? []).some((c) => touches(c, svc));
  const incident = active.find((i) => touches(tree, i.service)) ?? null;
  const failed = incident ? rnd() < incident.errorRate : rnd() < 0.006;
  const failingService = failed
    ? (incident?.service ?? pick(["payments-worker", "checkout-api", "search-indexer"]))
    : null;
  // A few client mistakes, so 4xx is not always zero.
  const clientError = !failed && rnd() < 0.022 ? pick([400, 404, 409, 422]) : 0;
  const poolWait = incident?.pool ? 2000 + rnd() * 1000 : 0;
  const waiting = 30 + Math.floor(rnd() * 14);
  let anyException = false;
  const logs: Array<{ sev: number; text: string; at: number; service: string; span: string }> = [];

  const emit = (op: Op, parent: string, at: number): { took: number; failed: boolean } => {
    const inIncident = !!incident && op.service === incident.service;
    const slow = inIncident ? incident!.slowdown : 1;
    let own = logNormal(op.median) * slow;
    if (op.name === "pg.acquire" && inIncident && incident!.pool) {
      // The pool is full: the wait is the incident.
      own = failed && failingService === op.service ? 3000 : poolWait * (0.5 + rnd() * 0.5);
    }
    const spanId = hex(8);
    let childEnd = at + Math.min(own * 0.15, 8);
    let childrenMs = 0;
    let childFailed = false;
    for (const child of op.calls ?? []) {
      if (child.chance !== undefined && rnd() > child.chance) continue;
      // After a failed pool wait nothing else in this service runs.
      if (childFailed && child.service === op.service && op.service === failingService) break;
      const out = emit(child, spanId, childEnd + 1);
      childEnd += out.took + 1;
      childrenMs += out.took + 1;
      childFailed ||= out.failed;
    }
    const duration = Math.max(own, childrenMs + own * 0.2);
    const isRoot = parent === "";
    /*
     * Where the failure starts, and how it travels up. The pool wait fails in
     * a pool incident; otherwise the failing service's entry span does. Every
     * ancestor is then an error too — a request that broke three services
     * down still returns 500 to its caller — and the root carries the 500.
     */
    const origin =
      failed &&
      op.service === failingService &&
      (incident?.pool ? op.name === "pg.acquire" : op.kind === "server");
    const isFailing = origin || (failed && childFailed) || (isRoot && failed);
    const server = op.kind === "server";
    const httpStatus = server ? (isFailing ? 500 : isRoot && clientError ? clientError : 200) : 0;
    const message = !isFailing
      ? ""
      : origin && incident
        ? incident.message
        : op.name === "capturePayment"
          ? `capturePayment failed order=${order} reason=db_timeout`
          : server
            ? `HTTP 500 — upstream failed`
            : "";
    const events: Array<Record<string, unknown>> = [];
    if (op.name === "pg.acquire" && inIncident && incident!.pool) {
      events.push({
        ts: ch(at),
        name: `waiting for a connection · ${waiting} in queue`,
        attributes: { "db.pool.waiting": String(waiting) },
      });
    }
    if (origin && incident) {
      events.push({
        ts: ch(at + duration * 0.98),
        name: "exception",
        attributes: { "exception.type": incident.exception, "exception.message": incident.message },
      });
      anyException = true;
    } else if (!isFailing && duration > op.median * 6 * slow && op.kind !== "server") {
      events.push({ ts: ch(at + duration * 0.5), name: "retry", attributes: { attempt: "2" } });
    }
    const attributes: Record<string, string> = {};
    if (server && op.route) {
      attributes["http.route"] = op.route;
      attributes["http.method"] = op.method ?? "GET";
      attributes["user.tier"] = tier;
    }
    if (op.db) {
      attributes["db.system"] = op.db;
      attributes["db.statement"] = op.name;
    }
    if (op.host) attributes["net.peer.name"] = op.host;
    if (op.peer) attributes["peer.service"] = op.peer;
    if (op.topic) attributes["messaging.destination.name"] = op.topic;
    if (op.name === "pg.acquire") {
      attributes["db.system"] = "postgresql";
      attributes["db.pool.max"] = "20";
      if (inIncident && incident!.pool) {
        attributes["db.pool.in_use"] = "20";
        attributes["db.pool.waiting"] = String(waiting);
        attributes["db.pool.timeout_ms"] = "3000";
      }
    }
    if (op.name === "capturePayment") {
      attributes["payment.provider"] = "stripe";
      attributes["order.id"] = order;
    }
    ctx.spans.push({
      tenant_id: ctx.tenantId,
      service_id: ctx.serviceIds.get(op.service) ?? ctx.serviceIds.get("web-storefront")!,
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
      status_code: isFailing ? "error" : "ok",
      status_message: message,
      http_method: server ? (op.method ?? "GET") : "",
      http_route: server ? (op.route ?? "") : "",
      http_status_code: httpStatus,
      // Only a database call names a system; the pool wait is the client
      // library's own work, and counting it as a query would double it.
      db_system: op.db ?? "",
      rpc_service: "",
      peer_service: op.peer ?? "",
      attributes,
      resource_attributes: {
        "service.name": op.service,
        "process.runtime.description": PODS[op.service]?.runtime ?? "",
      },
      events,
      links: [],
      has_exception: origin && Boolean(incident),
      sampled_ratio: 1,
      retention_at: ctx.retention,
    });
    if (origin && incident) {
      ctx.exceptions.push({
        tenant_id: ctx.tenantId,
        service_id: ctx.serviceIds.get(op.service) ?? ctx.serviceIds.get("web-storefront")!,
        service_name: op.service,
        environment: "production",
        release: op.service === "payments-worker" ? "2.32.0" : "1.14.3",
        ts: ch(at + duration * 0.98),
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

    /* The lines this span writes, in its own service, under its own id. */
    const ms = Math.round(duration);
    const short = `${traceId.slice(0, 4)}…${traceId.slice(-4)}`;
    if (origin && incident) {
      logs.push({
        sev: 17,
        text: `${incident.log} trace=${short}`,
        at: at + duration,
        service: op.service,
        span: spanId,
      });
    }
    if (op.name === "capturePayment") {
      if (isFailing) {
        logs.push({
          sev: 17,
          text: `capturePayment failed order=${order} reason=db_timeout`,
          at: at + duration,
          service: op.service,
          span: spanId,
        });
      } else if (rnd() < 0.3) {
        logs.push({
          sev: 9,
          text: `capturePayment ok order=${order} latency=${ms}ms`,
          at: at + duration,
          service: op.service,
          span: spanId,
        });
      }
    }
    if (op.name === "POST /payments/webhooks/stripe" && !isFailing && rnd() < 0.5) {
      logs.push({
        sev: 9,
        text: `webhook delivered id=whk_${hex(2)} latency=${ms}ms`,
        at: at + duration,
        service: op.service,
        span: spanId,
      });
    }
    if (op.name === "pg.acquire" && inIncident && incident!.pool && !isFailing && rnd() < 0.12) {
      logs.push({
        sev: 13,
        text: `pool wait p99=${(duration / 1000).toFixed(1)}s (threshold 500ms)`,
        at: at + duration,
        service: op.service,
        span: spanId,
      });
    }
    if (server && !isRoot && duration > 2000 && op.service !== incident?.service && rnd() < 0.3) {
      logs.push({
        sev: 13,
        text: `upstream ${incident?.service ?? "dependency"} slow p99=${(duration / 1000).toFixed(1)}s`,
        at: at + duration,
        service: op.service,
        span: spanId,
      });
    }
    return { took: duration, failed: isFailing };
  };

  const total = emit(tree, "", startMs).took;
  const root = ctx.spans[ctx.spans.length - 1]!;
  const ms = Math.round(total);
  /*
   * Two lines for a normal request and more for a broken one, which is about
   * what a real service writes. Every body carries a variable part (an order
   * number, a duration, a cache key), so a pattern view has something to fold.
   */
  logs.push({
    sev: failed ? 17 : clientError ? 13 : 9,
    text: failed
      ? `request failed: ${route} returned 500 in ${ms}ms`
      : clientError
        ? `${route} answered ${clientError} in ${ms}ms`
        : `${route} handled in ${ms}ms for order ${100000 + Math.floor(rnd() * 900000)}`,
    at: startMs + total,
    service: String(root.service_name),
    span: String(root.span_id),
  });
  if (rnd() < 0.45) {
    logs.push({
      sev: 9,
      text:
        rnd() < 0.5
          ? `cache hit for key cart:${100000 + Math.floor(rnd() * 900000)}`
          : `session refreshed for user ${hex(4)}`,
      at: startMs + total * 0.4,
      service: String(root.service_name),
      span: String(root.span_id),
    });
  }
  if (anyException && rnd() < 0.2) {
    logs.push({
      sev: 21,
      text: `unhandled ${incident?.exception} while serving ${route}`,
      at: startMs + total,
      service: incident?.service ?? String(root.service_name),
      span: String(root.span_id),
    });
  }
  for (const l of logs) {
    ctx.logs.push({
      tenant_id: ctx.tenantId,
      service_id: ctx.serviceIds.get(l.service) ?? ctx.serviceIds.get("web-storefront")!,
      service_name: l.service,
      environment: "production",
      ts: ch(l.at),
      observed_ts: ch(l.at),
      severity_number: l.sev,
      severity_text: l.sev >= 21 ? "FATAL" : l.sev >= 17 ? "ERROR" : l.sev >= 13 ? "WARN" : "INFO",
      body: l.text,
      trace_id: traceId,
      span_id: l.span,
      scope_name: "http",
      attributes: { "http.route": route, "user.tier": tier },
      resource_attributes: { "service.name": l.service },
      retention_at: ctx.retention,
    });
  }
}

/** A line with no trace: a deploy starting, written by the service at that instant. */
function writeDeployLog(ctx: Ctx, at: number, service: string, title: string): void {
  ctx.logs.push({
    tenant_id: ctx.tenantId,
    service_id: ctx.serviceIds.get(service) ?? ctx.serviceIds.get("web-storefront")!,
    service_name: service,
    environment: "production",
    ts: ch(at),
    observed_ts: ch(at),
    severity_number: 9,
    severity_text: "INFO",
    body: `deploy started: ${title} replicas=${PODS[service]?.pods ?? 2}`,
    trace_id: "",
    span_id: "",
    scope_name: "deploy",
    attributes: {},
    resource_attributes: { "service.name": service },
    retention_at: ctx.retention,
  });
}

/** A minute of infrastructure, runtime and application metrics. */
function writeMetrics(ctx: Ctx, minuteMs: number, load: number, active: Incident[]): void {
  const stamp = ch(minuteMs);
  const incidentOn = (service: string) => active.find((i) => i.service === service) ?? null;
  const anyIncident = active.length > 0;
  /** The hash, and the catalogue row that makes the series findable. */
  const catalogued = (
    name: string,
    attributes: Record<string, string>,
    type: string,
    unit: string,
    service: string,
  ): string => {
    const h = hash(name + service + JSON.stringify(attributes));
    const key = `${name} ${h}`;
    const held = ctx.series.get(key);
    if (held) held.last_seen = stamp.slice(0, 19);
    else
      ctx.series.set(key, {
        tenant_id: ctx.tenantId,
        metric_name: name,
        attributes_hash: h,
        type,
        unit,
        service_name: service,
        attributes,
        first_seen: stamp.slice(0, 19),
        last_seen: stamp.slice(0, 19),
      });
    return h;
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
      service_id: ctx.serviceIds.get(service) ?? ctx.serviceIds.get("web-storefront")!,
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
      service_id: ctx.serviceIds.get(service) ?? ctx.serviceIds.get("web-storefront")!,
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

  /* The hosts and containers, as the infrastructure packs read them. */
  for (const host of HOSTS) {
    const busy = Math.min(
      0.97,
      load * (0.32 + rnd() * 0.1) + (anyIncident && host.startsWith("worker") ? 0.3 : 0),
    );
    gauge("system.cpu.utilization", 1 - busy, { "host.name": host, state: "idle", cpu: "cpu0" });
    gauge("system.cpu.utilization", busy, { "host.name": host, state: "user", cpu: "cpu0" });
    gauge("system.memory.utilization", Math.min(0.95, 0.42 + load * 0.2), {
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
    gauge("system.cpu.load_average.1m", 2 + load * 4 + (anyIncident ? 3 : 0), {
      "host.name": host,
    });
    sum(
      "system.network.io",
      Math.round(load * 4_000_000 * (1 + rnd())),
      { "host.name": host, device: "eth0", direction: "receive" },
      "By",
    );
  }
  for (const container of CONTAINERS) {
    const hot = incidentOn(container);
    gauge(
      "container.cpu.utilization",
      Math.min(0.99, load * 0.3 + rnd() * 0.15 + (hot ? 0.25 : 0)),
      { "container.name": container },
    );
    gauge("container.memory.percent", 30 + load * 18 + (hot ? 12 : 0), {
      "container.name": container,
    });
  }
  gauge(
    "postgresql.backends",
    Math.round(12 + load * 40 + (incidentOn("payments-worker") ? 30 : 0)),
    { "postgresql.database.name": "orders" },
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
    Math.round(load * (anyIncident ? 20 : 3)),
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

  /*
   * What each service says about itself, per pod, in OpenTelemetry's units:
   * CPU as a ratio, memory in bytes, the event loop and GC in seconds.
   */
  for (const [service, { pods, runtime }] of Object.entries(PODS)) {
    const hot = incidentOn(service);
    const since = hot ? (minuteMs - hot.from) / 60_000 : 0;
    const ramp = hot ? Math.min(1, since / 4) : 0;
    for (let p = 0; p < pods; p++) {
      const pod = `${service}-7d9f${p}c-${["x2kq", "m8pd", "r4tz", "b6wn", "q1vh", "z9sl"][p]}`;
      const attrs = { "k8s.pod.name": pod, "process.runtime.description": runtime };
      const spread = 1 + (p - pods / 2) * 0.06;
      gauge(
        "process.cpu.utilization",
        Math.min(0.99, (0.2 + load * 0.22 + rnd() * 0.06) * spread + ramp * 0.22),
        attrs,
        "1",
        service,
      );
      gauge(
        "process.memory.rss",
        (560 + load * 70 + rnd() * 30 + ramp * 140) * 1024 * 1024,
        attrs,
        "By",
        service,
      );
      if (runtime.startsWith("node")) {
        gauge(
          "nodejs.eventloop.delay.p99",
          (0.006 + rnd() * 0.005 + ramp * 0.034) * spread,
          attrs,
          "s",
          service,
        );
        gauge("nodejs.gc.duration.p99", 0.003 + rnd() * 0.002 + ramp * 0.009, attrs, "s", service);
      }
    }
    gauge(
      "k8s.container.memory_limit",
      1024 * 1024 * 1024,
      { "k8s.container.name": service },
      "By",
      service,
    );
    if (service === "payments-worker" || service === "checkout-api") {
      const pool = { "pool.name": service === "payments-worker" ? "payments" : "orders" };
      const poolHot = !!hot?.pool;
      const used = poolHot ? 20 : Math.min(20, Math.max(1, Math.round(5 + load * 4 + rnd() * 3)));
      gauge(
        "db.client.connections.usage",
        used,
        { ...pool, state: "used" },
        "{connection}",
        service,
      );
      gauge(
        "db.client.connections.usage",
        20 - used,
        { ...pool, state: "idle" },
        "{connection}",
        service,
      );
      gauge("db.client.connections.max", 20, pool, "{connection}", service);
      gauge(
        "db.client.connections.pending_requests",
        poolHot ? Math.round(36 + rnd() * 9) : rnd() < 0.05 ? 1 : 0,
        pool,
        "{request}",
        service,
      );
    }
    if (service === "payments-worker") {
      gauge(
        "messaging.kafka.consumer.lag",
        Math.round(
          hot ? 120 + 9400 * (1 - Math.exp(-since / 40)) * (0.94 + rnd() * 0.08) : 80 + rnd() * 90,
        ),
        { "messaging.system": "kafka", "messaging.destination.name": "payments.webhooks" },
        "{message}",
        service,
      );
    }
  }

  /* The storefront's own request counter and duration histogram. */
  for (const { route, weight, tree } of ROUTES.filter((r) => r.tree.service === "web-storefront")) {
    const requests = Math.max(0, Math.round(load * weight * 2.2));
    const hot = incidentOn("web-storefront");
    sum(
      "http.server.requests",
      requests,
      { "http.route": route, "http.status_code": "200" },
      "1",
      "web-storefront",
    );
    if (hot || rnd() < 0.25)
      sum(
        "http.server.requests",
        Math.round(requests * (hot ? hot.errorRate : 0.006)),
        { "http.route": route, "http.status_code": "500" },
        "1",
        "web-storefront",
      );
    const median = tree.median * (hot ? hot.slowdown : 1);
    ctx.histograms.push({
      tenant_id: ctx.tenantId,
      service_id: ctx.serviceIds.get("web-storefront")!,
      service_name: "web-storefront",
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
        "web-storefront",
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
      // The rollups a materialized view fills. A materialized view forwards
      // inserts; it does not see a delete. Leaving these behind and loading
      // again counts the same minute twice, and the chart that reads them —
      // the seven-day latency bands — is then wrong in a way nothing else
      // contradicts.
      "trace_1m",
      "service_edges_1m",
      "service_edge_runs",
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
      [...Object.keys(PODS), "orders-db", "infra"].map((name) => [name, randomUUID()]),
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
  const since = now - minutes * 60_000;

  /*
   * What the workspace itself says: the incidents still open on a service
   * this simulates — their signature runs from just before they were
   * declared until now — and the deploys recorded in the window.
   */
  const live: Incident[] = [];
  const deploys: Array<{ at: number; service: string; title: string }> = [];
  {
    const { db, end } = adminClient();
    try {
      const open = await db
        .select({ declaredAt: incidents.declaredAt, phase: incidents.phase, service: services.key })
        .from(incidents)
        .innerJoin(services, eq(services.id, incidents.serviceId))
        .where(
          and(
            eq(incidents.tenantId, tenant.id),
            isNull(incidents.resolvedAt),
            isNull(incidents.mergedIntoId),
            eq(incidents.phase, "active"),
          ),
        );
      for (const o of open) {
        const sig = o.service ? LIVE_SIGNATURE[o.service] : undefined;
        if (!sig || !o.service) continue;
        live.push({
          ...sig,
          service: o.service,
          from: o.declaredAt.getTime() - 5 * 60_000,
          to: now + 60_000,
        });
      }
      const changes = await db
        .select({
          at: changeEvents.occurredAt,
          title: changeEvents.title,
          kind: changeEvents.kind,
          service: services.key,
        })
        .from(changeEvents)
        .innerJoin(services, eq(services.id, changeEvents.serviceId))
        .where(
          and(
            eq(changeEvents.tenantId, tenant.id),
            gte(changeEvents.occurredAt, new Date(since)),
            eq(changeEvents.kind, "deploy"),
          ),
        );
      for (const c of changes) {
        if (c.service && PODS[c.service])
          deploys.push({ at: c.at.getTime(), service: c.service, title: c.title });
      }
    } finally {
      await end();
    }
  }
  const timeline = [...pastIncidents(now), ...live];
  if (live.length) {
    console.log(`[load] open incidents simulated on: ${live.map((l) => l.service).join(", ")}`);
  }

  for (let m = minutes; m > 0; m--) {
    const minuteMs = now - m * 60_000;
    const load = trafficAt(minuteMs);
    const active = timeline.filter((i) => minuteMs >= i.from && minuteMs < i.to);
    for (const d of deploys) {
      if (d.at >= minuteMs && d.at < minuteMs + 60_000)
        writeDeployLog(ctx, d.at, d.service, d.title);
    }

    const traces = Math.max(1, Math.round(rate * load));
    for (let i = 0; i < traces; i++) {
      const roll = rnd() * weights;
      let acc = 0;
      const chosen = ROUTES.find((r) => (acc += r.weight) >= roll) ?? ROUTES[0]!;
      writeTrace(ctx, minuteMs + Math.floor(rnd() * 60_000), chosen.route, chosen.tree, active);
    }
    writeMetrics(ctx, minuteMs, load, active);
    if (m % 2 === 0) writeRum(ctx, minuteMs, Math.max(1, Math.round(load * 6)), active.length > 0);

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
