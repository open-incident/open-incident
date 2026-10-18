import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { isTelemetryMonitor, withTenant, type TelemetryQuery } from "@openincident/db";
import type { ChartSpec } from "@openincident/ui";
import { formatStep } from "@openincident/ui";
import { getT } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
import { readMonitorChoices } from "@/lib/monitor-choices";
import {
  byLocation,
  checkStats,
  getMonitor,
  latestCertificate,
  monitorBuckets,
  monitorCapabilities,
  monitorIncidents,
  recentChecks,
  serviceAnnotations,
  shownOn,
  THIS_INSTANCE,
  type CheckBucket,
} from "@/lib/monitors";
import { bucketStarts, pickStep, resolveWindow } from "@/lib/telemetry-window";
import { checkNow, togglePause } from "../actions";
import { JourneyCard } from "./journey-card";
import {
  CriteriaEditor,
  CriterionLine,
  criterionCondition as criterionText,
  msLabel,
} from "./criteria";
import { AdvancedTab } from "./advanced";
import { FullScreenButton, MonitorCharts, MonitorScreen, type FsData } from "./monitor-board";
import { ago, duration, everyLabel, ms } from "../format";
import type { MessageKey } from "@/i18n/dictionaries/en";

/**
 * The stored query read back as a sentence.
 *
 * The person who wrote it chose from selects; the row holds JSON. Rendering
 * the JSON would make them translate their own monitor back, so the sentence
 * is rebuilt from the same words the form used.
 */
function ruleSentence(
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
  type: string,
  q: TelemetryQuery,
): string {
  const measure =
    type === "metrics"
      ? t("telemetryMonitor.promql")
      : t(
          `telemetryMonitor.agg${q.aggregate[0]!.toUpperCase()}${q.aggregate.slice(1)}` as MessageKey,
        ) + (q.field ? ` ${q.field}` : "");
  const over = type === "metrics" ? "" : ` · ${t("telemetryMonitor.over")} ${q.windowMinutes} min`;
  const when =
    q.condition.kind === "threshold"
      ? `${q.condition.op} ${q.condition.value}`
      : t(
          `telemetryMonitor.dir${q.condition.direction[0]!.toUpperCase()}${q.condition.direction.slice(1)}` as MessageKey,
        );
  const held =
    q.forEvaluations > 1
      ? ` · ${t("telemetryMonitor.forN", { n: q.forEvaluations })}`
      : ` · ${t("telemetryMonitor.for1")}`;
  return `${measure}${over} · ${when}${held}`;
}

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
  padding: "14px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 9,
};

const EYEBROW: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".08em",
  color: "var(--ink-3)",
};

const STATE_TONE: Record<string, [string, string]> = {
  online: ["var(--ok-t)", "var(--ok)"],
  degraded: ["var(--wait-t)", "var(--wait)"],
  offline: ["var(--dang-t)", "var(--dang)"],
  paused: ["var(--sunk)", "var(--ink-3)"],
  waiting: ["var(--sunk)", "var(--ink-2)"],
};

const GHOST: React.CSSProperties = {
  height: 34,
  padding: "0 13px",
  border: "1px solid var(--line)",
  borderRadius: 9,
  background: "var(--panel)",
  display: "flex",
  alignItems: "center",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  color: "inherit",
  textDecoration: "none",
};

const TYPE_NAME: Record<string, MessageKey> = {
  http: "monitors.typeHttp",
  api: "monitors.typeApi",
  port: "monitors.typePort",
  dns: "monitors.typeDns",
  ssl: "monitors.typeSsl",
  domain: "monitors.typeDomain",
  ping: "monitors.typePing",
  synthetic: "monitors.typeSynthetic",
  incoming: "monitors.typeIncoming",
  manual: "monitors.typeManual",
  logs: "monitors.typeLogs",
  traces: "monitors.typeTraces",
  metrics: "monitors.typeMetrics",
  exceptions: "monitors.typeExceptions",
};

