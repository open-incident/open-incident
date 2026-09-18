/**
 * Monitors — read side for the screens, and the shape a new one is created in.
 *
 * The 90-day bars and the uptime figure come from the day rollup rather than
 * the raw checks: a monitor checked every minute writes half a million rows a
 * year, and no screen reads them. The raw checks stay for the recent list and
 * the latency chart of the last day.
 */

import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import {
  monitorChecks,
  monitorDays,
  monitors,
  services,
  type MonitorCriterion,
  type MonitorState,
  type MonitorType,
  type SignalAction,
  type Tx,
} from "@openincident/db";
import { defaultHttpCriteria } from "@openincident/oncall";

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
  /** One entry per day, oldest first — the bars. */
  days: Array<{ day: string; state: "online" | "degraded" | "offline" | "none" }>;
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

  const since = lastDays(DAY_WINDOW)[0]!;
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
  return rows.map((r) => {
    const mine = byMonitor.get(r.id);
    let up = 0;
    let total = 0;
    const bars = keys.map((day) => {
      const d = mine?.get(day);
      if (!d) return { day, state: "none" as const };
      up += d.onlineSeconds;
      total += d.onlineSeconds + d.degradedSeconds + d.offlineSeconds;
      if (d.offlineSeconds > 0) return { day, state: "offline" as const };
      if (d.degradedSeconds > 0) return { day, state: "degraded" as const };
      return { day, state: "online" as const };
    });
    return { ...r, days: bars, uptime90: total > 0 ? (up / total) * 100 : null };
  });
}

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
      createdAt: monitors.createdAt,
    })
    .from(monitors)
    .leftJoin(services, eq(services.id, monitors.serviceId))
    .where(and(eq(monitors.tenantId, tenantId), eq(monitors.id, id)));
  if (!row) return null;

  const checks = await tx
    .select({
      at: monitorChecks.at,
      state: monitorChecks.state,
      latencyMs: monitorChecks.latencyMs,
      detail: monitorChecks.detail,
    })
    .from(monitorChecks)
    .where(and(eq(monitorChecks.tenantId, tenantId), eq(monitorChecks.monitorId, id)))
    .orderBy(desc(monitorChecks.at))
    .limit(60);

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

export async function monitorCapabilities(): Promise<Record<string, MonitorCapability>> {
  const ping = await canPing();
  return {
    http: { ok: true },
    api: { ok: true },
    port: { ok: true },
    dns: { ok: true },
    ssl: { ok: true },
    domain: { ok: true },
    incoming: { ok: true },
    manual: { ok: true },
    ping,
    // The browser runner is a separate service; until it exists, say so.
    synthetic: { ok: false, why: "synthetic-service" },
  };
}
