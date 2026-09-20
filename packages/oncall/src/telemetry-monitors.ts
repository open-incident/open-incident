/**
 * The sweep that turns telemetry into a page.
 *
 * A reachability monitor has one state, so it keeps it on its own row. A
 * telemetry monitor grouped by route has one state per route, and the routes
 * are not a fixed list: one appears when traffic reaches it and goes quiet
 * when it stops. So the states live in `telemetry_monitor_series`, keyed by
 * the label set, and the sweep's job is to move each of them and post an alert
 * when one changes.
 *
 * Everything it publishes goes through `postAlert` — the same door a
 * third-party tool posts through. There is no private path from a monitor to
 * an incident, which is what keeps the rules, the deduplication and the
 * escalation identical whoever raised the alert.
 */
import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import {
  getTenantById,
  isTelemetryMonitor,
  monitors,
  services,
  telemetryMonitorSeries,
  withTenant,
  type MonitorState,
  type TelemetryQuery,
  type TelemetrySeriesState,
} from "@openincident/db";
import {
  baselines,
  evaluateTelemetryMonitor,
  seriesKeyOf,
  verdictFor,
  type Baseline,
  type SeriesValue,
  type TelemetryMonitorKind,
} from "@openincident/telemetry";
import { telemetryInstalled } from "@openincident/telemetry";
import { ensureMonitorSource, postAlert } from "./monitors";
import { tenantOrigin } from "./notify";

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A series nobody has seen for this long stops being watched. */
const FORGET_AFTER_HOURS = 24;

type Row = {
  id: string;
  name: string;
  type: string;
  telemetryQuery: TelemetryQuery | null;
  intervalSeconds: number;
  serviceKey: string | null;
};

type Held = {
  id: string;
  seriesKey: string;
  state: TelemetrySeriesState;
  lastVerdict: TelemetrySeriesState;
  consecutive: number;
};

export type TelemetrySweepResult = { evaluated: number; published: number; failed: number };

/** The columns a monitor is evaluated from, selected the same way everywhere. */
const COLUMNS = {
  id: monitors.id,
  name: monitors.name,
  type: monitors.type,
  telemetryQuery: monitors.telemetryQuery,
  intervalSeconds: monitors.intervalSeconds,
  serviceKey: services.key,
};

/**
 * One monitor, now, whatever its interval says.
 *
 * This is "check now" on the monitor's own screen. It goes through the same
 * `runOne` as the sweep — same evaluation, same series, same alerts — because
 * a button that checks differently from the scheduler is a button that lies
 * about what the scheduler will do.
 */
export async function evaluateTelemetryMonitorNow(
  tenantId: string,
  monitorId: string,
  now = new Date(),
): Promise<TelemetrySweepResult> {
  const out: TelemetrySweepResult = { evaluated: 0, published: 0, failed: 0 };
  if (!telemetryInstalled()) return out;
  const [monitor] = await withTenant(tenantId, (tx) =>
    tx
      .select(COLUMNS)
      .from(monitors)
      .leftJoin(services, eq(services.id, monitors.serviceId))
      .where(and(eq(monitors.tenantId, tenantId), eq(monitors.id, monitorId))),
  );
  if (!monitor || !isTelemetryMonitor(monitor.type) || !monitor.telemetryQuery) return out;
  out.evaluated = 1;
  try {
    out.published = await runOne(tenantId, monitor as Row, now);
  } catch (err) {
    out.failed = 1;
    await noteFailure(tenantId, monitor.id, err, now);
  }
  return out;
}

