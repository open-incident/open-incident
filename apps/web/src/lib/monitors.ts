/**
 * Monitors — read side for the screens, and the shape a new one is created in.
 *
 * The 90-day bars and the uptime figure come from the day rollup rather than
 * the raw checks: a monitor checked every minute writes half a million rows a
 * year, and no screen reads them. The raw checks stay for the recent list and
 * the latency chart of the last day.
 */

import { telemetryInstalled } from "@openincident/telemetry";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import {
  heartbeats,
  monitorChecks,
  monitorDays,
  monitorSecrets,
  monitors,
  isTelemetryMonitor,
  telemetryMonitorSeries,
  services,
  type MonitorCriterion,
  type MonitorState,
  type MonitorType,
  type SignalAction,
  type Tx,
} from "@openincident/db";
import {
  SYNTHETIC_DEFAULT_BUDGET_MS,
  defaultHttpCriteria,
  syntheticConfigOf,
  syntheticRunnerLive,
} from "@openincident/oncall";

export type MonitorRow = {
  id: string;
  name: string;
  type: MonitorType;
  target: string;
  state: MonitorState;
  intervalSeconds: number;
  lastCheckAt: Date | null;
  lastLatencyMs: number | null;
  serviceKey: string | null;
  /** One entry per day of the last thirty, oldest first. */
  days: Array<{ day: string; state: "online" | "degraded" | "offline" | "none" }>;
  /** Ninety days as thirty bars of three days, oldest first — the list's bars. */
  bars90: Array<"online" | "degraded" | "offline" | "none">;
  uptime90: number | null;
};

const DAY_WINDOW = 30;

