/**
 * Monitors — the product watching something itself, rather than waiting for a
 * tool to tell it.
 *
 * A check produces a state, never a page: when the state changes the monitor
 * posts an alert to its own managed source, and the whole alerting pipeline
 * applies from there — grouping, the three choices, the owner's policy, the
 * incident. One road, whatever the signal came from.
 *
 * Only the kinds this process can genuinely perform are here. A ping needs a
 * raw socket the worker does not have, so ICMP is not offered: a monitor type
 * that silently never checks is worse than one that does not exist.
 */

import { createHash, randomBytes } from "node:crypto";
import { connect as tlsConnect } from "node:tls";
import { Socket } from "node:net";
import { resolve4, resolveCname, resolveTxt } from "node:dns/promises";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import {
  alertSources,
  monitorChecks,
  monitorDays,
  monitors,
  services,
  withTenant,
  type MonitorCriterion,
  type MonitorState,
  type Tx,
} from "@openincident/db";
import { decryptSecret, encryptSecret } from "@openincident/crypto";
import { getTenantById, registerApiKeyLookup } from "@openincident/db";
import { tenantOrigin } from "./notify";

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Where the product posts to itself: the tenant's public origin, or an internal base with the tenant's Host. */
function ingestTarget(origin: string, sourceId: string): { url: string; host: string | null } {
  const internal = process.env.INTERNAL_WEB_ORIGIN?.replace(/\/$/, "");
  const path = `/api/ingest/alerts/${sourceId}`;
  if (internal) return { url: `${internal}${path}`, host: new URL(origin).host };
  return { url: `${origin}${path}`, host: null };
}

const SOURCE_NAME = "Monitors";

/** The kinds a worker can actually perform today. */
export const RUNNABLE_TYPES = ["http", "api", "port", "dns", "ssl", "incoming", "manual"] as const;
export type RunnableType = (typeof RUNNABLE_TYPES)[number];

export type CheckSample = {
  reachable: boolean;
  statusCode?: number;
  latencyMs?: number;
  body?: string;
  headers?: Record<string, string>;
  daysToExpiry?: number;
  recordValue?: string;
  detail: string;
};

/* ---------- Performing one check ---------- */