export async function sweepTelemetryMonitors(
  tenantIds: string[],
  now = new Date(),
): Promise<TelemetrySweepResult> {
  const out: TelemetrySweepResult = { evaluated: 0, published: 0, failed: 0 };
  // Without a column store there is nothing to read, and a monitor of these
  // types cannot have been created either. Saying nothing beats a per-tenant
  // connection error every minute.
  if (!telemetryInstalled()) return out;

  // Shuffled rather than taken in order. Every sweep reads the same column
  // store, and a sweep that runs long is a sweep whose last workspace was
  // evaluated late — always the same one, if the order never changes. This is
  // the jitter §15.8 asks for, applied where it costs nothing.
  for (const tenantId of shuffled(tenantIds)) {
    const due = await withTenant(tenantId, (tx) =>
      tx
        .select(COLUMNS)
        .from(monitors)
        .leftJoin(services, eq(services.id, monitors.serviceId))
        .where(
          and(
            eq(monitors.tenantId, tenantId),
            eq(monitors.paused, false),
            sql`${monitors.type} IN ('logs', 'traces', 'metrics', 'exceptions')`,
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

    for (const monitor of due) {
      if (!isTelemetryMonitor(monitor.type) || !monitor.telemetryQuery) continue;
      out.evaluated++;
      try {
        out.published += await runOne(tenantId, monitor as Row, now);
      } catch (err) {
        out.failed++;
        await noteFailure(tenantId, monitor.id, err, now);
      }
    }
  }
  return out;
}

/** One monitor: evaluate, move every series, publish what changed. */
async function runOne(tenantId: string, monitor: Row, now: Date): Promise<number> {
  const q = monitor.telemetryQuery!;
  const kind = monitor.type as TelemetryMonitorKind;
  const values = await evaluateTelemetryMonitor(tenantId, kind, q, now);
  const learned =
    q.condition.kind === "anomaly"
      ? await baselines(tenantId, kind, q, now)
      : new Map<string, Baseline>();

  const held = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: telemetryMonitorSeries.id,
        seriesKey: telemetryMonitorSeries.seriesKey,
        state: telemetryMonitorSeries.state,
        lastVerdict: telemetryMonitorSeries.lastVerdict,
        consecutive: telemetryMonitorSeries.consecutive,
      })
      .from(telemetryMonitorSeries)
      .where(
        and(
          eq(telemetryMonitorSeries.tenantId, tenantId),
          eq(telemetryMonitorSeries.monitorId, monitor.id),
        ),
      ),
  );
  const seen = new Set<string>();
  let published = 0;
  for (const value of values) {
    seen.add(value.key);
    published += await moveSeries(tenantId, monitor, q, value, learned.get(value.key), now);
  }

  // Series that answered before and did not this time. Whether that is news is
  // the author's call, because silence means opposite things depending on what
  // is being watched: a queue with no messages is fine, a heartbeat with no
  // logs is the incident.
  for (const h of held) {
    if (seen.has(h.seriesKey)) continue;
    if (q.noData === "ignore") continue;
    const labels = labelsOf(h.seriesKey);
    if (q.noData === "zero") {
      published += await moveSeries(
        tenantId,
        monitor,
        q,
        { key: h.seriesKey, labels, value: 0 },
        learned.get(h.seriesKey),
        now,
      );
      continue;
    }
    published += await settle(tenantId, monitor, q, h, {
      key: h.seriesKey,
      labels,
      verdict: "breaching",
      why: "no data in the window",
      value: null,
      state: "no_data",
      now,
    });
  }

  // A monitor with no series at all and a `trigger` policy: nothing answered
  // and nothing answered before either, so there is no row to move. The
  // monitor as a whole is the series.
  if (values.length === 0 && held.length === 0 && q.noData === "trigger") {
    published += await settle(tenantId, monitor, q, undefined, {
      key: seriesKeyOf({}),
      labels: {},
      verdict: "breaching",
      why: "no data in the window",
      value: null,
      state: "no_data",
      now,
    });
  }

  /*
   * The monitor's own state, rolled up from its series.
   *
   * It has to be written, and not only because the list looks odd otherwise:
   * a monitor stuck on "waiting for its first check" after running for a week
   * tells the reader it is not working. One series breaching is enough to call
   * the monitor offline — that is the series somebody was paged about.
   */
  const rolled = await withTenant(tenantId, (tx) =>
    tx
      .select({
        state: telemetryMonitorSeries.state,
        detail: telemetryMonitorSeries.lastDetail,
      })
      .from(telemetryMonitorSeries)
      .where(
        and(
          eq(telemetryMonitorSeries.tenantId, tenantId),
          eq(telemetryMonitorSeries.monitorId, monitor.id),
        ),
      ),
  );
  const down = rolled.filter((r) => r.state === "breaching" || r.state === "no_data");
  const state: MonitorState =
    down.length > 0 ? "offline" : rolled.length > 0 ? "online" : "waiting";
  const detail =
    down[0]?.detail ??
    (rolled.length > 0 ? `${rolled.length} series within range` : "nothing matched the query yet");

  await withTenant(tenantId, async (tx) => {
    await tx
      .update(monitors)
      .set({
        lastCheckAt: now,
        state,
        lastDetail: detail.slice(0, 500),
        updatedAt: now,
      })
      .where(and(eq(monitors.tenantId, tenantId), eq(monitors.id, monitor.id)));
    await tx
      .delete(telemetryMonitorSeries)
      .where(
        and(
          eq(telemetryMonitorSeries.tenantId, tenantId),
          eq(telemetryMonitorSeries.monitorId, monitor.id),
          lt(
            telemetryMonitorSeries.lastSeenAt,
            new Date(now.getTime() - FORGET_AFTER_HOURS * 3_600_000),
          ),
        ),
      );
  });
  return published;
}