/** The day key list the bars are drawn on, so a monitor with gaps still lines up. */
function lastDays(n: number, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export async function listMonitors(tx: Tx, tenantId: string): Promise<MonitorRow[]> {
  const rows = await tx
    .select({
      id: monitors.id,
      name: monitors.name,
      type: monitors.type,
      target: monitors.target,
      state: monitors.state,
      intervalSeconds: monitors.intervalSeconds,
      lastCheckAt: monitors.lastCheckAt,
      lastLatencyMs: monitors.lastLatencyMs,
      serviceKey: services.key,
    })
    .from(monitors)
    .leftJoin(services, eq(services.id, monitors.serviceId))
    .where(eq(monitors.tenantId, tenantId))
    .orderBy(asc(monitors.name));
  if (rows.length === 0) return [];

  const since = lastDays(90)[0]!;
  const days = await tx
    .select()
    .from(monitorDays)
    .where(and(eq(monitorDays.tenantId, tenantId), gte(monitorDays.day, since)));
  const byMonitor = new Map<string, Map<string, (typeof days)[number]>>();
  for (const d of days) {
    const m = byMonitor.get(d.monitorId) ?? new Map();
    m.set(d.day, d);
    byMonitor.set(d.monitorId, m);
  }

  const keys = lastDays(DAY_WINDOW);
  const keys90 = lastDays(90);
  const dayState = (d: (typeof days)[number] | undefined): BarState =>
    !d ? "none" : d.offlineSeconds > 0 ? "offline" : d.degradedSeconds > 0 ? "degraded" : "online";
  return rows.map((r) => {
    const mine = byMonitor.get(r.id);
    let up = 0;
    let total = 0;
    for (const day of keys90) {
      const d = mine?.get(day);
      if (!d) continue;
      up += d.onlineSeconds;
      total += d.onlineSeconds + d.degradedSeconds + d.offlineSeconds;
    }
    const bars = keys.map((day) => ({ day, state: dayState(mine?.get(day)) }));
    // Ninety days in thirty bars of three: a bar is as bad as its worst day.
    const bars90: BarState[] = [];
    for (let i = 0; i < 90; i += 3) {
      const states = keys90.slice(i, i + 3).map((day) => dayState(mine?.get(day)));
      bars90.push(
        states.includes("offline")
          ? "offline"
          : states.includes("degraded")
            ? "degraded"
            : states.includes("online")
              ? "online"
              : "none",
      );
    }
    return { ...r, days: bars, bars90, uptime90: total > 0 ? (up / total) * 100 : null };
  });
}

export type BarState = "online" | "degraded" | "offline" | "none";

export async function getMonitor(tx: Tx, tenantId: string, id: string) {
  const [row] = await tx
    .select({
      id: monitors.id,
      name: monitors.name,
      type: monitors.type,
      target: monitors.target,
      config: monitors.config,
      criteria: monitors.criteria,
      action: monitors.action,
      intervalSeconds: monitors.intervalSeconds,
      state: monitors.state,
      stateSince: monitors.stateSince,
      lastCheckAt: monitors.lastCheckAt,
      lastLatencyMs: monitors.lastLatencyMs,
      lastDetail: monitors.lastDetail,
      paused: monitors.paused,
      serviceId: monitors.serviceId,
      serviceKey: services.key,
      telemetryQuery: monitors.telemetryQuery,
      createdAt: monitors.createdAt,
    })
    .from(monitors)
    .leftJoin(services, eq(services.id, monitors.serviceId))
    .where(and(eq(monitors.tenantId, tenantId), eq(monitors.id, id)));
  if (!row) return null;

  const checks = await tx
    .select({
      id: monitorChecks.id,
      at: monitorChecks.at,
      state: monitorChecks.state,
      latencyMs: monitorChecks.latencyMs,
      detail: monitorChecks.detail,
      result: monitorChecks.result,
    })
    .from(monitorChecks)
    .where(and(eq(monitorChecks.tenantId, tenantId), eq(monitorChecks.monitorId, id)))
    .orderBy(desc(monitorChecks.at))
    .limit(60);

  // The credentials a journey carries, by NAME only. The value was written
  // once, encrypted, and no screen reads it back — not even a masked version:
  // a hint of a password is a hint of a password.
  const secretNames =
    row.type === "synthetic"
      ? (
          await tx
            .select({ name: monitorSecrets.name })
            .from(monitorSecrets)
            .where(and(eq(monitorSecrets.tenantId, tenantId), eq(monitorSecrets.monitorId, id)))
            .orderBy(asc(monitorSecrets.name))
        ).map((r) => r.name)
      : [];

  /*
   * The series a telemetry monitor watches, which is its real state.
   *
   * Uptime and latency say nothing about one: it was never reaching out. What
   * a person needs on this screen is the list of series, what each last
   * measured and which of them is breaching — one row per phone call the
   * monitor could make.
   */
  const series = isTelemetryMonitor(row.type)
    ? await tx
        .select({
          seriesKey: telemetryMonitorSeries.seriesKey,
          labels: telemetryMonitorSeries.labels,
          state: telemetryMonitorSeries.state,
          lastVerdict: telemetryMonitorSeries.lastVerdict,
          consecutive: telemetryMonitorSeries.consecutive,
          lastValue: telemetryMonitorSeries.lastValue,
          lastDetail: telemetryMonitorSeries.lastDetail,
          stateSince: telemetryMonitorSeries.stateSince,
          lastSeenAt: telemetryMonitorSeries.lastSeenAt,
        })
        .from(telemetryMonitorSeries)
        .where(
          and(
            eq(telemetryMonitorSeries.tenantId, tenantId),
            eq(telemetryMonitorSeries.monitorId, id),
          ),
        )
        .orderBy(asc(telemetryMonitorSeries.seriesKey))
        .limit(200)
    : [];

  const since = lastDays(90)[0]!;
  const [agg] = await tx
    .select({
      online: sql<number>`coalesce(sum(${monitorDays.onlineSeconds}), 0)`.mapWith(Number),
      degraded: sql<number>`coalesce(sum(${monitorDays.degradedSeconds}), 0)`.mapWith(Number),
      offline: sql<number>`coalesce(sum(${monitorDays.offlineSeconds}), 0)`.mapWith(Number),
    })
    .from(monitorDays)
    .where(
      and(
        eq(monitorDays.tenantId, tenantId),
        eq(monitorDays.monitorId, id),
        gte(monitorDays.day, since),
      ),
    );

  const total = (agg?.online ?? 0) + (agg?.degraded ?? 0) + (agg?.offline ?? 0);
  return {
    ...row,
    checks,
    secretNames,
    series,
    /** The typed journey, when this monitor is one and it still parses. */
    journey: syntheticConfigOf(row),
    uptime90: total > 0 ? ((agg?.online ?? 0) / total) * 100 : null,
    downtime90Seconds: agg?.offline ?? 0,
  };
}

export type MonitorDetail = NonNullable<Awaited<ReturnType<typeof getMonitor>>>;

/** The criteria a new monitor of each kind starts with — the sentence on screen. */
export function defaultCriteria(type: MonitorType): MonitorCriterion[] {
  switch (type) {
    case "http":
    case "api":
      return defaultHttpCriteria();
    case "port":
    case "dns":
      return [
        { on: "reachable", op: "eq", value: "false", then: "offline" },
        { on: "reachable", op: "eq", value: "true", then: "online" },
      ];
    case "ssl":
      return [
        { on: "reachable", op: "eq", value: "false", then: "offline" },
        { on: "days_to_expiry", op: "lt", value: "7", then: "offline" },
        { on: "days_to_expiry", op: "lt", value: "30", then: "degraded" },
        { on: "reachable", op: "eq", value: "true", then: "online" },
      ];
    case "domain":
      // A domain expiring is not an outage yet, so the thresholds are wider
      // than a certificate's: a month to notice, a week to panic.
      return [
        { on: "reachable", op: "eq", value: "false", then: "offline" },
        { on: "days_to_expiry", op: "lt", value: "7", then: "offline" },
        { on: "days_to_expiry", op: "lt", value: "30", then: "degraded" },
        { on: "reachable", op: "eq", value: "true", then: "online" },
      ];
    case "ping":
      return [
        { on: "reachable", op: "eq", value: "false", then: "offline" },
        { on: "response_time_ms", op: "gt", value: "500", then: "degraded" },
        { on: "reachable", op: "eq", value: "true", then: "online" },
      ];
    case "synthetic":
      // A journey either completes or it does not — the failing step is the
      // detail, not a second degree of failure. Degraded is the journey that
      // still works but has become slow enough to be worth a look: half the
      // budget, the moment the margin is gone.
      return [
        { on: "reachable", op: "eq", value: "false", then: "offline" },
        {
          on: "response_time_ms",
          op: "gt",
          value: String(Math.round(SYNTHETIC_DEFAULT_BUDGET_MS / 2)),
          then: "degraded",
        },
        { on: "reachable", op: "eq", value: "true", then: "online" },
      ];
    case "logs":
    case "traces":
    case "metrics":
    case "exceptions":
      // These four have no reachability to describe. Their rule is the query
      // they carry, and a criterion saying "reachable = false → offline" next
      // to it would be a second, false answer to "when does this fire".
      return [];
    default:
      return [
        { on: "reachable", op: "eq", value: "false", then: "offline" },
        { on: "reachable", op: "eq", value: "true", then: "online" },
      ];
  }
}

export const DEFAULT_ACTION: SignalAction = {
  page: { kind: "owner" },
  incident: { from: "p2" },
  autoResolve: true,
};

/**
 * What this instance can actually run.
 *
 * A type it cannot perform is still offered — greyed, with the reason and the
 * way to turn it on. Hiding it taught the reader the feature did not exist;
 * saying "not on this instance, here is why" teaches them it does.
 *
 * The answers are cheap and cached for the process: an image either carries
 * `ping` or it does not, and a service either announced itself or did not.
 */
export type MonitorCapability = { ok: boolean; why?: string };

let pingProbe: MonitorCapability | null = null;

async function canPing(): Promise<MonitorCapability> {
  if (pingProbe) return pingProbe;
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const wait = process.platform === "darwin" ? "1000" : "1";
    await promisify(execFile)("ping", ["-n", "-q", "-c", "1", "-W", wait, "127.0.0.1"], {
      timeout: 4000,
    });
    pingProbe = { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pingProbe = {
      ok: false,
      why: /ENOENT/.test(message) ? "ping-missing" : "ping-permission",
    };
  }
  return pingProbe;
}

/**
 * Whether a browser runner has announced itself in the last minute.
 *
 * Not cached, unlike the ping probe: an image either carries a binary or it
 * does not, but a service starts and stops. A reader who has just run
 * `docker compose --profile synthetic up -d` must see the type light up on the
 * next page load, not after the web process restarts.
 */
async function canSynthetic(): Promise<MonitorCapability> {
  const live = await syntheticRunnerLive().catch(() => null);
  return live ? { ok: true } : { ok: false, why: "synthetic-service" };
}

/**
 * Whether this instance keeps a column store.
 *
 * The four telemetry types have nothing to read without one, so they are shown
 * greyed with the command that starts it — the same treatment the browser
 * runner gets. A type that silently disappears teaches the reader the feature
 * does not exist; one that says why teaches them how to have it.
 */
function canTelemetry(): MonitorCapability {
  return telemetryInstalled() ? { ok: true } : { ok: false, why: "telemetry-service" };
}

export async function monitorCapabilities(): Promise<Record<string, MonitorCapability>> {
  const [ping, synthetic] = await Promise.all([canPing(), canSynthetic()]);
  const telemetry = canTelemetry();
  return {
    logs: telemetry,
    traces: telemetry,
    metrics: telemetry,
    exceptions: telemetry,
    http: { ok: true },
    api: { ok: true },
    port: { ok: true },
    dns: { ok: true },
    ssl: { ok: true },
    domain: { ok: true },
    incoming: { ok: true },
    manual: { ok: true },
    ping,
    synthetic,
  };
}

/* ---------------------------------------------------------------------------
 * The detail page's charts and side cards (design: V2Monitors, "Monitor
 * detail" and "Monitor — full screen"). Everything below reads rows: checks,
 * the day rollup, alerts, incidents, changes, status page components. Where a
 * row does not exist the figure is null and the screen says so.
 * ------------------------------------------------------------------------- */

/** Where a check was made from. Today that is the instance's own worker. */
export const THIS_INSTANCE = "";

export type CheckBucket = {
  t: number;
  loc: string;
  latency: number | null;
  dns: number | null;
  connect: number | null;
  tls: number | null;
  firstByte: number | null;
  checks: number;
  failed: number;
  degraded: number;
};

/**
 * The checks of one monitor over a window, per bucket and per location.
 *
 * Bucketed in the database: thirty days of one-minute checks is forty
 * thousand rows, and a chart needs ninety points. A location is the probe the
 * check came from, or `THIS_INSTANCE` when the worker made it itself.
 */
export async function monitorBuckets(
  tx: Tx,
  tenantId: string,
  monitorId: string,
  window: { from: number; to: number; step: number },
): Promise<CheckBucket[]> {
  const stepS = Math.max(1, Math.round(window.step / 1000));
  const rows = await tx.execute<{
    t: string;
    loc: string;
    latency: number | null;
    dns: number | null;
    connect: number | null;
    tls: number | null;
    first_byte: number | null;
    checks: number;
    failed: number;
    degraded: number;
  }>(sql`
    select (floor(extract(epoch from c.at) / ${stepS}) * ${stepS} * 1000)::bigint::text as t,
           coalesce(p.name, c.result->>'location', '') as loc,
           avg(c.latency_ms)::float8 as latency,
           avg((c.result->'phases'->>'dns')::float8) as dns,
           avg((c.result->'phases'->>'connect')::float8) as connect,
           avg((c.result->'phases'->>'tls')::float8) as tls,
           avg((c.result->'phases'->>'firstByte')::float8) as first_byte,
           count(*)::int as checks,
           (count(*) filter (where c.state = 'offline'))::int as failed,
           (count(*) filter (where c.state = 'degraded'))::int as degraded
      from ${monitorChecks} c
      left join app.probes p on p.id = c.probe_id
     where c.tenant_id = ${tenantId}
       and c.monitor_id = ${monitorId}
       and c.at >= ${new Date(window.from).toISOString()}::timestamptz
       and c.at <= ${new Date(window.to).toISOString()}::timestamptz
     group by 1, 2
     order by 1`);
  return [...rows].map((r) => ({
    t: Number(r.t),
    loc: r.loc,
    latency: r.latency,
    dns: r.dns,
    connect: r.connect,
    tls: r.tls,
    firstByte: r.first_byte,
    checks: r.checks,
    failed: r.failed,
    degraded: r.degraded,
  }));
}

export type RecentCheck = {
  id: string;
  at: Date;
  state: MonitorState;
  detail: string | null;
  latencyMs: number | null;
  loc: string;
};

/** The last checks, newest first, with where each was made from. */
export async function recentChecks(
  tx: Tx,
  tenantId: string,
  monitorId: string,
  limit = 5,
): Promise<RecentCheck[]> {
  const rows = await tx.execute<{
    id: string;
    at: string;
    state: MonitorState;
    detail: string | null;
    latency_ms: number | null;
    loc: string;
  }>(sql`
    select c.id, c.at::text as at, c.state, c.detail, c.latency_ms,
           coalesce(p.name, c.result->>'location', '') as loc
      from ${monitorChecks} c
      left join app.probes p on p.id = c.probe_id
     where c.tenant_id = ${tenantId} and c.monitor_id = ${monitorId}
     order by c.at desc
     limit ${limit}`);
  return [...rows].map((r) => ({
    id: r.id,
    at: new Date(r.at),
    state: r.state,
    detail: r.detail,
    latencyMs: r.latency_ms,
    loc: r.loc,
  }));
}

export type LocationState = {
  loc: string;
  region: string | null;
  lastAt: Date;
  latencyMs: number | null;
  state: MonitorState;
};

/** The last check from each location — the "By location" card. */
export async function byLocation(
  tx: Tx,
  tenantId: string,
  monitorId: string,
): Promise<LocationState[]> {
  const rows = await tx.execute<{
    loc: string;
    region: string | null;
    at: string;
    latency_ms: number | null;
    state: MonitorState;
  }>(sql`
    select distinct on (coalesce(p.name, c.result->>'location', ''))
           coalesce(p.name, c.result->>'location', '') as loc,
           p.region, c.at::text as at, c.latency_ms, c.state
      from ${monitorChecks} c
      left join app.probes p on p.id = c.probe_id
     where c.tenant_id = ${tenantId} and c.monitor_id = ${monitorId}
       and c.at > now() - interval '30 days'
     order by coalesce(p.name, c.result->>'location', ''), c.at desc`);
  return [...rows].map((r) => ({
    loc: r.loc,
    region: r.region,
    lastAt: new Date(r.at),
    latencyMs: r.latency_ms,
    state: r.state,
  }));
}

/** Counts over a window of raw checks: the full-screen KPIs. */
export async function checkStats(
  tx: Tx,
  tenantId: string,
  monitorId: string,
  from: Date,
  to: Date,
): Promise<{
  checks: number;
  failed: number;
  degradedSeconds: number;
  offlineSeconds: number;
  p95: number | null;
}> {
  const [row] = await tx.execute<{
    checks: number;
    failed: number;
    degraded: number;
    p95: number | null;
  }>(sql`
    select count(*)::int as checks,
           (count(*) filter (where c.state = 'offline'))::int as failed,
           (count(*) filter (where c.state = 'degraded'))::int as degraded,
           percentile_cont(0.95) within group (order by c.latency_ms)::float8 as p95
      from ${monitorChecks} c
     where c.tenant_id = ${tenantId} and c.monitor_id = ${monitorId}
       and c.at >= ${from.toISOString()}::timestamptz and c.at <= ${to.toISOString()}::timestamptz`);
  const [m] = await tx
    .select({ interval: monitors.intervalSeconds })
    .from(monitors)
    .where(and(eq(monitors.tenantId, tenantId), eq(monitors.id, monitorId)));
  const every = m?.interval ?? 60;
  return {
    checks: row?.checks ?? 0,
    failed: row?.failed ?? 0,
    // A check stands for its interval: three degraded one-minute checks are
    // three minutes degraded, which is how the day rollup counts too.
    degradedSeconds: (row?.degraded ?? 0) * every,
    offlineSeconds: (row?.failed ?? 0) * every,
    p95: row?.p95 ?? null,
  };
}

export type LinkedIncident = {
  id: string;
  number: number;
  name: string;
  severity: string | null;
  declaredAt: Date;
};

/**
 * The incidents this monitor's own alerts opened or joined.
 *
 * Through the alert's `monitor_id` attribute, which the sweep writes on every
 * alert it posts: a rename cannot break it, and an incident about the same
 * service that the monitor never alerted on is not counted.
 */
export async function monitorIncidents(
  tx: Tx,
  tenantId: string,
  monitorId: string,
  sinceDays = 90,
): Promise<LinkedIncident[]> {
  const rows = await tx.execute<{
    id: string;
    number: number;
    name: string;
    severity: string | null;
    declared_at: string;
  }>(sql`
    select distinct i.id, i.number, i.name, s.name as severity, i.declared_at::text as declared_at
      from app.alerts a
      join app.incidents i on i.id = a.incident_id
      left join app.severities s on s.id = i.severity_id
     where a.tenant_id = ${tenantId}
       and a.attributes->>'monitor_id' = ${monitorId}
       and i.declared_at > now() - make_interval(days => ${sinceDays})
     order by declared_at desc
     limit 20`);
  return [...rows].map((r) => ({
    id: r.id,
    number: r.number,
    name: r.name,
    severity: r.severity,
    declaredAt: new Date(r.declared_at),
  }));
}

export type ShownOn = { pageId: string; page: string; component: string };

/** The status page components that read their state off this monitor. */
export async function shownOn(tx: Tx, tenantId: string, monitorId: string): Promise<ShownOn[]> {
  const rows = await tx.execute<{ page_id: string; page: string; component: string }>(sql`
    select p.id as page_id, p.name as page, c.name as component
      from app.status_page_components c
      join app.status_pages p on p.id = c.page_id
     where c.tenant_id = ${tenantId} and c.monitor_id = ${monitorId}
     order by p.name, c.position`);
  return [...rows].map((r) => ({ pageId: r.page_id, page: r.page, component: r.component }));
}

export type ChartMarkRow = { t: number; label: string; kind: "change" | "incident" };
export type IncidentSpan = { a: number; b: number | null; label: string };

/**
 * What a chart of this service annotates over a window: the changes (deploys,
 * flags, config) and the incidents declared, as markers; the incidents that
 * were open, as bands.
 */
export async function serviceAnnotations(
  tx: Tx,
  tenantId: string,
  serviceKey: string | null,
  from: number,
  to: number,
): Promise<{ marks: ChartMarkRow[]; open: IncidentSpan[] }> {
  if (!serviceKey) return { marks: [], open: [] };
  const fromIso = new Date(from).toISOString();
  const toIso = new Date(to).toISOString();
  const changes = await tx.execute<{ title: string; at: string }>(sql`
    select c.title, c.occurred_at::text as at
      from app.change_events c
      join app.services s on s.id = c.service_id
     where c.tenant_id = ${tenantId} and s.key = ${serviceKey}
       and c.occurred_at >= ${fromIso}::timestamptz and c.occurred_at <= ${toIso}::timestamptz
     order by c.occurred_at
     limit 12`);
  const incs = await tx.execute<{
    number: number;
    declared_at: string;
    resolved_at: string | null;
  }>(sql`
    select i.number, i.declared_at::text as declared_at, i.resolved_at::text as resolved_at
      from app.incidents i
      join app.services s on s.id = i.service_id
     where i.tenant_id = ${tenantId} and s.key = ${serviceKey}
       and i.merged_into_id is null
       and i.declared_at <= ${toIso}::timestamptz
       and (i.resolved_at is null or i.resolved_at >= ${fromIso}::timestamptz)
     order by i.declared_at
     limit 12`);
  const marks: ChartMarkRow[] = [
    ...[...changes].map((c) => ({
      t: Date.parse(c.at),
      label: c.title.length > 44 ? `${c.title.slice(0, 43)}…` : c.title,
      kind: "change" as const,
    })),
    ...[...incs]
      .filter((i) => Date.parse(i.declared_at) >= from)
      .map((i) => ({
        t: Date.parse(i.declared_at),
        label: `INC-${i.number}`,
        kind: "incident" as const,
      })),
  ];
  const open = [...incs].map((i) => ({
    a: Date.parse(i.declared_at),
    b: i.resolved_at ? Date.parse(i.resolved_at) : null,
    label: `INC-${i.number}`,
  }));
  return { marks, open };
}

/** The probes this workspace's checks can come from: its own, and the instance's. */
export async function probeSummary(tx: Tx): Promise<{ count: number; regions: string[] }> {
  const rows = await tx.execute<{ region: string }>(sql`select region from app.probes`);
  const regions = [...new Set([...rows].map((r) => r.region))];
  return { count: [...rows].length, regions };
}

/**
 * The certificate behind an HTTPS monitor, from its own latest check.
 *
 * The timed check reads it off the handshake it already made; an older check,
 * or one over plain HTTP, has none, and the screen says so.
 */
export async function latestCertificate(
  tx: Tx,
  tenantId: string,
  monitorId: string,
): Promise<{ validTo: Date; issuer: string | null } | null> {
  const [row] = await tx.execute<{ valid_to: string | null; issuer: string | null }>(sql`
    select c.result->'tls'->>'validTo' as valid_to, c.result->'tls'->>'issuer' as issuer
      from ${monitorChecks} c
     where c.tenant_id = ${tenantId} and c.monitor_id = ${monitorId}
       and c.result ? 'tls'
     order by c.at desc
     limit 1`);
  if (!row?.valid_to) return null;
  return { validTo: new Date(row.valid_to), issuer: row.issuer };
}

export type HeartbeatRow = {
  id: string;
  name: string;
  state: MonitorState;
  intervalSeconds: number;
  lastPingAt: Date | null;
  serviceKey: string | null;
};

/**
 * Heartbeats, as rows of the monitor list.
 *
 * The design files the dead-man's switch under the monitors ("Incoming
 * request"), and the heartbeat is the one that has a ping URL — so the list
 * shows them together, each heartbeat as an `IN` row opening its own card.
 */
export async function listHeartbeatRows(tx: Tx, tenantId: string): Promise<HeartbeatRow[]> {
  const rows = await tx
    .select({
      id: heartbeats.id,
      name: heartbeats.name,
      status: heartbeats.status,
      active: heartbeats.active,
      intervalSeconds: heartbeats.intervalSeconds,
      lastPingAt: heartbeats.lastPingAt,
      serviceKey: services.key,
    })
    .from(heartbeats)
    .leftJoin(services, eq(services.id, heartbeats.serviceId))
    .where(eq(heartbeats.tenantId, tenantId))
    .orderBy(asc(heartbeats.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    state: !r.active
      ? "paused"
      : r.status === "up"
        ? "online"
        : r.status === "down"
          ? "offline"
          : "waiting",
    intervalSeconds: r.intervalSeconds,
    lastPingAt: r.lastPingAt,
    serviceKey: r.serviceKey,
  }));
}
