/**
 * Monitors — the product watching something itself, rather than waiting for a
 * tool to tell it.
 *
 * A check produces a state, never a page: when the state changes the monitor
 * posts an alert to its own managed source, and the whole alerting pipeline
 * applies from there — grouping, the three choices, the owner's policy, the
 * incident. One road, whatever the signal came from.
 *
 * Only the kinds this process can genuinely perform are here. The one that is
 * not is `synthetic`: a browser does not belong in an image every installation
 * downloads, so the sweep hands that job to the `synthetic-run` queue and the
 * runner writes its result back through the same road — `applyCheckResult`
 * below, which every type goes through.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
import {
  enqueueSyntheticRun,
  syntheticConfigOf,
  syntheticRunnerLive,
  type MonitorCheckResult,
} from "./synthetic";

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

/**
 * The kinds this process performs itself.
 *
 * `synthetic` is deliberately absent: the sweep dispatches it to the browser
 * runner instead of checking it in process.
 */
export const RUNNABLE_TYPES = [
  "http",
  "api",
  "port",
  "dns",
  "ssl",
  "domain",
  "ping",
  "incoming",
  "manual",
] as const;
export type RunnableType = (typeof RUNNABLE_TYPES)[number];

export type CheckSample = {
  reachable: boolean;
  statusCode?: number;
  latencyMs?: number;
  body?: string;
  headers?: Record<string, string>;
  daysToExpiry?: number;
  recordValue?: string;
  /** Ping: share of echo requests that came back unanswered, 0–100. */
  packetLossPct?: number;
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

const run = promisify(execFile);

/**
 * Ping, through iputils rather than a raw socket.
 *
 * Node cannot open an ICMP socket: `dgram` does not speak IPPROTO_ICMP, and a
 * raw socket would need CAP_NET_RAW. The system `ping` needs neither — Linux
 * has an unprivileged ICMP datagram socket, and Docker has opened it to every
 * container since 2020 through net.ipv4.ping_group_range. What Node cannot do,
 * the binary next to it does, so this is a two-line dependency rather than a
 * native module in the image.
 *
 * busybox's ping is NOT enough: it still wants the capability. The worker image
 * installs iputils for this.
 */
async function checkPing(
  target: string,
  config: Record<string, unknown>,
  timeoutMs: number,
): Promise<CheckSample> {
  const host = target.replace(/^\w+:\/\//, "").split("/")[0]!;
  if (!/^[a-zA-Z0-9.:_-]+$/.test(host)) {
    return { reachable: false, detail: "target is not a host name or address" };
  }
  const count = Math.min(10, Math.max(1, Number(config.count ?? 3)));
  const waitSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  // -W counts seconds on iputils (the image) and milliseconds on macOS (a
  // developer's laptop). The same number in both would mean a one-millisecond
  // patience on the machine where people try things out.
  const wait = process.platform === "darwin" ? String(waitSeconds * 1000) : String(waitSeconds);
  const started = Date.now();
  try {
    // -n no DNS on the output, -q summary only, -c count, -W per-reply wait.
    const { stdout } = await run("ping", ["-n", "-q", "-c", String(count), "-W", wait, host], {
      timeout: timeoutMs + waitSeconds * 1000,
      maxBuffer: 64 * 1024,
    });
    const loss = /(\d+(?:\.\d+)?)% packet loss/.exec(stdout);
    const rtt = /=\s*([\d.]+)\/([\d.]+)\/([\d.]+)/.exec(stdout);
    const lossPct = loss ? Number(loss[1]) : 100;
    const avg = rtt ? Number(rtt[2]) : undefined;
    return {
      reachable: lossPct < 100,
      packetLossPct: lossPct,
      latencyMs: avg !== undefined ? Math.round(avg) : Date.now() - started,
      detail:
        lossPct === 0 ? `${count}/${count} replies · ${avg ?? "?"} ms` : `${lossPct}% packet loss`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 100% loss makes ping exit non-zero with a normal summary: that is a
    // result, not a failure of ours.
    if (/packet loss/.test(message)) {
      return { reachable: false, packetLossPct: 100, detail: "100% packet loss" };
    }
    return { reachable: false, detail: message.slice(0, 200) };
  }
}

/** The IANA bootstrap: which RDAP server answers for a TLD. Cached for a day. */
let rdapBootstrap: { at: number; byTld: Map<string, string> } | null = null;

async function rdapServerFor(tld: string): Promise<string | null> {
  const day = 24 * 3600 * 1000;
  if (!rdapBootstrap || Date.now() - rdapBootstrap.at > day) {
    const res = await fetch("https://data.iana.org/rdap/dns.json", {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`IANA bootstrap answered ${res.status}`);
    const body = (await res.json()) as { services: [string[], string[]][] };
    const byTld = new Map<string, string>();
    for (const [tlds, urls] of body.services) {
      const url = urls.find((u) => u.startsWith("https://")) ?? urls[0];
      if (!url) continue;
      for (const t of tlds) byTld.set(t.toLowerCase(), url.replace(/\/$/, ""));
    }
    rdapBootstrap = { at: Date.now(), byTld };
  }
  return rdapBootstrap.byTld.get(tld) ?? null;
}

/**
 * When a domain name expires — read from RDAP, the registries' JSON.
 *
 * WHOIS on port 43 is free text in a different shape per registrar, which is
 * exactly what made this check painful. RDAP is the same question answered in
 * JSON, and the IANA publishes the routing table for about 1 200 TLDs.
 *
 * A registry that publishes neither is reported as such. A monitor that cannot
 * read the date says so; it does not stay green.
 */
async function checkDomain(target: string, timeoutMs: number): Promise<CheckSample> {
  const name = target
    .replace(/^\w+:\/\//, "")
    .split("/")[0]!
    .replace(/\.$/, "")
    .toLowerCase();
  const tld = name.split(".").pop() ?? "";
  const started = Date.now();
  try {
    const base = await rdapServerFor(tld);
    if (!base) {
      return {
        reachable: false,
        detail: `no RDAP server published for .${tld} — this registry cannot be read`,
      };
    }
    const res = await fetch(`${base}/domain/${encodeURIComponent(name)}`, {
      headers: { accept: "application/rdap+json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 404) {
      return { reachable: false, latencyMs: Date.now() - started, detail: "domain not registered" };
    }
    if (!res.ok) {
      return {
        reachable: false,
        latencyMs: Date.now() - started,
        detail: `registry answered ${res.status}`,
      };
    }
    const body = (await res.json()) as {
      events?: { eventAction?: string; eventDate?: string }[];
      status?: string[];
    };
    const expiry = body.events?.find((e) => e.eventAction === "expiration")?.eventDate;
    if (!expiry) {
      return {
        reachable: true,
        latencyMs: Date.now() - started,
        detail: "registry publishes no expiration date",
      };
    }
    const days = Math.floor((Date.parse(expiry) - Date.now()) / 86_400_000);
    const holds = (body.status ?? []).filter((s) => /hold|pending ?delete/i.test(s));
    return {
      reachable: true,
      latencyMs: Date.now() - started,
      daysToExpiry: days,
      recordValue: (body.status ?? []).join(", "),
      detail: holds.length
        ? `expires in ${days} days · ${holds.join(", ")}`
        : `expires in ${days} days`,
    };
  } catch (err) {
    return {
      reachable: false,
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
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
    case "ping":
      return checkPing(monitor.target, monitor.config, timeoutMs);
    case "domain":
      return checkDomain(monitor.target, timeoutMs);
    default:
      return { reachable: false, detail: `type ${monitor.type} is not checked by this worker` };
  }
}

/* ---------- Turning a sample into a state ---------- */

/**
 * What a criterion can read.
 *
 * Wider than the stored union while `packet_loss_pct` waits for its migration:
 * the engine can already answer it, and a stored criterion is validated against
 * the schema before it ever reaches here.
 */
type CriterionInput = MonitorCriterion["on"] | "packet_loss_pct";

function read(
  criterion: { on: CriterionInput; field?: string },
  sample: CheckSample,
): string | number | boolean | null {
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
    case "packet_loss_pct":
      return sample.packetLossPct ?? null;
    default:
      return null;
  }
}

function holds(criterion: MonitorCriterion, sample: CheckSample): boolean {
  const actual = read(criterion as { on: CriterionInput; field?: string }, sample);
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

/** What the caller of a check gets back, once it has been written down. */
export type CheckOutcome = {
  state: MonitorState;
  why: string;
  changed: boolean;
  /** True when a state change reached the ingest endpoint. */
  published: boolean;
};

/**
 * The single road every check takes, whoever produced it.
 *
 * A sample becomes a state, a row in `monitor_checks`, seconds in the day
 * rollup, the monitor's own last-known state — and, when that state changed, an
 * alert posted to the workspace's own ingest endpoint, exactly as a third-party
 * tool would post one. The in-process sweep goes through here, and so does the
 * browser runner over in `apps/synthetic`: one road, whatever the signal.
 */
export async function applyCheckResult(
  tenantId: string,
  monitorId: string,
  sample: CheckSample,
  opts: { result?: MonitorCheckResult | null; now?: Date } = {},
): Promise<CheckOutcome | null> {
  const now = opts.now ?? new Date();
  const written = await withTenant(tenantId, async (tx) => {
    const [m] = await tx
      .select({
        id: monitors.id,
        name: monitors.name,
        type: monitors.type,
        criteria: monitors.criteria,
        intervalSeconds: monitors.intervalSeconds,
        state: monitors.state,
        serviceKey: services.key,
      })
      .from(monitors)
      .leftJoin(services, eq(services.id, monitors.serviceId))
      .where(and(eq(monitors.tenantId, tenantId), eq(monitors.id, monitorId)));
    if (!m) return null;

    const { state, why } = stateFromSample(m.criteria, sample);
    await tx.insert(monitorChecks).values({
      tenantId,
      monitorId,
      at: now,
      state,
      latencyMs: sample.latencyMs ?? null,
      detail: why.slice(0, 500),
      result: opts.result ?? null,
    });
    await rollUp(tx, tenantId, monitorId, state, m.intervalSeconds, now);
    const changed = state !== m.state;
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
      .where(eq(monitors.id, monitorId));
    return { monitor: m, state, why, changed };
  });
  if (!written) return null;

  const { monitor: m, state, why, changed } = written;
  if (!changed) return { state, why, changed, published: false };

  const firing = DOWN.includes(state);
  const wasDown = DOWN.includes(m.state);
  // Neither down now nor down before: waiting → online on the first check is
  // not news, and paging for it would page for every monitor ever created.
  if (!firing && !wasDown) return { state, why, changed, published: false };

  const tenant = await getTenantById(tenantId);
  const origin = tenant ? tenantOrigin(tenant.slug, tenant.customDomain) : null;
  if (!origin) return { state, why, changed, published: false };

  const source = await withTenant(tenantId, (tx) => ensureMonitorSource(tx, tenantId));
  const published = await postAlert(origin, source, {
    title: firing ? `${m.name} is ${state}` : `${m.name} is back online`,
    status: firing ? "firing" : "resolved",
    dedup_key: `monitor:${m.id}`,
    severity: state === "offline" ? "P2" : "P3",
    description: why,
    attributes: {
      ...(m.serviceKey ? { service: m.serviceKey } : {}),
      monitor: m.name,
      // The id, not only the name: a rule that has to single out one
      // monitor needs something a rename cannot break.
      monitor_id: m.id,
      monitor_type: m.type,
    },
    url: `${origin}/app/monitors/${m.id}`,
  });
  return { state, why, changed, published };
}

/**
 * Hands a synthetic monitor to the browser runner.
 *
 * Nothing is written here: the run has not happened yet, and a check row for a
 * journey that has not been played would be an invention. When no runner has
 * announced itself the job is not even queued — jobs piling up in Redis for a
 * service nobody started is a silence the screens already explain, with the
 * command to fix it.
 */
async function dispatchSynthetic(
  tenantId: string,
  m: { id: string; name: string; type: string; config: Record<string, unknown> },
): Promise<"queued" | "no-runner" | "invalid"> {
  if (!(await syntheticRunnerLive())) return "no-runner";
  const journey = syntheticConfigOf(m);
  if (!journey) return "invalid";
  const queued = await enqueueSyntheticRun({
    tenantId,
    monitorId: m.id,
    monitorName: m.name,
    steps: journey.steps,
    budgetMs: journey.budgetMs,
    viewport: journey.viewport,
    trigger: "sweep",
  });
  return queued ? "queued" : "no-runner";
}

/**
 * Runs every monitor whose turn it is, across the given workspaces.
 *
 * Returns how many state changes it published — the number worth logging,
 * since a sweep where nothing changed is the normal case.
 */
export async function sweepMonitors(tenantIds: string[], now = new Date()): Promise<number> {
  let changes = 0;
  let unrunnable = 0;
  for (const tenantId of tenantIds) {
    const due = await withTenant(tenantId, (tx) =>
      tx
        .select({
          id: monitors.id,
          name: monitors.name,
          type: monitors.type,
          target: monitors.target,
          config: monitors.config,
          intervalSeconds: monitors.intervalSeconds,
          lastCheckAt: monitors.lastCheckAt,
          expectEverySeconds: monitors.expectEverySeconds,
        })
        .from(monitors)
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

    for (const m of due) {
      // A manual monitor is set by a human; an incoming one is judged by its
      // silence, which the heartbeat sweep already watches.
      if (m.type === "manual") continue;

      // A browser is not this process's to run: the job goes to the runner,
      // which writes its result back through applyCheckResult like the rest.
      if (m.type === "synthetic") {
        if ((await dispatchSynthetic(tenantId, m)) !== "queued") unrunnable++;
        continue;
      }

      const sample =
        m.type === "incoming"
          ? {
              reachable:
                !!m.lastCheckAt &&
                m.lastCheckAt.getTime() + (m.expectEverySeconds ?? 86_400) * 1000 > now.getTime(),
              detail: "waiting for a ping",
            }
          : await performCheck({ type: m.type, target: m.target, config: m.config });

      const outcome = await applyCheckResult(tenantId, m.id, sample, { now });
      if (outcome?.published) changes++;
    }
  }
  if (unrunnable)
    console.log(
      `[monitor-sweep] ${unrunnable} synthetic monitor(s) not run — no browser runner announced itself`,
    );
  return changes;
}