async function moveSeries(
  tenantId: string,
  monitor: Row,
  q: TelemetryQuery,
  value: SeriesValue,
  baseline: Baseline | undefined,
  now: Date,
): Promise<number> {
  const { verdict, why } = verdictFor(value.value, q.condition, baseline);
  const held = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: telemetryMonitorSeries.id,
        seriesKey: telemetryMonitorSeries.seriesKey,
        state: telemetryMonitorSeries.state,
        lastVerdict: telemetryMonitorSeries.lastVerdict,
        consecutive: telemetryMonitorSeries.consecutive,
      })
      .from(telemetryMonitorSeries)
      .where(
        and(
          eq(telemetryMonitorSeries.tenantId, tenantId),
          eq(telemetryMonitorSeries.monitorId, monitor.id),
          eq(telemetryMonitorSeries.seriesKey, value.key),
        ),
      )
      .then((rows) => rows[0] as Held | undefined),
  );
  return settle(tenantId, monitor, q, held, {
    key: value.key,
    labels: value.labels,
    verdict,
    why,
    value: value.value,
    state: verdict === "learning" ? "learning" : verdict === "breaching" ? "breaching" : "ok",
    now,
  });
}

type Settlement = {
  key: string;
  labels: Record<string, string>;
  verdict: "ok" | "breaching" | "learning";
  why: string;
  value: number | null;
  state: TelemetrySeriesState;
  now: Date;
};

/**
 * Writes one series' new state and posts an alert when it turned over.
 *
 * `for` is counted here, and it is counted on **consecutive agreeing
 * evaluations** rather than on elapsed time: a monitor evaluated every minute
 * with `for: 3` needs three minutes of the same answer, and one minute of
 * recovery in the middle starts it again. That is the property somebody wants
 * when they write `for` — not "it was bad at some point in the last three
 * minutes".
 */
async function settle(
  tenantId: string,
  monitor: Row,
  q: TelemetryQuery,
  held: Held | undefined,
  s: Settlement,
): Promise<number> {
  const firing = held?.state === "breaching" || held?.state === "no_data";
  const wantsFiring = s.state === "breaching" || s.state === "no_data";
  // Counted against the last **verdict**, not against the published state. A
  // monitor with `for: 3` publishes `ok` after its first two breaches, and
  // comparing the third breach to that `ok` would call it a change of mind and
  // start again — which is how a `for` that never fires is written.
  const agreeing = held && sameSide(held.lastVerdict, s.state) ? held.consecutive + 1 : 1;
  const need = Math.max(1, q.forEvaluations || 1);

  // A breach holds for `for` evaluations before it counts; a recovery does not
  // wait, because keeping somebody paged for a service that came back is the
  // one direction where being slow is never the safe choice.
  const settled = wantsFiring ? agreeing >= need : true;
  const next: TelemetrySeriesState = settled ? s.state : (held?.state ?? "ok");
  const changed = settled && next !== (held?.state ?? "ok");

  /*
   * The alert goes out **before** the state is written, and the state only
   * moves if it went out.
   *
   * The other order loses alerts: write "breaching", fail to reach the ingest
   * endpoint, and the next evaluation sees no change and says nothing — the
   * page never happens and nothing ever retries. Posting first can at worst
   * post twice, and the pipeline deduplicates on `dedup_key`, so a duplicate
   * costs nothing while a silence costs the incident.
   */
  const news = changed && (wantsFiring || firing);
  const published = news ? await announce(tenantId, monitor, q, s, wantsFiring) : true;
  const committed = published ? next : (held?.state ?? "ok");

  await withTenant(tenantId, async (tx) => {
    await tx
      .insert(telemetryMonitorSeries)
      .values({
        tenantId,
        monitorId: monitor.id,
        seriesKey: s.key,
        labels: s.labels,
        state: committed,
        lastVerdict: s.state,
        consecutive: agreeing,
        lastValue: s.value,
        lastDetail: s.why.slice(0, 500),
        stateSince: s.now,
        lastSeenAt: s.now,
      })
      .onConflictDoUpdate({
        target: [telemetryMonitorSeries.monitorId, telemetryMonitorSeries.seriesKey],
        set: {
          labels: s.labels,
          state: committed,
          lastVerdict: s.state,
          consecutive: agreeing,
          lastValue: s.value,
          lastDetail: s.why.slice(0, 500),
          lastSeenAt: s.now,
          ...(changed && published ? { stateSince: s.now } : {}),
        },
      });
  });

  return news && published ? 1 : 0;
}