async function checkHttp(
  target: string,
  config: Record<string, unknown>,
  timeoutMs: number,
): Promise<CheckSample> {
  const started = Date.now();
  try {
    const res = await fetch(target, {
      method: String(config.method ?? "GET"),
      headers: (config.headers as Record<string, string>) ?? undefined,
      body: (config.body as string) ?? undefined,
      redirect: config.followRedirects === false ? "manual" : "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Read at most what a criterion could look at: a monitor must not pull a
    // 200 MB response into the worker's memory every minute.
    const body = (await res.text()).slice(0, 20_000);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    return {
      reachable: true,
      statusCode: res.status,
      latencyMs: Date.now() - started,
      body,
      headers,
      detail: `${res.status} ${res.statusText}`.trim(),
    };
  } catch (err) {
    return {
      reachable: false,
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkPort(target: string, timeoutMs: number): Promise<CheckSample> {
  const [host, portText] = target.split(":");
  const port = Number(portText);
  if (!host || !Number.isFinite(port)) {
    return { reachable: false, detail: "target must be host:port" };
  }
  const started = Date.now();
  return new Promise<CheckSample>((done) => {
    const socket = new Socket();
    const finish = (sample: CheckSample) => {
      socket.destroy();
      done(sample);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () =>
      finish({ reachable: true, latencyMs: Date.now() - started, detail: "connected" }),
    );
    socket.once("timeout", () =>
      finish({ reachable: false, latencyMs: Date.now() - started, detail: "timeout" }),
    );
    socket.once("error", (err) =>
      finish({ reachable: false, latencyMs: Date.now() - started, detail: err.message }),
    );
    socket.connect(port, host);
  });
}

async function checkDns(target: string, config: Record<string, unknown>): Promise<CheckSample> {
  const kind = String(config.record ?? "A").toUpperCase();
  const started = Date.now();
  try {
    const values =
      kind === "CNAME"
        ? await resolveCname(target)
        : kind === "TXT"
          ? (await resolveTxt(target)).map((parts) => parts.join(""))
          : await resolve4(target);
    return {
      reachable: values.length > 0,
      latencyMs: Date.now() - started,
      recordValue: values.join(", "),
      detail: values.length > 0 ? `${kind} ${values.join(", ")}` : `${kind} no record`,
    };
  } catch (err) {
    return {
      reachable: false,
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkSsl(target: string, timeoutMs: number): Promise<CheckSample> {
  const [host, portText] = target.replace(/^https?:\/\//, "").split(":");
  const port = Number(portText ?? 443) || 443;
  const started = Date.now();
  return new Promise<CheckSample>((done) => {
    const socket = tlsConnect({ host, port, servername: host, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert?.valid_to) {
        done({ reachable: false, detail: "no certificate presented" });
        return;
      }
      const days = Math.floor((Date.parse(cert.valid_to) - Date.now()) / 86_400_000);
      done({
        reachable: true,
        latencyMs: Date.now() - started,
        daysToExpiry: days,
        detail: `expires in ${days} days`,
      });
    });
    socket.once("timeout", () => {
      socket.destroy();
      done({ reachable: false, detail: "timeout" });
    });
    socket.once("error", (err) => {
      socket.destroy();
      done({ reachable: false, detail: err.message });
    });
  });
}

export async function performCheck(monitor: {
  type: string;
  target: string;
  config: Record<string, unknown>;
}): Promise<CheckSample> {
  const timeoutMs = Number(monitor.config.timeoutMs ?? 10_000);
  switch (monitor.type) {
    case "http":
    case "api":
      return checkHttp(monitor.target, monitor.config, timeoutMs);
    case "port":
      return checkPort(monitor.target, timeoutMs);
    case "dns":
      return checkDns(monitor.target, monitor.config);
    case "ssl":
      return checkSsl(monitor.target, timeoutMs);
    default:
      return { reachable: false, detail: `type ${monitor.type} is not checked by this worker` };
  }
}

/* ---------- Turning a sample into a state ---------- */

function read(criterion: MonitorCriterion, sample: CheckSample): string | number | boolean | null {
  switch (criterion.on) {
    case "status_code":
      return sample.statusCode ?? null;
    case "response_time_ms":
      return sample.latencyMs ?? null;
    case "body_contains":
    case "body_matches":
      return sample.body ?? null;
    case "header":
      return sample.headers?.[(criterion.field ?? "").toLowerCase()] ?? null;
    case "reachable":
      return sample.reachable;
    case "days_to_expiry":
      return sample.daysToExpiry ?? null;
    case "record_value":
      return sample.recordValue ?? null;
    default:
      return null;
  }
}

function holds(criterion: MonitorCriterion, sample: CheckSample): boolean {
  const actual = read(criterion, sample);
  if (actual === null) return false;
  const expected = criterion.value;
  switch (criterion.op) {
    case "eq":
      return String(actual) === expected;
    case "neq":
      return String(actual) !== expected;
    case "lt":
      return Number(actual) < Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    case "gt":
      return Number(actual) > Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "contains":
      return String(actual).includes(expected);
    case "not_contains":
      return !String(actual).includes(expected);
    case "matches":
      try {
        return new RegExp(expected).test(String(actual));
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/**
 * The state a sample puts the monitor in.
 *
 * Criteria are read in order and the first that holds decides, so the list
 * reads top to bottom like the sentence a person would say: 200 under two
 * seconds is online, slower is degraded, unreachable is offline.
 */
export function stateFromSample(
  criteria: MonitorCriterion[],
  sample: CheckSample,
): { state: MonitorState; why: string } {
  for (const c of criteria) {
    if (holds(c, sample)) return { state: c.then, why: sample.detail };
  }
  return { state: sample.reachable ? "online" : "offline", why: sample.detail };
}

/** What a new HTTP monitor starts with — the sentence the create screen shows. */
export function defaultHttpCriteria(maxMs = 2000): MonitorCriterion[] {
  return [
    { on: "reachable", op: "eq", value: "false", then: "offline" },
    { on: "status_code", op: "gte", value: "400", then: "offline" },
    { on: "response_time_ms", op: "gt", value: String(maxMs), then: "degraded" },
    { on: "status_code", op: "lt", value: "400", then: "online" },
  ];
}

/* ---------- The managed source monitors post to ---------- */

export async function ensureMonitorSource(
  tx: Tx,
  tenantId: string,
): Promise<{ id: string; secret: string }> {
  const [existing] = await tx
    .select()
    .from(alertSources)
    .where(
      and(
        eq(alertSources.tenantId, tenantId),
        eq(alertSources.managed, true),
        eq(alertSources.name, SOURCE_NAME),
      ),
    );
  if (existing) {
    await registerApiKeyLookup(`src:${existing.id}`, tenantId);
    const secret = decryptSecret(existing.encryptedSecret);
    if (secret) return { id: existing.id, secret };
    const fresh = randomBytes(24).toString("hex");
    await tx
      .update(alertSources)
      .set({ encryptedSecret: encryptSecret(fresh), secretHash: hashSecret(fresh) })
      .where(eq(alertSources.id, existing.id));
    return { id: existing.id, secret: fresh };
  }
  const secret = randomBytes(24).toString("hex");
  const [created] = await tx
    .insert(alertSources)
    .values({
      tenantId,
      name: SOURCE_NAME,
      kind: "http",
      managed: true,
      active: true,
      encryptedSecret: encryptSecret(secret),
      secretHash: hashSecret(secret),
    })
    .returning({ id: alertSources.id });
  await registerApiKeyLookup(`src:${created!.id}`, tenantId);
  return { id: created!.id, secret };
}

async function postAlert(
  origin: string,
  source: { id: string; secret: string },
  payload: Record<string, unknown>,
): Promise<boolean> {
  const target = ingestTarget(origin, source.id);
  try {
    const res = await fetch(target.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-oi-secret": source.secret,
        ...(target.host ? { host: target.host, "x-forwarded-host": target.host } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) console.error(`[monitors] ingest answered ${res.status}`);
    return res.ok;
  } catch (err) {
    console.error("[monitors] ingest unreachable:", err instanceof Error ? err.message : err);
    return false;
  }
}

/* ---------- The sweep ---------- */

const DOWN: MonitorState[] = ["offline", "degraded"];

/** Adds one check's worth of seconds to the day the monitor lived through. */
async function rollUp(
  tx: Tx,
  tenantId: string,
  monitorId: string,
  state: MonitorState,
  seconds: number,
  now: Date,
) {
  const day = now.toISOString().slice(0, 10);
  const column =
    state === "online"
      ? monitorDays.onlineSeconds
      : state === "degraded"
        ? monitorDays.degradedSeconds
        : monitorDays.offlineSeconds;
  await tx
    .insert(monitorDays)
    .values({
      tenantId,
      monitorId,
      day,
      onlineSeconds: state === "online" ? seconds : 0,
      degradedSeconds: state === "degraded" ? seconds : 0,
      offlineSeconds: state === "offline" ? seconds : 0,
      checks: 1,
    })
    .onConflictDoUpdate({
      target: [monitorDays.monitorId, monitorDays.day],
      set: {
        [column.name === "online_seconds"
          ? "onlineSeconds"
          : column.name === "degraded_seconds"
            ? "degradedSeconds"
            : "offlineSeconds"]: sql`${column} + ${seconds}`,
        checks: sql`${monitorDays.checks} + 1`,
        updatedAt: now,
      },
    });
}

/**
 * Runs every monitor whose turn it is, across the given workspaces.
 *
 * Returns how many state changes it published — the number worth logging,
 * since a sweep where nothing changed is the normal case.
 */
export async function sweepMonitors(tenantIds: string[], now = new Date()): Promise<number> {
  let changes = 0;
  for (const tenantId of tenantIds) {
    const due = await withTenant(tenantId, (tx) =>
      tx
        .select({
          id: monitors.id,
          name: monitors.name,
          type: monitors.type,
          target: monitors.target,
          config: monitors.config,
          criteria: monitors.criteria,
          intervalSeconds: monitors.intervalSeconds,
          state: monitors.state,
          lastCheckAt: monitors.lastCheckAt,
          expectEverySeconds: monitors.expectEverySeconds,
          serviceKey: services.key,
        })
        .from(monitors)
        .leftJoin(services, eq(services.id, monitors.serviceId))
        .where(
          and(
            eq(monitors.tenantId, tenantId),
            eq(monitors.paused, false),
            or(
              isNull(monitors.lastCheckAt),
              lte(
                monitors.lastCheckAt,
                sql`${now.toISOString()}::timestamptz - make_interval(secs => ${monitors.intervalSeconds})`,
              ),
            ),
          ),
        ),
    );
    if (due.length === 0) continue;

    const tenant = await getTenantById(tenantId);
    const origin = tenant ? tenantOrigin(tenant.slug, tenant.customDomain) : null;

    for (const m of due) {
      // A manual monitor is set by a human; an incoming one is judged by its
      // silence, which the heartbeat sweep already watches.
      if (m.type === "manual") continue;

      const sample =
        m.type === "incoming"
          ? {
              reachable:
                !!m.lastCheckAt &&
                m.lastCheckAt.getTime() + (m.expectEverySeconds ?? 86_400) * 1000 > now.getTime(),
              detail: "waiting for a ping",
            }
          : await performCheck({ type: m.type, target: m.target, config: m.config });

      const { state, why } = stateFromSample(m.criteria, sample);
      const changed = state !== m.state;

      await withTenant(tenantId, async (tx) => {
        await tx.insert(monitorChecks).values({
          tenantId,
          monitorId: m.id,
          at: now,
          state,
          latencyMs: sample.latencyMs ?? null,
          detail: why.slice(0, 500),
        });
        await rollUp(tx, tenantId, m.id, state, m.intervalSeconds, now);
        await tx
          .update(monitors)
          .set({
            state,
            ...(changed ? { stateSince: now } : {}),
            lastCheckAt: now,
            lastLatencyMs: sample.latencyMs ?? null,
            lastDetail: why.slice(0, 500),
            updatedAt: now,
          })
          .where(eq(monitors.id, m.id));
      });

      if (!changed || !origin) continue;
      const source = await withTenant(tenantId, (tx) => ensureMonitorSource(tx, tenantId));
      const firing = DOWN.includes(state);
      const wasDown = DOWN.includes(m.state);
      if (!firing && !wasDown) continue;
      const posted = await postAlert(origin, source, {
        title: firing ? `${m.name} is ${state}` : `${m.name} is back online`,
        status: firing ? "firing" : "resolved",
        dedup_key: `monitor:${m.id}`,
        severity: state === "offline" ? "P2" : "P3",
        description: why,
        attributes: {
          ...(m.serviceKey ? { service: m.serviceKey } : {}),
          monitor: m.name,
          monitor_type: m.type,
        },
        url: `${origin}/app/monitors/${m.id}`,
      });
      if (posted) changes++;
    }
  }
  return changes;
}