const RANGES = { "1h": 3_600_000, "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };
const LOC_COLOURS = ["var(--brand)", "var(--brand-2)", "var(--viol)", "var(--ok)", "var(--wait)"];
const TABS = ["overview", "slo", "criteria", "advanced"] as const;
type Tab = (typeof TABS)[number];

/** One monitor: how it is, how it got there, and what it does when it breaks. */
export default async function MonitorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    queued?: string;
    saved?: string;
    tab?: string;
    range?: string;
    from?: string;
    to?: string;
    fs?: string;
  }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "")
    ? (sp.tab as Tab)
    : "overview";

  const m = await withTenant(tenant.id, (tx) => getMonitor(tx, tenant.id, id));
  if (!m) notFound();
  const mayEdit = canRespond(member);
  const telemetry = isTelemetryMonitor(m.type);
  const tone = STATE_TONE[m.state] ?? STATE_TONE.waiting!;
  const runnerLive = m.journey ? (await monitorCapabilities()).synthetic?.ok : true;
  const http = m.type === "http" || m.type === "api";

  /*
   * The window. A paused monitor's history stops at its last check, and its
   * charts end there rather than drawing a day of nothing up to now.
   */
  const anchor = m.paused && m.lastCheckAt ? m.lastCheckAt.getTime() : Date.now();
  const win = resolveWindow(sp, RANGES, "24h", anchor);
  const step = pickStep(win.to - win.from, {
    points: 90,
    min: Math.min(m.intervalSeconds * 1000, 3_600_000),
  });

  const data = await withTenant(tenant.id, async (tx) => {
    const now = new Date();
    const day = new Date(anchor - 86_400_000);
    const [choices, buckets, notes, recent, locations, stats24, cert, incidents, pages] =
      await Promise.all([
        readMonitorChoices(tx, tenant.id, id),
        telemetry
          ? Promise.resolve([] as CheckBucket[])
          : monitorBuckets(tx, tenant.id, id, { ...win, step }),
        serviceAnnotations(tx, tenant.id, m.serviceKey, win.from, win.to),
        recentChecks(tx, tenant.id, id, 5),
        byLocation(tx, tenant.id, id),
        checkStats(tx, tenant.id, id, day, new Date(anchor)),
        latestCertificate(tx, tenant.id, id),
        monitorIncidents(tx, tenant.id, id, 90),
        shownOn(tx, tenant.id, id),
      ]);
    // How long the state before this one lasted — "13 min degraded before".
    const prev = await tx.execute<{ state: string; n: number }>(
      sqlPrevRun(tenant.id, id, m.stateSince ?? now),
    );
    return {
      choices,
      buckets,
      notes,
      recent,
      locations,
      stats24,
      cert,
      incidents,
      pages,
      prev: [...prev][0],
    };
  });

  const locName = (loc: string) => (loc === THIS_INSTANCE ? t("mon2.thisInstance") : loc);
  const locs = [...new Set(data.buckets.map((b) => b.loc))].sort();
  const primary = locs[0] ?? THIS_INSTANCE;
  const where = data.locations.length
    ? data.locations
        .map((l) => (l.loc === THIS_INSTANCE ? t("mon2.whereInstance") : l.loc))
        .join(", ")
    : t("mon2.whereInstance");

  // ---- The charts --------------------------------------------------------
  const grid = bucketStarts(win.from, win.to, step);
  const series = (loc: string, pick: (b: CheckBucket) => number | null) => {
    const byT = new Map(data.buckets.filter((b) => b.loc === loc).map((b) => [b.t, pick(b)]));
    return grid.map(
      (g) => [g, byT.has(g) ? (byT.get(g) ?? null) : null] as [number, number | null],
    );
  };
  const slow = m.criteria.find(
    (c) =>
      c.on === "response_time_ms" && (c.op === "gt" || c.op === "gte") && c.then === "degraded",
  );
  const threshold = slow
    ? {
        v: Number(slow.value),
        l: t("mon2.thresholdDegraded", { value: msLabel(Number(slow.value)) }),
      }
    : null;
  const marks = data.notes.marks.map((mk) =>
    mk.kind === "change"
      ? { t: mk.t, l: mk.label }
      : {
          t: mk.t,
          l: t("mon2.declared", { ref: mk.label }),
          c: "var(--dang)",
          bg: "var(--dang-t)",
        },
  );
  // A run of buckets where some check was not online is a band, per location.
  const bands: ChartSpec["bands"] = [];
  for (const loc of locs) {
    let open: { a: number; b: number; off: boolean } | null = null;
    for (const b of data.buckets.filter((x) => x.loc === loc)) {
      const bad = b.failed > 0 || b.degraded > 0;
      if (bad && open && b.t <= open.b) {
        open.b = b.t + step;
        open.off ||= b.failed > 0;
      } else if (bad) {
        if (open) bands.push(band(open, loc));
        open = { a: b.t, b: b.t + step, off: b.failed > 0 };
      }
    }
    if (open) bands.push(band(open, loc));
  }
  function band(o: { a: number; b: number; off: boolean }, loc: string) {
    return {
      a: o.a,
      b: o.b,
      l: o.off
        ? t("mon2.bandOffline", { loc: locName(loc) })
        : t("mon2.bandDegraded", { loc: locName(loc) }),
      bg: o.off ? "rgba(192,52,43,.07)" : "rgba(180,83,9,.07)",
      ink: o.off ? "var(--dang)" : "var(--wait)",
    };
  }
  const empty = t("mon2.noChecksWindow");
  const response = (h: number, hint: boolean) => ({
    h,
    hint,
    spec: {
      title: t("mon2.chartResponse"),
      sub: t("mon2.chartResponseSub"),
      unit: "ms",
      marks,
      bands,
      threshold,
      stepMs: step,
      empty,
      series: (locs.length ? locs : [THIS_INSTANCE]).map((loc, i) => ({
        n: locName(loc),
        c: LOC_COLOURS[i % LOC_COLOURS.length]!,
        points: series(loc, (b) => b.latency),
      })),
    } satisfies ChartSpec,
  });
  const phases = (h: number) => ({
    h,
    hint: false,
    spec: {
      title: t("mon2.chartPhases"),
      sub: t("mon2.chartPhasesSub", { loc: locName(primary) }),
      unit: "ms",
      marks,
      stepMs: step,
      empty: t("mon2.noPhases"),
      series: [
        {
          n: t("mon2.phaseFirstByte"),
          c: "var(--dang)",
          points: series(primary, (b) => b.firstByte),
        },
        { n: t("mon2.phaseTls"), c: "var(--viol)", points: series(primary, (b) => b.tls) },
        { n: t("mon2.phaseConnect"), c: "var(--ok)", points: series(primary, (b) => b.connect) },
        { n: t("mon2.phaseDns"), c: "var(--ink-3)", points: series(primary, (b) => b.dns) },
      ],
    } satisfies ChartSpec,
  });
  const failedPoints = (() => {
    const sum = new Map<number, number>();
    for (const b of data.buckets) sum.set(b.t, (sum.get(b.t) ?? 0) + b.failed);
    return grid.map((g) => [g, sum.has(g) ? sum.get(g)! : null] as [number, number | null]);
  })();
  const failedMax = Math.max(0, ...failedPoints.map(([, v]) => v ?? 0));
  const failed = {
    h: 160,
    hint: false,
    spec: {
      title: t("mon2.chartFailed"),
      sub: t("mon2.chartFailedSub", { step: formatStep(step) }),
      unit: "n",
      kind: "area",
      marks,
      max: Math.max(4, Math.ceil(failedMax * 1.2)),
      stepMs: step,
      empty,
      series: [{ n: t("mon2.failedSeries"), c: "var(--dang)", points: failedPoints }],
    } satisfies ChartSpec,
  };
  const charts = [response(190, true), ...(http ? [phases(150)] : [])];
  const fsCharts = [response(300, false), ...(http ? [phases(240)] : []), failed];

  // ---- The figures ------------------------------------------------------
  const stateLabel = t(`monitors.state.${m.state}` as MessageKey);
  const every = everyLabel(m.intervalSeconds);
  const downtime = m.downtime90Seconds > 0 ? duration(m.downtime90Seconds) : "0";
  const kpis = [
    {
      l: t("monitors.kpiUptime"),
      v: m.uptime90 === null ? "—" : `${+m.uptime90.toFixed(2)} %`,
      ink: m.uptime90 === null ? "var(--ink-3)" : "var(--ok)",
    },
    { l: t("monitors.kpiNow"), v: ms(m.lastLatencyMs), ink: "var(--ink)" },
    { l: t("mon2.kpiIncidents90"), v: String(data.incidents.length), ink: "var(--ink)" },
    { l: t("monitors.kpiDowntime"), v: downtime, ink: "var(--ink)" },
  ];
  const s24 = data.stats24;
  const up24 = s24.checks
    ? ((s24.checks - s24.failed - s24.degradedSeconds / m.intervalSeconds) / s24.checks) * 100
    : null;
  const httpsTarget = /^https:\/\//i.test(m.target);
  const lastLoc = data.recent[0] ? locName(data.recent[0].loc) : locName(THIS_INSTANCE);
  const fmtDate = (d: Date) =>
    new Intl.DateTimeFormat(t.locale.code === "en" ? "en-US" : t.locale.tag, {
      month: "short",
      day: "numeric",
      timeZone: t.timeZone,
    }).format(d);
  const sinceTime = m.stateSince ? t.fmt.time(m.stateSince, t.timeZone) : null;
  const fsKpis = [
    {
      l: t("mon2.kpiStatus"),
      v: stateLabel,
      sub: !sinceTime
        ? ""
        : data.prev && data.prev.state !== m.state && data.prev.n > 0
          ? t("mon2.statusSinceBefore", {
              time: sinceTime,
              dur: duration(data.prev.n * m.intervalSeconds),
              state: t(`monitors.state.${data.prev.state}` as MessageKey).toLowerCase(),
            })
          : t("mon2.statusSince", { time: sinceTime }),
      ink: tone[1],
    },
    {
      l: t("mon2.kpiResponseNow"),
      v: ms(m.lastLatencyMs),
      sub: s24.p95 !== null ? t("mon2.responseSub", { loc: lastLoc, p95: ms(s24.p95) }) : lastLoc,
      ink: "var(--ink)",
    },
    {
      l: t("mon2.kpiUptime24"),
      v: up24 === null ? "—" : `${up24.toFixed(2)} %`,
      sub:
        s24.offlineSeconds > 0
          ? t("mon2.uptime24Down", { dur: duration(s24.offlineSeconds) })
          : s24.degradedSeconds > 0
            ? t("mon2.uptime24Degraded", { dur: duration(s24.degradedSeconds) })
            : t("mon2.uptimeClean"),
      ink:
        up24 === null
          ? "var(--ink-3)"
          : s24.offlineSeconds > 0
            ? "var(--dang)"
            : s24.degradedSeconds > 0
              ? "var(--wait)"
              : "var(--ok)",
    },
    {
      l: t("mon2.kpiUptime90"),
      v: m.uptime90 === null ? "—" : `${+m.uptime90.toFixed(2)} %`,
      sub: t("mon2.uptime90Down", { dur: downtime === "0" ? "0 min" : downtime }),
      ink: m.uptime90 === null ? "var(--ink-3)" : "var(--ok)",
    },
    {
      l: t("mon2.kpiChecks24"),
      v: t.fmt.number(s24.checks),
      sub: t("mon2.checksFailed", { count: s24.failed }),
      ink: "var(--ink)",
    },
    data.cert
      ? {
          l: t("mon2.kpiSsl"),
          v: t("mon2.sslDays", {
            n: Math.floor((data.cert.validTo.getTime() - Date.now()) / 86_400_000),
          }),
          sub: data.cert.issuer
            ? t("mon2.sslExpires", { date: fmtDate(data.cert.validTo), issuer: data.cert.issuer })
            : t("mon2.sslExpiresNoIssuer", { date: fmtDate(data.cert.validTo) }),
          ink: "var(--ink)",
        }
      : {
          l: t("mon2.kpiSsl"),
          v: "—",
          sub: httpsTarget || !http ? t("mon2.sslNone") : t("mon2.sslPlain"),
          ink: "var(--ink-3)",
        },
  ];
  const checkInk = (s: string) => STATE_TONE[s]?.[1] ?? "var(--ink-2)";
  const criteriaShort = (
    <>
      {m.criteria
        .filter((c) => c.then !== "online")
        .map((c, i) => (
          <span key={i}>
            {i > 0 ? " · " : ""}
            <CriterionInline t={t} c={c} />
          </span>
        ))}
      {m.criteria.filter((c) => c.then !== "online").length === 0 && t("monitors.noCriteria")}
    </>
  );
  const fs: FsData = {
    name: m.name,
    line: t("mon2.fsEvery", { target: targetLine(m), every }),
    state: m.state,
    stateLabel,
    tone,
    kpis: fsKpis,
    locations: (data.locations.length ? data.locations : []).map((l) => ({
      n: locName(l.loc),
      sub: l.region
        ? t("mon2.locSub", { region: l.region, ago: ago(l.lastAt) })
        : t("mon2.locSubLocal", { ago: ago(l.lastAt) }),
      ms: ms(l.latencyMs),
      c: checkInk(l.state),
    })),
    checks: data.recent.map((c) => ({
      t: t.fmt.time(c.at, t.timeZone),
      st: t(`monitors.state.${c.state}` as MessageKey),
      from: locName(c.loc),
      ms: c.latencyMs === null ? "—" : `${t.fmt.number(c.latencyMs)} ms`,
      ink: checkInk(c.state),
    })),
    criteria: criteriaShort,
    criteriaTitle: t("mon2.fsCriteriaTitle"),
    byLocation: t("mon2.byLocation"),
    recentChecks: t("monitors.recentChecks"),
    nextCheckAt: m.lastCheckAt ? m.lastCheckAt.getTime() + m.intervalSeconds * 1000 : null,
    paused: m.paused,
  };

  const tabHref = (k: Tab) => `/app/monitors/${m.id}${k === "overview" ? "" : `?tab=${k}`}`;
  const choices = data.choices;
  const pageLabel =
    choices.choices.page.kind === "owner"
      ? t("monitors.pageOwner")
      : choices.choices.page.kind === "nobody"
        ? t("monitors.pageNobody")
        : (choices.pageName ?? t("monitors.pageSomeone"));

  return (
    <MonitorScreen initialFs={sp.fs === "1" && !telemetry}>
      <div
        style={{
          maxWidth: 1160,
          margin: "0 auto",
          padding: "22px 28px 60px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          animation: "oi-rise .18s ease backwards",
        }}
        data-screen-label="Monitor detail"
      >
        <Link
          href="/app/monitors"
          className="oi-hover-link"
          style={{
            fontSize: 12.5,
            color: "var(--ink-3)",
            textDecoration: "none",
            width: "fit-content",
          }}
        >
          ‹ {t("nav.monitors")}
        </Link>

        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 280, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span
                data-testid="monitor-state"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11.5,
                  fontWeight: 600,
                  borderRadius: 999,
                  padding: "3px 9px",
                  background: tone[0],
                  color: tone[1],
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: tone[1] }} />
                {stateLabel}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                {telemetry
                  ? t("monitors.metaLine", { type: t(TYPE_NAME[m.type]!), every })
                  : t("mon2.metaLine", {
                      type: t(TYPE_NAME[m.type] ?? "monitors.typeHttp"),
                      every,
                      where,
                    })}
              </span>
            </div>
            <h1
              style={{
                margin: 0,
                fontFamily: "var(--title)",
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: "-.015em",
              }}
            >
              {m.name}
            </h1>
            {m.target && (
              <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-2)" }}>
                {targetLine(m)}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flex: "none", flexWrap: "wrap" }}>
            {!telemetry && <FullScreenButton label={t("mon2.fullScreen")} />}
            {mayEdit && (
              <form action={togglePause}>
                <input type="hidden" name="id" value={m.id} />
                <button
                  type="submit"
                  className="oi-hover"
                  style={GHOST}
                  data-testid="monitor-pause"
                >
                  {m.paused ? t("monitors.resume") : t("monitors.pause")}
                </button>
              </form>
            )}
            {mayEdit && m.type !== "manual" && m.type !== "incoming" && (
              <form action={checkNow}>
                <input type="hidden" name="id" value={m.id} />
                <button
                  type="submit"
                  className="oi-hover"
                  style={GHOST}
                  data-testid="monitor-check-now"
                >
                  {t("monitors.checkNow")}
                </button>
              </form>
            )}
            <Link
              href="/app/status-pages"
              className="oi-hover-brand-2"
              data-testid="monitor-status-page"
              style={{
                ...GHOST,
                border: 0,
                background: "var(--brand)",
                color: "var(--on-brand)",
              }}
            >
              {t("mon2.showOnStatusPage")}
            </Link>
          </div>
        </div>

        <div
          style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--line)" }}
          role="tablist"
        >
          {TABS.map((k) => (
            <Link
              key={k}
              href={tabHref(k)}
              role="tab"
              aria-selected={tab === k}
              data-testid={`monitor-tab-${k}`}
              scroll={false}
              style={{
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 600,
                color: tab === k ? "var(--brand)" : "var(--ink-3)",
                borderBottom: `2px solid ${tab === k ? "var(--brand)" : "transparent"}`,
                marginBottom: -1,
                textDecoration: "none",
              }}
            >
              {t(`mon2.tab.${k}` as MessageKey)}
            </Link>
          ))}
        </div>

        {(sp.error || sp.queued || (m.journey && !runnerLive)) && (
          <Notice
            tone={sp.error ? "dang" : m.journey && !runnerLive ? "wait" : "sunk"}
            text={
              sp.error
                ? t(
                    (sp.error === "no-runner"
                      ? "synthetic.errorNoRunner"
                      : sp.error === "secret"
                        ? "synthetic.errorSecret"
                        : sp.error === "criteria"
                          ? "monitors.error.invalid"
                          : "synthetic.errorSteps") as MessageKey,
                  )
                : sp.queued
                  ? t("synthetic.runQueued")
                  : t("synthetic.runnerOffline")
            }
          />
        )}

        {tab === "overview" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) 320px",
              gap: 14,
              alignItems: "start",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
              <Kpis
                items={
                  telemetry
                    ? [
                        {
                          l: t("telemetryMonitor.kpiSeries"),
                          v: String(m.series.length),
                          ink: "var(--ink)",
                        },
                        {
                          l: t("telemetryMonitor.kpiBreaching"),
                          v: String(
                            m.series.filter((s) => s.state === "breaching" || s.state === "no_data")
                              .length,
                          ),
                          ink: m.series.some(
                            (s) => s.state === "breaching" || s.state === "no_data",
                          )
                            ? "var(--dang)"
                            : "var(--ok)",
                        },
                        {
                          l: t("telemetryMonitor.kpiLearning"),
                          v: String(m.series.filter((s) => s.state === "learning").length),
                          ink: "var(--ink-3)",
                        },
                        {
                          l: t("telemetryMonitor.kpiEvaluated"),
                          v: m.lastCheckAt ? t.fmt.time(m.lastCheckAt, t.timeZone) : "—",
                          ink: "var(--ink)",
                        },
                      ]
                    : kpis
                }
              />
              {m.paused && m.lastCheckAt && !telemetry && (
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {t("mon2.pausedAnchor", { when: t.fmt.relative(m.lastCheckAt) })}
                </div>
              )}
              {!telemetry && (
                <MonitorCharts
                  range={win.range}
                  from={win.from}
                  to={win.to}
                  zoomed={win.zoomed}
                  live={!m.paused}
                  charts={charts}
                  fsCharts={fsCharts}
                  fs={fs}
                />
              )}
              {m.journey && (
                <JourneyCard
                  monitorId={m.id}
                  journey={m.journey}
                  lastCheck={
                    m.checks[0] ? { id: m.checks[0].id, result: m.checks[0].result } : null
                  }
                />
              )}
              {telemetry && <SeriesCard t={t} m={m} />}
              {!telemetry && (
                <div style={{ ...CARD, padding: 0, gap: 0, overflow: "hidden" }}>
                  <div
                    style={{
                      padding: "12px 16px",
                      borderBottom: "1px solid var(--line)",
                      fontSize: 13.5,
                      fontWeight: 600,
                    }}
                  >
                    {t("monitors.recentChecks")}
                  </div>
                  {data.recent.length === 0 ? (
                    <div style={{ padding: 16, fontSize: 13, color: "var(--ink-2)" }}>
                      {t("monitors.noChecksYet")}
                    </div>
                  ) : (
                    data.recent.map((c) => (
                      <div
                        key={c.id}
                        data-testid="monitor-check"
                        style={{
                          display: "grid",
                          gridTemplateColumns: "60px 90px minmax(0,1fr) 80px 90px",
                          gap: 12,
                          padding: "9px 16px",
                          borderBottom: "1px solid var(--line-2)",
                          fontSize: 12.5,
                          alignItems: "center",
                        }}
                      >
                        <span style={{ fontFamily: "var(--mono)", color: "var(--ink-3)" }}>
                          {t.fmt.time(c.at, t.timeZone)}
                        </span>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            fontWeight: 600,
                            color: checkInk(c.state),
                          }}
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: checkInk(c.state),
                            }}
                          />
                          {t(`monitors.state.${c.state}` as MessageKey)}
                        </span>
                        <span
                          style={{
                            color: "var(--ink-2)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {c.detail}
                        </span>
                        <span style={{ fontFamily: "var(--mono)" }}>
                          {c.latencyMs === null ? "—" : `${t.fmt.number(c.latencyMs)} ms`}
                        </span>
                        <span style={{ color: "var(--ink-3)" }}>{locName(c.loc)}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {telemetry && m.telemetryQuery ? (
                <div style={CARD} data-testid="telemetry-rule">
                  <div style={EYEBROW}>{t("telemetryMonitor.rule")}</div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      lineHeight: 1.5,
                      wordBreak: "break-word",
                    }}
                  >
                    {m.telemetryQuery.query}
                  </div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-2)" }}>
                    {ruleSentence(t, m.type, m.telemetryQuery)}
                  </div>
                  {m.telemetryQuery.groupBy.length > 0 && (
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                      {t("telemetryMonitor.oneAlertPer", {
                        fields: m.telemetryQuery.groupBy.join(", "),
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div style={CARD} data-testid="criteria-card">
                  <div style={EYEBROW}>{t("monitors.criteria")}</div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      fontSize: 12.5,
                      lineHeight: 1.5,
                    }}
                  >
                    {m.criteria.length === 0 && (
                      <div style={{ color: "var(--ink-3)" }}>{t("monitors.noCriteria")}</div>
                    )}
                    {m.criteria.map((c, i) => (
                      <CriterionLine key={i} t={t} c={c} />
                    ))}
                    {m.criteria.some((c) => c.then !== "online") && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "var(--ok)",
                            marginTop: 7,
                            flex: "none",
                          }}
                        />
                        <span>{t("mon2.c.resolves")}</span>
                      </div>
                    )}
                  </div>
                  {mayEdit && (
                    <Link
                      href={tabHref("criteria")}
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--brand)",
                        textDecoration: "none",
                      }}
                    >
                      {t("mon2.editCriteria")}
                    </Link>
                  )}
                </div>
              )}
              <div style={{ ...CARD, gap: 6 }}>
                <div style={EYEBROW}>{t("monitors.whenOffline")}</div>
                <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                  <strong>{t("monitors.page")}:</strong> {pageLabel} ·{" "}
                  <strong>{t("monitors.incident")}:</strong>{" "}
                  {t(`monitors.incidentFrom.${choices.choices.incident}` as MessageKey)} ·{" "}
                  <strong>{t("monitors.autoResolve")}:</strong>{" "}
                  {choices.choices.autoResolve ? t("common.on") : t("common.off")}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                  {choices.own ? t("monitors.choicesRule") : t("mon2.sameChoices")}
                </div>
              </div>
              <div style={{ ...CARD, gap: 6 }} data-testid="monitor-shown-on">
                <div style={EYEBROW}>{t("mon2.shownOn")}</div>
                {data.pages.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                    {t("mon2.shownOnNone")}
                  </div>
                ) : (
                  data.pages.map((p, i) => (
                    <div key={i} style={{ fontSize: 12.5 }}>
                      {(() => {
                        const [before, after] = t.parts("mon2.shownOnLine", "component", {
                          page: p.page,
                          uptime: m.uptime90 === null ? "—" : `${+m.uptime90.toFixed(2)} %`,
                        });
                        return (
                          <>
                            {before}
                            <strong>{p.component}</strong>
                            {after}
                          </>
                        );
                      })()}
                    </div>
                  ))
                )}
              </div>
              <div style={{ ...CARD, gap: 6 }} data-testid="monitor-incidents">
                <div style={EYEBROW}>{t("mon2.incidents90")}</div>
                {data.incidents.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                    {t("mon2.incidentsNone")}
                  </div>
                ) : (
                  data.incidents.map((i) => (
                    <div key={i.id} style={{ fontSize: 12.5 }}>
                      <Link
                        href={`/app/incidents/${i.number}`}
                        style={{
                          fontFamily: "var(--mono)",
                          color: "var(--brand)",
                          fontWeight: 600,
                          textDecoration: "none",
                        }}
                      >
                        INC-{i.number}
                      </Link>{" "}
                      {i.name}
                      {i.severity ? ` · ${i.severity}` : ""} · {fmtDate(i.declaredAt)}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "slo" && (
          <div
            data-screen-label="Monitor — SLO (empty)"
            style={{
              maxWidth: 640,
              background: "var(--panel)",
              border: "1px dashed var(--line)",
              borderRadius: "var(--radius-card)",
              padding: 28,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "flex-start",
            }}
          >
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t("mon2.sloEmptyTitle")}</div>
            <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
              {t("mon2.sloEmptyBody")}
            </div>
            <Link
              href={`/app/telemetry?tab=slos&new=1${m.serviceKey ? `&service=${encodeURIComponent(m.serviceKey)}` : ""}`}
              className="oi-hover-brand-2"
              data-testid="monitor-define-slo"
              style={{ ...GHOST, border: 0, background: "var(--brand)", color: "var(--on-brand)" }}
            >
              {t("mon2.defineSlo")}
            </Link>
          </div>
        )}

        {tab === "criteria" && (
          <div style={{ ...CARD, maxWidth: 820, gap: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{t("mon2.criteriaTitle")}</div>
            {telemetry && m.telemetryQuery ? (
              <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                <div style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                  {m.telemetryQuery.query}
                </div>
                <div style={{ color: "var(--ink-2)" }}>
                  {ruleSentence(t, m.type, m.telemetryQuery)}
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                  {t("mon2.criteriaIntro")}
                </div>
                {mayEdit ? (
                  <CriteriaEditor t={t} monitorId={m.id} criteria={m.criteria} />
                ) : (
                  m.criteria.map((c, i) => <CriterionLine key={i} t={t} c={c} />)
                )}
                {sp.saved === "criteria" && (
                  <div style={{ fontSize: 12, color: "var(--ok)", fontWeight: 600 }}>
                    {t("common.saved")}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === "advanced" && <AdvancedTab monitor={m} mayEdit={mayEdit} saved={sp.saved} />}
      </div>
    </MonitorScreen>
  );
}

function targetLine(m: { type: string; target: string; config: Record<string, unknown> }): string {
  if (m.type === "http" || m.type === "api") {
    return `${String(m.config.method ?? "GET").toUpperCase()} ${m.target}`;
  }
  return m.target;
}

function Kpis({ items }: { items: Array<{ l: string; v: string; ink: string }> }) {
  return (
    <div
      data-testid="monitor-kpis"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4,1fr)",
        gap: 1,
        background: "var(--line)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {items.map((k) => (
        <div key={k.l} style={{ background: "var(--panel)", padding: "11px 14px" }}>
          <div style={{ ...EYEBROW, fontSize: 10 }}>{k.l}</div>
          <div
            style={{
              fontFamily: "var(--title)",
              fontSize: 20,
              fontWeight: 600,
              marginTop: 2,
              color: k.ink,
            }}
          >
            {k.v}
          </div>
        </div>
      ))}
    </div>
  );
}

function Notice({ tone, text }: { tone: "dang" | "wait" | "sunk"; text: string }) {
  return (
    <div
      role={tone === "dang" ? "alert" : undefined}
      style={{
        border: `1px solid ${tone === "sunk" ? "var(--line)" : `var(--${tone})`}`,
        background: tone === "sunk" ? "var(--sunk)" : `var(--${tone}-t)`,
        borderRadius: 12,
        padding: "11px 14px",
        fontSize: 12.5,
        lineHeight: 1.5,
      }}
    >
      {text}
    </div>
  );
}

function CriterionInline({
  t,
  c,
}: {
  t: Parameters<typeof CriterionLine>[0]["t"];
  c: Parameters<typeof CriterionLine>[0]["c"];
}) {
  const ink =
    c.then === "offline" ? "var(--dang)" : c.then === "degraded" ? "var(--wait)" : "var(--ok)";
  return (
    <>
      {criterionText(t, c)} →{" "}
      <strong style={{ color: ink }}>{t(`monitors.state.${c.then}` as MessageKey)}</strong>
    </>
  );
}

/**
 * A telemetry monitor's series, which is its real state: one row per alert it
 * could raise, with what it last measured and why.
 */
function SeriesCard({
  t,
  m,
}: {
  t: Awaited<ReturnType<typeof getT>>;
  m: NonNullable<Awaited<ReturnType<typeof getMonitor>>>;
}) {
  return (
    <div style={{ ...CARD, padding: 0, gap: 0 }} data-testid="telemetry-series">
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--line)",
          fontSize: 13.5,
          fontWeight: 600,
        }}
      >
        {t("telemetryMonitor.series")}
      </div>
      {m.series.length === 0 ? (
        <div style={{ padding: "14px 16px", fontSize: 12.5, color: "var(--ink-3)" }}>
          {m.lastCheckAt
            ? t("telemetryMonitor.noSeriesYet")
            : t("telemetryMonitor.notEvaluatedYet")}
        </div>
      ) : (
        m.series.map((row) => {
          const held =
            (row.lastVerdict === "breaching" || row.lastVerdict === "no_data") &&
            row.state !== row.lastVerdict;
          const ink = held
            ? "var(--wait)"
            : row.state === "breaching" || row.state === "no_data"
              ? "var(--dang)"
              : row.state === "learning"
                ? "var(--ink-3)"
                : "var(--ok)";
          return (
            <div
              key={row.seriesKey}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) 110px minmax(0,1fr)",
                gap: 10,
                alignItems: "baseline",
                padding: "10px 16px",
                borderTop: "1px solid var(--line)",
                fontSize: 12.5,
              }}
            >
              <span style={{ fontFamily: "var(--mono)", wordBreak: "break-word" }}>
                {row.seriesKey === "*" ? t("telemetryMonitor.wholeMonitor") : row.seriesKey}
              </span>
              <span style={{ color: ink, fontWeight: 600 }}>
                {held
                  ? t("telemetryMonitor.holding", {
                      n: row.consecutive,
                      of: m.telemetryQuery?.forEvaluations ?? 1,
                    })
                  : t(`telemetryMonitor.state.${row.state}` as MessageKey)}
              </span>
              <span style={{ color: "var(--ink-2)", wordBreak: "break-word" }}>
                {row.lastDetail ?? "—"}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

/** The run of checks just before the current state began: its state and length. */
function sqlPrevRun(tenantId: string, monitorId: string, since: Date) {
  return sql`
    with before as (
      select state, at from app.monitor_checks
       where tenant_id = ${tenantId} and monitor_id = ${monitorId}
         and at < ${since.toISOString()}::timestamptz
         and at > ${since.toISOString()}::timestamptz - interval '1 day'
       order by at desc
       limit 1440
    ), firstState as (select state from before limit 1),
    run as (
      select b.state, row_number() over (order by b.at desc) as rn,
             sum(case when b.state = (select state from firstState) then 0 else 1 end)
               over (order by b.at desc rows unbounded preceding) as breaks
        from before b
    )
    select (select state from firstState)::text as state,
           (count(*) filter (where breaks = 0))::int as n
      from run`;
}