/** The alert itself, on the road every other alert takes. */
async function announce(
  tenantId: string,
  monitor: Row,
  q: TelemetryQuery,
  s: Settlement,
  wantsFiring: boolean,
): Promise<boolean> {
  const tenant = await getTenantById(tenantId);
  const origin = tenant ? tenantOrigin(tenant.slug, tenant.customDomain) : null;
  if (!origin) return false;
  const source = await withTenant(tenantId, (tx) => ensureMonitorSource(tx, tenantId));

  const where = Object.entries(s.labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const subject = where ? `${monitor.name} — ${where}` : monitor.name;
  return postAlert(origin, source, {
    title: wantsFiring
      ? s.state === "no_data"
        ? `${subject} has stopped reporting`
        : `${subject} is breaching`
      : `${subject} is back to normal`,
    status: wantsFiring ? "firing" : "resolved",
    // The series is in the key: two routes breaching are two alerts, and the
    // one that recovers resolves its own.
    dedup_key: `telemetry:${monitor.id}:${s.key}`,
    severity: severityOf(q),
    description: s.why,
    attributes: {
      ...(monitor.serviceKey ? { service: monitor.serviceKey } : {}),
      monitor: monitor.name,
      monitor_id: monitor.id,
      monitor_type: monitor.type,
      /*
       * The query and the window travel with the alert (§15.8).
       *
       * Somebody woken at three in the morning should be able to see what was
       * measured without opening the monitor and reconstructing it: the
       * expression, over how long, and the number it produced.
       */
      telemetry_query: q.query.slice(0, 500),
      telemetry_window: `${q.windowMinutes}m`,
      ...(s.value !== null ? { telemetry_value: String(s.value) } : {}),
      ...s.labels,
    },
    url: `${origin}/app/monitors/${monitor.id}`,
  });
}

/** Breaching and no-data are the same side of the fence: somebody is paged. */
function sameSide(a: TelemetrySeriesState, b: TelemetrySeriesState): boolean {
  const down = (s: TelemetrySeriesState) => s === "breaching" || s === "no_data";
  return down(a) === down(b) && (down(a) || a === b);
}

function severityOf(q: TelemetryQuery): string {
  if (q.severity) return q.severity;
  // An anomaly is a statement about statistics, a threshold is a statement
  // about a number somebody chose. The second is the more confident one.
  return q.condition.kind === "anomaly" ? "P3" : "P2";
}

function labelsOf(seriesKey: string): Record<string, string> {
  if (seriesKey === "*") return {};
  const out: Record<string, string> = {};
  for (const pair of seriesKey.split(",")) {
    const at = pair.indexOf("=");
    if (at > 0) out[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return out;
}

/**
 * A monitor whose query no longer runs.
 *
 * Written on the monitor rather than thrown away, because the screen has to be
 * able to say "this monitor is not watching anything" — a monitor that has
 * silently stopped evaluating is worse than no monitor, since somebody is
 * counting on it. `lastCheckAt` moves too, so a failing query is retried at
 * its own interval rather than on every sweep.
 */
async function noteFailure(
  tenantId: string,
  monitorId: string,
  err: unknown,
  now: Date,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[telemetry-monitors] ${monitorId}: ${message}`);
  await withTenant(tenantId, (tx) =>
    tx
      .update(monitors)
      .set({
        lastCheckAt: now,
        lastDetail: `query failed: ${message}`.slice(0, 500),
        updatedAt: now,
      })
      .where(and(eq(monitors.tenantId, tenantId), eq(monitors.id, monitorId))),
  );
}
