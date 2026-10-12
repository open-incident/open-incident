import Link from "next/link";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { incidents, services, telemetrySettings, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { canRespond, isManager, requireMember } from "@/lib/session";
import { requireTenant } from "@/lib/tenant";
import { otlpEndpoints } from "@/lib/telemetry-module";
import {
  listKeys,
  logPatterns,
  logs,
  recentRejections,
  telemetryInstalled,
  trace,
  traces,
  usageToday,
  logShape,
  traceShape,
  traceBands,
  SCATTER_MAX_MINUTES,
  latestSignal,
} from "@/lib/telemetry";
import { packsReporting, type PackId } from "@openincident/telemetry";
import { packDashboardSlugs } from "@openincident/oncall";
import { createIngestionKey, installPackDashboard, revokeIngestionKey } from "./actions";
import { NotInstalled } from "./not-installed";
import { ExceptionsTab } from "./exceptions-tab";
import { MetricsTab } from "./metrics-tab";
import { MapTab } from "./map-tab";
import { SqlTab } from "./sql-tab";
import { ProfilesTab } from "./profiles-tab";
import { FilterError, QueryBar } from "./query-bar";
import { RumTab } from "./rum-tab";
import { SlosTab } from "./slos-tab";
import { DashboardsTab } from "./dashboards-tab";
import { FacetRail } from "./facet-rail";
import { EmptyWindow, FieldRow, ResultsPanel, termFor, withTerm } from "./explorer-parts";
import { LogHistogram } from "./log-histogram";
import { LatencyScatter } from "./latency-scatter";
import { LatencyBands } from "./latency-bands";
import { ServicesTab, serviceWindowOf } from "./services-tab";
import { Waterfall } from "./waterfall";
import { SERVICE_COLOURS } from "./trace-model";

/**
 * Telemetry — logs, traces, and the four lines that start them arriving.
 *
 * Until the module is installed this screen says so and says how, rather than
 * drawing empty charts: an instance without a ClickHouse cannot show a span,
 * and pretending it can is the one thing the product refuses to do. Once it is
 * installed, an empty list is a different sentence — nothing has arrived yet —
 * and the screen says that instead.
 */

/**
 * Five questions, not eleven signals.
 *
 * The screen used to be one tab per signal — logs, traces, metrics,
 * exceptions, profiles, real users, SQL — plus services, the map, objectives
 * and the setup: eleven, in a row, each with its own time control and its own
 * filter box. Nobody arrives asking "I would like some metrics". They arrive
 * asking which service is unhealthy, or what happened in the last ten minutes,
 * and the signal is the tool they reach for once they are inside that
 * question.
 *
 * So: what is the state of things, look for something, what I have pinned,
 * what I promised, and how it is plugged in.
 */
const TABS = ["overview", "explore", "dashboards", "slos", "setup"] as const;
type Tab = (typeof TABS)[number];

/**
 * What the Explorer can look at — and the whole point is that the window and
 * the filter do not change when this does.
 *
 * Finding a failing trace and then reading that service's logs for the same
 * ten minutes is one motion, not a retyped filter and a re-picked range.
 */
const SIGNALS = ["logs", "traces", "metrics", "exceptions", "profiles", "rum", "sql"] as const;
type Signal = (typeof SIGNALS)[number];

/**
 * Where the eleven old tabs went.
 *
 * `?tab=logs` is in runbooks, in bookmarks, in alert bodies the product has
 * already sent, and in every screenshot anybody has taken of it. Each one
 * still lands where its content now lives.
 */
const MOVED: Record<string, { tab: Tab; signal?: Signal }> = {
  services: { tab: "overview" },
  map: { tab: "overview" },
  logs: { tab: "explore", signal: "logs" },
  traces: { tab: "explore", signal: "traces" },
  metrics: { tab: "explore", signal: "metrics" },
  exceptions: { tab: "explore", signal: "exceptions" },
  profiles: { tab: "explore", signal: "profiles" },
  rum: { tab: "explore", signal: "rum" },
  sql: { tab: "explore", signal: "sql" },
  connect: { tab: "setup" },
};

/**
 * The window, once, for every signal that has one.
 *
 * Minutes rather than a label, because that is what the queries take — and the
 * queries take one because without it a trace list reads every trace the
 * workspace has ever kept (sql/0011_trace_window.sql has the measurements).
 */
const RANGES = { "15m": 15, "1h": 60, "6h": 360, "24h": 1440, "7d": 10080 } as const;
type RangeKey = keyof typeof RANGES;
const DEFAULT_RANGE: RangeKey = "1h";

function rangeOf(value: string | undefined): RangeKey {
  return value && value in RANGES ? (value as RangeKey) : DEFAULT_RANGE;
}

function windowFor(range: RangeKey): { from: Date; to: Date; minutes: number } {
  const minutes = RANGES[range];
  const to = new Date();
  return { from: new Date(to.getTime() - minutes * 60_000), to, minutes };
}

/**
 * The window a reader zoomed into, from the histogram or the scatter.
 *
 * Two epoch milliseconds in the address rather than a named range, because
 * "the four minutes where it broke" has no name — and because a window in the
 * URL is a window somebody can send to a colleague.
 */
function customWindow(
  from: string | undefined,
  to: string | undefined,
): { from: Date; to: Date; minutes: number } | null {
  const a = Number(from);
  const b = Number(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  // A sane floor: a window of nothing is a screen of nothing, and a bar click
  // on a very wide range can land on a bucket a few seconds long.
  const span = Math.max(60_000, b - a);
  return { from: new Date(a), to: new Date(a + span), minutes: Math.round(span / 60_000) };
}

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};

const MONO: React.CSSProperties = { fontFamily: "var(--mono)", fontSize: 12 };

/** OTLP severity numbers, grouped the way the specification groups them. */
function severityTone(n: number): { label: string; color: string; bg: string } {
  if (n >= 21) return { label: "FATAL", color: "var(--dang)", bg: "var(--dang-t)" };
  if (n >= 17) return { label: "ERROR", color: "var(--dang)", bg: "var(--dang-t)" };
  if (n >= 13) return { label: "WARN", color: "var(--wait)", bg: "var(--wait-t)" };
  if (n >= 9) return { label: "INFO", color: "var(--ink-2)", bg: "var(--sunk)" };
  return { label: "DEBUG", color: "var(--ink-3)", bg: "var(--sunk)" };
}

/** The window the map was asked for, from a list rather than from the caller. */
function windowOf(raw: string | undefined): number {
  const n = Number(raw);
  return [60, 360, 1440].includes(n) ? n : 60;
}

/** The profile window, from the list the screen offers rather than the caller. */
function profileWindowOf(raw: string | undefined): number {
  const n = Number(raw);
  return [15, 60, 360, 1440].includes(n) ? n : 60;
}

/** The RUM view and window, from the lists the screen offers. */
function rumViewOf(raw: string | undefined): "overview" | "sessions" | "errors" {
  return raw === "sessions" || raw === "errors" ? raw : "overview";
}

function rumWindowOf(raw: string | undefined): number {
  const n = Number(raw);
  return [1, 24, 168].includes(n) ? n : 24;
}

function ms(ns: string): string {
  const n = Number(ns);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n < 1_000_000 ? `${Math.round(n / 1000)} µs` : `${(n / 1_000_000).toFixed(1)} ms`;
}

export default async function TelemetryPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    trace?: string;
    metric?: string;
    fp?: string;
    service?: string;
    issued?: string;
    since?: string;
    q?: string;
    session?: string;
    patterns?: string;
    type?: string;
    compare?: string;
    view?: string;
    /** Objectives moved in from /app/slos, which now redirects here. */
    error?: string;
    why?: string;
    new?: string;

    attached?: string;
    /** The Explorer's signal, and the window every signal shares. */
    signal?: string;
    range?: string;
    /** A page cursor from a list's "older" link. */
    before?: string;
    /** An explicit window, from a click on the histogram or the scatter. */
    from?: string;
    to?: string;
    /** The metric chart's split and reduction. */
    group?: string;
    agg?: string;
  }>;
}) {
  const { member } = await requireMember();
  const tenant = await requireTenant();
  const t = await getT();
  const sp = await searchParams;
  const admin = isManager(member);

  if (!telemetryInstalled()) {
    return <NotInstalled admin={admin} endpoint={otlpEndpoints(hostOf(tenant)).grpc} />;
  }

  /*
   * The tab, the signal and the window, in that order.
   *
   * An old address names a signal where a group is expected — `?tab=logs` —
   * and is read as the group that now holds it rather than redirected: a
   * redirect would lose the rest of the query, which is usually the filter
   * somebody was in the middle of.
   */
  const asked = sp.tab ?? "";
  const moved = MOVED[asked];
  const tab: Tab = (TABS as readonly string[]).includes(asked)
    ? (asked as Tab)
    : (moved?.tab ?? "overview");
  const signal: Signal = (SIGNALS as readonly string[]).includes(sp.signal ?? "")
    ? (sp.signal as Signal)
    : (moved?.signal ?? "traces");
  const range = rangeOf(sp.range ?? sp.since);
  const zoomed = customWindow(sp.from, sp.to);
  const win = zoomed ?? windowFor(range);
  const endpoints = otlpEndpoints(hostOf(tenant));

  /**
   * The window a bar, or a half of the scatter, covers.
   *
   * A click on a picture is the fastest way anybody has narrowed a search, and
   * it costs two numbers in the address — which also makes it shareable.
   */
  const zoom = (a: Date, b: Date) =>
    link({ from: String(a.getTime()), to: String(b.getTime()), before: undefined });

  /** Every link out of the controls keeps everything else. */
  const link = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const base: Record<string, string | undefined> = {
      tab,
      signal: tab === "explore" ? signal : undefined,
      range: range === DEFAULT_RANGE ? undefined : range,
      // A zoom outlives a click on anything but the range chips, which clear it.
      from: zoomed ? String(zoomed.from.getTime()) : undefined,
      to: zoomed ? String(zoomed.to.getTime()) : undefined,
      service: sp.service,
      q: sp.q,
      metric: sp.metric,
      group: sp.group,
      agg: sp.agg,
    };
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) q.set(k, v);
    return `/app/telemetry?${q.toString()}`;
  };

  /*
   * One row of navigation, one window.
   *
   * The screen used to nest two rows of tabs — a group, then a signal inside
   * it — and to give the services and the map their own window chips on top of
   * the explorer's. It reads like Datadog's top bar now: every view one click
   * away on one row, the window once at the right, and it holds for every view
   * that has a time axis.
   */
  const NAV: Array<{ key: string; label: string; tab: Tab; signal?: Signal; gap?: boolean }> = [
    { key: "services", label: t("telemetry.nav.services"), tab: "overview" },
    ...(["logs", "traces", "metrics", "exceptions", "profiles", "rum", "sql"] as const).map(
      (x) => ({
        key: x,
        label: t(`telemetry.tab.${x}`),
        tab: "explore" as Tab,
        signal: x as Signal,
      }),
    ),
    { key: "dashboards", label: t("telemetry.tab.dashboards"), tab: "dashboards", gap: true },
    { key: "slos", label: t("telemetry.tab.slos"), tab: "slos" },
    { key: "setup", label: t("telemetry.tab.setup"), tab: "setup" },
  ];
  const isActive = (n: (typeof NAV)[number]) =>
    n.tab === tab && (n.tab !== "explore" || n.signal === signal);
  const hasWindow = tab === "overview" || (tab === "explore" && signal !== "sql");
  const serviceChip = Boolean(sp.service) && tab !== "setup";
  // Explorers want every pixel of width, as in Datadog and Sumo Logic; the
  // other views read better at a measure.
  const wide = tab === "explore" && signal !== "sql";

  return (
    <div
      style={{
        maxWidth: wide ? "none" : 1240,
        margin: "0 auto",
        padding: "16px 24px 60px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          flexWrap: "wrap",
          borderBottom: "1px solid var(--line)",
          paddingBottom: 0,
        }}
      >
        <h1
          style={{
            margin: "0 0 10px",
            fontFamily: "var(--title)",
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: "-.015em",
          }}
        >
          {t("nav.telemetry")}
        </h1>
        <nav
          aria-label={t("nav.telemetry")}
          style={{ display: "flex", alignItems: "flex-end", gap: 2, flexWrap: "wrap", flex: 1 }}
        >
          {NAV.map((n) => {
            const on = isActive(n);
            return (
              <Link
                key={n.key}
                data-testid={n.signal ? `telemetry-signal-${n.signal}` : `telemetry-tab-${n.tab}`}
                aria-current={on ? "page" : undefined}
                href={link({
                  tab: n.tab,
                  signal: n.signal,
                  before: undefined,
                  trace: undefined,
                  patterns: undefined,
                })}
                className={on ? undefined : "oi-hover"}
                style={{
                  marginLeft: n.gap ? 14 : 0,
                  padding: "8px 11px 9px",
                  borderRadius: "8px 8px 0 0",
                  fontSize: 13,
                  fontWeight: on ? 600 : 500,
                  color: on ? "var(--brand)" : "var(--ink-2)",
                  borderBottom: `2px solid ${on ? "var(--brand)" : "transparent"}`,
                  marginBottom: -1,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {(hasWindow || serviceChip) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            marginTop: 12,
          }}
        >
          {/*
            A filtered view that does not say it is filtered is a view somebody
            will read as "there is nothing else". The chip says which service,
            and removing it is one click.
          */}
          {serviceChip && (
            <Link
              href={link({ service: undefined, before: undefined })}
              data-testid="telemetry-service-filter"
              title={t("telemetry.clearService")}
              aria-label={t("telemetry.clearService")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 28,
                padding: "0 10px",
                borderRadius: 8,
                border: "1px solid var(--brand-b)",
                background: "var(--brand-t)",
                fontSize: 12,
                color: "var(--brand)",
                textDecoration: "none",
              }}
            >
              <span style={{ color: "var(--ink-3)" }}>service</span>
              <span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{sp.service}</span>
              <span aria-hidden>✕</span>
            </Link>
          )}
          <span style={{ flex: 1 }} />
          {/*
            A zoom is shown as a chip of its own, with the way out: a reader
            who clicked a bar must be able to see that the window is no longer
            the one the presets describe.
          */}
          {hasWindow && zoomed && (
            <Link
              href={link({ from: undefined, to: undefined, before: undefined })}
              data-testid="telemetry-zoom"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 28,
                padding: "0 10px",
                borderRadius: 8,
                border: "1px solid var(--brand-b)",
                background: "var(--brand-t)",
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                color: "var(--brand)",
                textDecoration: "none",
              }}
            >
              {t.fmt.dateTime(zoomed.from)} → {zoomed.to.toISOString().slice(11, 16)}
              <span aria-hidden>✕</span>
            </Link>
          )}
          {hasWindow && (
            <div
              role="group"
              aria-label={t("telemetry.window")}
              style={{
                display: "inline-flex",
                border: "1px solid var(--line)",
                borderRadius: 9,
                background: "var(--panel)",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "0 10px",
                  fontSize: 11.5,
                  color: "var(--ink-3)",
                  borderRight: "1px solid var(--line)",
                }}
              >
                {t("telemetry.window")}
              </span>
              {(Object.keys(RANGES) as RangeKey[]).map((k, i) => {
                const on = !zoomed && range === k;
                return (
                  <Link
                    key={k}
                    data-testid={`telemetry-range-${k}`}
                    href={link({ range: k, from: undefined, to: undefined, before: undefined })}
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                      fontWeight: 600,
                      padding: "6px 10px",
                      textDecoration: "none",
                      color: on ? "var(--on-brand)" : "var(--ink-2)",
                      background: on ? "var(--brand)" : "transparent",
                      borderLeft: i ? "1px solid var(--line-2)" : "none",
                    }}
                  >
                    {k}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        {tab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <ServicesTab
              tenantId={tenant.id}
              sinceMinutes={serviceWindowOf(String(win.minutes))}
              windowLinks={false}
            />
            <MapTab
              tenantId={tenant.id}
              sinceMinutes={windowOf(String(win.minutes))}
              highlight={sp.service}
              windowLinks={false}
            />
          </div>
        )}

        {/*
          The three signals that are searches get a facet rail. Metrics have
          PromQL, profiles have a flamegraph, SQL is its own thing, and RUM is
          a small fixed set of screens — none of them is a haystack somebody
          arrives at without knowing the field names.
        */}
        {tab === "explore" &&
          (signal === "logs" || signal === "traces" || signal === "exceptions") &&
          (() => {
            const rail = (
              <FacetRail
                kind={signal}
                tenantId={tenant.id}
                from={win.from}
                to={win.to}
                filter={sp.q}
                service={sp.service}
                link={link}
              />
            );
            if (signal === "logs")
              return (
                <LogsTab
                  tenantId={tenant.id}
                  service={sp.service}
                  filter={sp.q}
                  mayEdit={canRespond(member)}
                  patterns={sp.patterns === "1"}
                  from={win.from}
                  to={win.to}
                  before={sp.before}
                  link={link}
                  zoom={zoom}
                  rail={rail}
                />
              );
            if (signal === "traces")
              return (
                <TracesTab
                  tenantId={tenant.id}
                  open={sp.trace}
                  service={sp.service}
                  filter={sp.q}
                  mayEdit={canRespond(member)}
                  attached={sp.attached}
                  from={win.from}
                  to={win.to}
                  before={sp.before}
                  link={link}
                  zoom={zoom}
                  rail={rail}
                />
              );
            return (
              <div style={{ display: "grid", gridTemplateColumns: "250px minmax(0,1fr)", gap: 14 }}>
                {rail}
                <div style={{ minWidth: 0 }}>
                  <ExceptionsTab
                    tenantId={tenant.id}
                    open={sp.fp}
                    mayEdit={canRespond(member)}
                    service={sp.service}
                    filter={sp.q}
                  />
                </div>
              </div>
            );
          })()}
        {tab === "explore" && signal === "metrics" && (
          <MetricsTab
            tenantId={tenant.id}
            open={sp.metric}
            from={win.from}
            to={win.to}
            groupBy={sp.group}
            agg={sp.agg === "sum" || sp.agg === "max" ? sp.agg : "avg"}
            link={link}
          />
        )}
        {tab === "explore" && signal === "profiles" && (
          <ProfilesTab
            tenantId={tenant.id}
            service={sp.service}
            type={sp.type}
            sinceMinutes={profileWindowOf(String(win.minutes))}
            compare={sp.compare === "1"}
          />
        )}
        {tab === "explore" && signal === "rum" && (
          <RumTab
            tenantId={tenant.id}
            view={rumViewOf(sp.view)}
            sinceHours={rumWindowOf(String(Math.max(1, Math.round(win.minutes / 60))))}
            session={sp.session}
          />
        )}
        {tab === "explore" && signal === "sql" && <SqlTab tenantId={tenant.id} query={sp.q} />}

        {tab === "dashboards" && (
          <DashboardsTab tenantId={tenant.id} admin={admin} error={sp.error} />
        )}
        {tab === "slos" && (
          <SlosTab
            tenantId={tenant.id}
            mayEdit={canRespond(member)}
            error={sp.error}
            why={sp.why}
            openNew={!!sp.new}
          />
        )}
        {tab === "setup" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex" }}>
              <Usage tenantId={tenant.id} label={t("telemetry.todayRows")} />
            </div>
            <ConnectTab
              tenantId={tenant.id}
              admin={admin}
              issued={sp.issued}
              http={endpoints.http}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function hostOf(tenant: { slug: string; customDomain: string | null }): string {
  return tenant.customDomain ?? `${tenant.slug}.${process.env.BASE_DOMAIN ?? "example"}`;
}

/**
 * The day's volume, and — when there is one — the fact that it is being
 * thinned.
 *
 * The share is stated rather than implied. A workspace over its cap otherwise
 * reads a smaller number than yesterday's and concludes its traffic fell,
 * which is the silent cut the cap is written not to be.
 */
async function Usage({ tenantId, label }: { tenantId: string; label: string }) {
  const t = await getT();
  const { rows, dropped, capGb } = await usageToday(tenantId);
  if (rows + dropped === 0) return null;
  const share = Math.round((dropped / (rows + dropped)) * 100);
  return (
    <span style={{ fontSize: 12, color: "var(--ink-3)", display: "flex", gap: 8 }}>
      <span>
        {label}: <strong style={{ color: "var(--ink-2)" }}>{rows.toLocaleString("en-US")}</strong>
      </span>
      {dropped > 0 && (
        <span
          data-testid="telemetry-sampling"
          title={t("telemetry.sampledWhy", {
            dropped: dropped.toLocaleString("en-US"),
            cap: capGb ?? "—",
          })}
          style={{
            padding: "1px 7px",
            borderRadius: 999,
            background: "var(--wait-t)",
            border: "1px solid var(--wait)",
            color: "var(--wait)",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {t("telemetry.sampled", { share })}
        </span>
      )}
    </span>
  );
}

/**
 * The services a trace went through, as a strip of colour.
 *
 * Read before opening anything: "this one crossed four services and that one
 * stayed in the front end" is the difference between the trace worth reading
 * and the other eleven. Colour is assigned per row in the order the services
 * come back, which is stable within a trace and deliberately not shared with
 * the waterfall below — a strip of four squares is a shape, not a legend, and
 * pretending it maps to the detail panel would be a promise it cannot keep
 * across rows.
 */
function TraceServices({ services }: { services: string[] }) {
  const shown = services.slice(0, 6);
  return (
    <span style={{ display: "flex", gap: 3, alignItems: "center" }} title={services.join(" · ")}>
      {shown.map((name, i) => (
        <span
          key={name}
          style={{
            width: 9,
            height: 9,
            borderRadius: 2,
            background: SERVICE_COLOURS[i % SERVICE_COLOURS.length],
          }}
        />
      ))}
      {services.length > shown.length && (
        <span style={{ fontSize: 10, color: "var(--ink-3)" }}>
          +{services.length - shown.length}
        </span>
      )}
    </span>
  );
}

async function LogsTab({
  tenantId,
  service,
  filter,
  mayEdit,
  patterns,
  from,
  to,
  before,
  link,
  zoom,
  rail,
}: {
  tenantId: string;
  service?: string;
  filter?: string;
  mayEdit: boolean;
  /** The same stream, folded into the shapes of line it contains. */
  patterns?: boolean;
  from: Date;
  to: Date;
  before?: string;
  link: (over: Record<string, string | undefined>) => string;
  zoom: (from: Date, to: Date) => string;
  /** The field browser, beside the results. */
  rail: React.ReactNode;
}) {
  const t = await getT();
  // The filter is compiled here rather than validated first: the compiler is
  // the only thing that knows what is valid, and running it twice to ask the
  // same question would be two places for the answer to differ.
  let page: Awaited<ReturnType<typeof logs>> = { rows: [], older: null };
  let shapes: Awaited<ReturnType<typeof logPatterns>> = [];
  let shape: Awaited<ReturnType<typeof logShape>> | null = null;
  let error: string | null = null;
  try {
    // The picture and the rows are one question asked twice; asked together so
    // a spike and the lines under it arrive in the same render.
    shape = await logShape(tenantId, { from, to, filter, service });
    if (patterns)
      shapes = await logPatterns(tenantId, {
        sinceHours: Math.max(1, Math.round((to.getTime() - from.getTime()) / 3_600_000)),
        service,
        filter,
      });
    else
      page = await logs(tenantId, {
        from,
        to,
        limit: 200,
        ...(service ? { service } : {}),
        filter,
        before,
      });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const rows = page.rows;
  const total = shape ? shape.totals.error + shape.totals.warn + shape.totals.info : 0;
  const modeHref = (on: boolean) => link({ patterns: on ? "1" : undefined, before: undefined });
  /*
   * One severity term at a time.
   *
   * Clicking ERROR after WARN must mean "errors", not "errors and warnings",
   * which is what appending would produce — and an expression nobody can undo
   * is an expression people retype from scratch.
   */
  const withSeverity = (band: "error" | "warn" | null) => {
    const rest = (filter ?? "")
      .split(/\s+AND\s+/i)
      .filter((term) => term.trim() && !/^severity_number\s/i.test(term.trim()))
      .join(" AND ");
    const term =
      band === "error"
        ? "severity_number >= 17"
        : band === "warn"
          ? "severity_number >= 13 AND severity_number < 17"
          : "";
    const next = [rest, term].filter(Boolean).join(" AND ");
    return link({ q: next || undefined, before: undefined });
  };
  /** A field's two gestures: keep only this value, or exclude it. */
  const gestures = (field: string, value: string) => {
    const term = termFor(field, value);
    return term
      ? {
          keep: link({ q: withTerm(filter, term), before: undefined, patterns: undefined }),
          exclude: link({
            q: withTerm(filter, term, true),
            before: undefined,
            patterns: undefined,
          }),
          keepLabel: t("explorer.keep", { term }),
          excludeLabel: t("explorer.exclude", { term }),
        }
      : { keep: null, exclude: null };
  };

  // Where the data is, when the window holds none of it.
  const latest =
    !error && !filter?.trim() && (patterns ? shapes.length === 0 : rows.length === 0)
      ? await latestSignal(tenantId, "logs")
      : null;
  const empty = (
    <EmptyWindow
      message={t(
        filter ? "explorer.noMatch" : latest ? "explorer.emptyWindow" : "telemetry.noLogs",
      )}
      latest={latest ? t.fmt.dateTime(latest) : null}
      latestLabel={t("explorer.latestData")}
      showLatest={
        latest && (latest < from || latest > to)
          ? zoom(new Date(latest.getTime() - 3_600_000), new Date(latest.getTime() + 60_000))
          : null
      }
      showLatestLabel={t("explorer.showLatest")}
    />
  );

  /*
   * A pattern's longest literal run, for the click-through.
   *
   * The pattern itself has holes in it, so it cannot be matched exactly. The
   * longest stretch between two placeholders can be, and for `user <n>
   * checkout failed` that is "checkout failed" — which narrows the stream to
   * the lines this row folded and nothing else worth mentioning. Below four
   * characters it would match half the stream, so the row stays a link back to
   * the unfiltered view rather than a filter that pretends.
   */
  const literalOf = (pattern: string): string | null => {
    const runs = pattern.split(/<(?:n|url|uuid|hex|path)>/).map((r) => r.trim());
    const longest = runs.sort((a, b) => b.length - a.length)[0] ?? "";
    // An apostrophe would end the quoted value the filter language builds.
    return longest.length >= 4 && !longest.includes("'") ? longest : null;
  };

  const head = { padding: "7px 14px", fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em" };
  const results = (
    <ResultsPanel
      testId="log-results"
      tabs={[
        {
          label: t("logs.messages"),
          count: shape ? t.fmt.number(Number(total)) : undefined,
          href: modeHref(false),
          on: !patterns,
          testId: "logs-stream",
        },
        {
          label: t("logs.patterns"),
          href: modeHref(true),
          on: !!patterns,
          testId: "logs-patterns",
        },
      ]}
      right={
        !patterns && rows.length > 0 ? (
          <>
            <span>{t("telemetry.logsFoot", { count: rows.length })}</span>
            {/* A cursor, not an offset: see recentLogs. */}
            {page.older && (
              <Link
                href={link({ before: page.older })}
                data-testid="logs-older"
                className="oi-link"
                style={{ fontWeight: 600 }}
              >
                {t("telemetry.older")}
              </Link>
            )}
          </>
        ) : null
      }
    >
      {error ? (
        <div style={{ padding: 14 }}>
          <FilterError message={error} />
        </div>
      ) : patterns ? (
        shapes.length === 0 ? (
          empty
        ) : (
          <div data-testid="log-patterns">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "64px 76px minmax(0,1fr) 160px",
                gap: 12,
                ...head,
                color: "var(--ink-3)",
                background: "var(--sunk)",
                textTransform: "uppercase",
              }}
            >
              <span>{t("logs.col.level")}</span>
              <span style={{ textAlign: "right" }}>{t("logs.col.count")}</span>
              <span>{t("logs.col.pattern")}</span>
              <span style={{ textAlign: "right" }}>{t("logs.col.service")}</span>
            </div>
            {shapes.map((p, i) => {
              const tone = severityTone(p.severity);
              const literal = literalOf(p.pattern);
              return (
                <Link
                  key={i}
                  href={
                    literal
                      ? link({
                          q: `body contains '${literal}'`,
                          patterns: undefined,
                          before: undefined,
                        })
                      : modeHref(false)
                  }
                  className="oi-hover"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "64px 76px minmax(0,1fr) 160px",
                    gap: 12,
                    padding: "8px 14px",
                    borderTop: "1px solid var(--line-2)",
                    alignItems: "baseline",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: tone.color,
                      background: tone.bg,
                      borderRadius: 5,
                      padding: "1px 5px",
                      textAlign: "center",
                    }}
                  >
                    {tone.label}
                  </span>
                  <span style={{ ...MONO, textAlign: "right", fontWeight: 600 }}>
                    {t.fmt.number(Number(p.occurrences))}
                  </span>
                  <span
                    style={{
                      ...MONO,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={p.sample}
                  >
                    {p.pattern}
                  </span>
                  <span
                    style={{ ...MONO, fontSize: 11, color: "var(--ink-3)", textAlign: "right" }}
                  >
                    {p.services.slice(0, 2).join(", ")}
                  </span>
                </Link>
              );
            })}
            <div style={{ padding: "8px 14px", fontSize: 11.5, color: "var(--ink-3)" }}>
              {t("logs.patternsNote")}
            </div>
          </div>
        )
      ) : rows.length === 0 ? (
        empty
      ) : (
        <div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "14px 104px 62px 150px minmax(0,1fr)",
              gap: 10,
              ...head,
              color: "var(--ink-3)",
              background: "var(--sunk)",
              textTransform: "uppercase",
            }}
          >
            <span />
            <span>{t("logs.col.time")}</span>
            <span>{t("logs.col.level")}</span>
            <span>{t("logs.col.service")}</span>
            <span>{t("logs.col.message")}</span>
          </div>
          {/*
           * A table you open, after Sumo Logic's messages tab: one line per
           * message, scanned; a click opens it in place with every field, each
           * of which can be kept or excluded from the search — and the trace,
           * and the minute around it, one click away.
           */}
          {rows.map((l, i) => {
            const tone = severityTone(l.severity_number);
            const ctxFrom = new Date(new Date(`${l.ts.replace(" ", "T")}Z`).getTime() - 60_000);
            const ctxTo = new Date(ctxFrom.getTime() + 120_000);
            const ctxTerm = termFor("service_name", l.service_name);
            return (
              <details
                key={`${l.ts}-${i}`}
                data-testid="log-row"
                style={{ borderTop: "1px solid var(--line-2)" }}
              >
                <summary
                  className="oi-hover"
                  style={{
                    listStyle: "none",
                    cursor: "pointer",
                    display: "grid",
                    gridTemplateColumns: "14px 104px 62px 150px minmax(0,1fr)",
                    gap: 10,
                    alignItems: "center",
                    padding: "6px 14px",
                    fontSize: 12.5,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 3,
                      height: 16,
                      borderRadius: 2,
                      background: l.severity_number >= 13 ? tone.color : "var(--line)",
                    }}
                  />
                  <span style={{ ...MONO, fontSize: 11.5, color: "var(--ink-3)" }}>
                    {l.ts.slice(11, 23)}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: tone.color,
                      background: tone.bg,
                      borderRadius: 5,
                      padding: "1px 5px",
                      textAlign: "center",
                    }}
                  >
                    {(l.severity_text || tone.label).slice(0, 5).toUpperCase()}
                  </span>
                  <span
                    style={{
                      ...MONO,
                      fontSize: 11.5,
                      color: "var(--brand)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {l.service_name}
                  </span>
                  <span
                    style={{
                      ...MONO,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {l.body}
                  </span>
                </summary>
                <div
                  style={{
                    padding: "10px 14px 14px 38px",
                    background: "var(--sunk)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <pre
                    style={{
                      margin: 0,
                      ...MONO,
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                      background: "var(--panel)",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      padding: "9px 11px",
                    }}
                  >
                    {l.body}
                  </pre>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {l.trace_id && (
                      <Link
                        href={link({ signal: "traces", trace: l.trace_id, before: undefined })}
                        className="oi-btn oi-btn-sm"
                        data-testid="log-open-trace"
                      >
                        {t("logs.openTrace")}
                      </Link>
                    )}
                    {l.trace_id && (
                      <Link
                        href={link({
                          q: termFor("trace_id", l.trace_id) ?? undefined,
                          before: undefined,
                        })}
                        className="oi-btn oi-btn-sm"
                      >
                        {t("logs.ofThisTrace")}
                      </Link>
                    )}
                    <Link
                      href={link({
                        from: String(ctxFrom.getTime()),
                        to: String(ctxTo.getTime()),
                        q: ctxTerm ?? undefined,
                        before: undefined,
                      })}
                      className="oi-btn oi-btn-sm"
                      data-testid="log-context"
                    >
                      {t("logs.context")}
                    </Link>
                  </div>
                  <div>
                    <FieldRow
                      name="service_name"
                      value={l.service_name}
                      {...gestures("service_name", l.service_name)}
                    />
                    <FieldRow
                      name="environment"
                      value={l.environment}
                      {...gestures("environment", l.environment)}
                    />
                    <FieldRow
                      name="severity_text"
                      value={l.severity_text}
                      {...gestures("severity_text", l.severity_text)}
                    />
                    <FieldRow
                      name="scope_name"
                      value={l.scope_name}
                      {...gestures("scope_name", l.scope_name)}
                    />
                    {l.trace_id && (
                      <FieldRow
                        name="trace_id"
                        value={l.trace_id}
                        {...gestures("trace_id", l.trace_id)}
                      />
                    )}
                    {l.span_id && (
                      <FieldRow
                        name="span_id"
                        value={l.span_id}
                        {...gestures("span_id", l.span_id)}
                      />
                    )}
                    {Object.entries(l.attributes ?? {}).map(([k, v]) => (
                      <FieldRow key={`a-${k}`} name={k} value={v} {...gestures(`attr:${k}`, v)} />
                    ))}
                    {Object.entries(l.resource_attributes ?? {}).map(([k, v]) => (
                      <FieldRow key={`r-${k}`} name={k} value={v} />
                    ))}
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </ResultsPanel>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <QueryBar
        tenantId={tenantId}
        signal="logs"
        query={filter}
        service={service}
        mayEdit={mayEdit}
      />
      {shape && !patterns && shape.buckets.length > 0 && (
        <div className="oi-panel" style={{ padding: "10px 14px 8px" }}>
          <LogHistogram shape={shape} from={from} to={to} zoom={zoom} onSeverity={withSeverity} />
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "250px minmax(0,1fr)",
          gap: 14,
          alignItems: "start",
        }}
      >
        {rail}
        {results}
      </div>
    </div>
  );
}

async function TracesTab({
  tenantId,
  open,
  service,
  filter,
  mayEdit,
  attached,
  from,
  to,
  before,
  link,
  zoom,
  rail,
}: {
  tenantId: string;
  open?: string;
  service?: string;
  filter?: string;
  mayEdit: boolean;
  /** The incident this trace was just attached to, to say so once. */
  attached?: string;
  from: Date;
  to: Date;
  before?: string;
  link: (over: Record<string, string | undefined>) => string;
  zoom: (from: Date, to: Date) => string;
  /** The field browser, beside the results. */
  rail: React.ReactNode;
}) {
  const t = await getT();
  /*
   * Which drawing, and why it is a choice rather than a preference.
   *
   * A dot is one trace, so a cloud costs the window: measured on 22 million
   * spans, a day of dots is five seconds and a week is twenty-two. The bands
   * come from the per-minute rollup and cost the same at any width. So the
   * cloud is drawn while it is affordable — six hours — and the bands
   * otherwise, which is also the more readable of the two over a week.
   */
  const minutes = Math.round((to.getTime() - from.getTime()) / 60_000);
  const dots = minutes <= SCATTER_MAX_MINUTES;

  /*
   * A trace that is open is read on its own page, as in Sumo Logic's trace
   * view: the waterfall wants the whole width, and the list is one click back.
   */
  if (open) {
    const [spans, correlated, attachable] = await Promise.all([
      trace(tenantId, open),
      logs(tenantId, { traceId: open, limit: 100 }).then((p) => p.rows),
      // The incidents a trace can be hung on: the open ones, newest first.
      withTenant(tenantId, (tx) =>
        tx
          .select({ id: incidents.id, number: incidents.number, title: incidents.name })
          .from(incidents)
          .where(and(eq(incidents.tenantId, tenantId), ne(incidents.phase, "closed")))
          .orderBy(desc(incidents.declaredAt))
          .limit(25),
      ),
    ]);
    const root = spans.find((sp) => !sp.parent_span_id) ?? spans[0];
    const status = root?.http_status_code ?? 0;
    const services = [...new Set(spans.map((sp) => sp.service_name))];
    const errors = spans.filter((sp) => sp.status_code === "error").length;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="trace-view">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Link
            href={link({ trace: undefined })}
            className="oi-btn oi-btn-sm"
            data-testid="trace-back"
          >
            ← {t("trace.back")}
          </Link>
          {root && (
            <>
              <span style={{ fontSize: 16, fontWeight: 600 }}>{root.name}</span>
              {status > 0 && (
                <span
                  style={{
                    ...MONO,
                    fontSize: 11.5,
                    fontWeight: 600,
                    padding: "1px 7px",
                    borderRadius: 6,
                    background: status >= 400 ? "var(--dang-t)" : "var(--ok-t)",
                    color: status >= 400 ? "var(--dang)" : "var(--ok)",
                  }}
                >
                  {status}
                </span>
              )}
            </>
          )}
        </div>
        {root && (
          <div
            className="oi-panel"
            style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))" }}
          >
            {[
              [t("trace.start"), root.start_ts.slice(0, 23).replace("T", " ")],
              [t("trace.duration"), ms(root.duration_ns)],
              [t("trace.spans"), String(spans.length)],
              [t("trace.services"), String(services.length)],
              [t("trace.errors"), String(errors)],
            ].map(([k, v], i) => (
              <div
                key={k}
                style={{
                  padding: "10px 14px",
                  borderLeft: i ? "1px solid var(--line-2)" : "none",
                }}
              >
                <div className="oi-label">{k}</div>
                <div
                  style={{
                    ...MONO,
                    fontSize: 13,
                    fontWeight: 600,
                    marginTop: 3,
                    color: k === t("trace.errors") && errors > 0 ? "var(--dang)" : "var(--ink)",
                  }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>
        )}
        {attached && (
          <Link
            href={`/app/incidents/${attached}`}
            data-testid="trace-attached"
            style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)", textDecoration: "none" }}
          >
            {t("trace.attached", { number: attached })}
          </Link>
        )}
        <div className="oi-panel" style={{ padding: "12px 14px" }}>
          <Waterfall
            spans={spans}
            traceId={open}
            incidents={attachable}
            labels={{
              span: t("trace.span"),
              depth: t("trace.depth"),
              criticalPath: t("trace.criticalPath"),
              start: t("trace.start"),
              duration: t("trace.duration"),
              ofTrace: t("trace.ofTrace"),
              events: t("trace.events"),
              attributes: t("trace.attributes"),
              timeByService: t("trace.timeByService"),
              selfTime: t("trace.selfTime"),
              selectHint: t("trace.selectHint"),
              close: t("common.close"),
              story: t("trace.story"),
              storyHint: t("trace.storyHint"),
              spanLogs: t("trace.spanLogs"),
              attach: t("trace.attach"),
              attachDo: t("trace.attachDo"),
            }}
          />
        </div>
        <ResultsPanel
          tabs={[
            {
              label: t("telemetry.logsOfTrace"),
              count: String(correlated.length),
              href: link({}),
              on: true,
            },
          ]}
        >
          {correlated.length === 0 ? (
            <div style={{ padding: "16px 14px", fontSize: 12.5, color: "var(--ink-3)" }}>
              {t("telemetry.noLogsHere")}
            </div>
          ) : (
            correlated.map((l, i) => {
              const tone = severityTone(l.severity_number);
              return (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "104px 62px 150px minmax(0,1fr)",
                    gap: 10,
                    alignItems: "center",
                    padding: "6px 14px",
                    borderTop: i ? "1px solid var(--line-2)" : "none",
                    fontSize: 12.5,
                  }}
                >
                  <span style={{ ...MONO, fontSize: 11.5, color: "var(--ink-3)" }}>
                    {l.ts.slice(11, 23)}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: tone.color,
                      background: tone.bg,
                      borderRadius: 5,
                      padding: "1px 5px",
                      textAlign: "center",
                    }}
                  >
                    {(l.severity_text || tone.label).slice(0, 5).toUpperCase()}
                  </span>
                  <span style={{ ...MONO, fontSize: 11.5, color: "var(--brand)" }}>
                    {l.service_name}
                  </span>
                  <span style={{ ...MONO, overflowWrap: "anywhere" }}>{l.body}</span>
                </div>
              );
            })
          )}
        </ResultsPanel>
      </div>
    );
  }

  let page: Awaited<ReturnType<typeof traces>> = { rows: [], older: null };
  let shape: Awaited<ReturnType<typeof traceShape>> | null = null;
  let bands: Awaited<ReturnType<typeof traceBands>> | null = null;
  let error: string | null = null;
  try {
    // The shape and the list are the same window asked two ways, in parallel:
    // the dot somebody clicks and the row they would otherwise have scrolled
    // to are the same trace.
    [page, shape, bands] = await Promise.all([
      traces(tenantId, { from, to, service, filter, before }),
      dots ? traceShape(tenantId, { from, to, service, filter }) : Promise.resolve(null),
      dots ? Promise.resolve(null) : traceBands(tenantId, { from, to, service }),
    ]);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const rows = page.rows;

  /*
   * The quick filters of Sumo Logic's trace search: the two questions asked
   * of a trace list more than any other — which failed, which were slow —
   * as toggles that write their term into the filter, so the filter stays the
   * one description of what is on screen.
   */
  const terms = (filter ?? "")
    .split(/\s+AND\s+/i)
    .map((x) => x.trim())
    .filter(Boolean);
  const quick = [
    { key: "errors", label: t("traces.quick.errors"), term: "status_code = 'error'" },
    { key: "slow", label: t("traces.quick.slow"), term: "duration_ms > 1000" },
  ].map((q) => {
    const on = terms.includes(q.term);
    const next = on ? terms.filter((x) => x !== q.term) : [...terms, q.term];
    return { ...q, on, href: link({ q: next.join(" AND ") || undefined, before: undefined }) };
  });

  const latest =
    !error && !filter?.trim() && rows.length === 0 ? await latestSignal(tenantId, "traces") : null;
  const maxNs = Math.max(1, ...rows.map((r) => Number(r.duration_ns)));
  const cols = "84px 150px minmax(0,1fr) 190px 64px 64px 56px";
  const head = { padding: "7px 14px", fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <QueryBar
        tenantId={tenantId}
        signal="traces"
        query={filter}
        service={service}
        mayEdit={mayEdit}
      />
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span className="oi-label" style={{ marginRight: 4 }}>
          {t("traces.quick.title")}
        </span>
        {quick.map((q) => (
          <Link
            key={q.key}
            href={q.href}
            data-testid={`traces-quick-${q.key}`}
            aria-pressed={q.on}
            className={q.on ? undefined : "oi-hover"}
            style={{
              height: 28,
              padding: "0 11px",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 999,
              border: `1px solid ${q.on ? "var(--brand)" : "var(--line)"}`,
              background: q.on ? "var(--brand-t)" : "var(--panel)",
              color: q.on ? "var(--brand)" : "var(--ink-2)",
              fontSize: 12,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {q.on ? "✓ " : ""}
            {q.label}
          </Link>
        ))}
      </div>
      {shape && shape.points.length > 0 && (
        <div className="oi-panel" style={{ padding: "10px 14px 6px" }}>
          <LatencyScatter
            shape={shape}
            from={from}
            to={to}
            open={open}
            href={(traceId) => link({ trace: traceId })}
            zoom={zoom}
          />
        </div>
      )}
      {bands && bands.bands.length > 0 && (
        <div className="oi-panel" style={{ padding: "10px 14px 6px" }}>
          <LatencyBands
            shape={bands}
            from={from}
            to={to}
            zoom={zoom}
            note={filter?.trim() ? t("traces.bandsUnfiltered") : undefined}
          />
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "250px minmax(0,1fr)",
          gap: 14,
          alignItems: "start",
        }}
      >
        {rail}
        <ResultsPanel
          testId="trace-results"
          tabs={[
            {
              label: t("traces.list"),
              // The shape counts the whole window, filter or not: under a filter
              // the tab says nothing rather than a number that is not the list's.
              count: shape && !filter?.trim() ? t.fmt.number(Number(shape.traces)) : undefined,
              href: link({}),
              on: true,
            },
          ]}
          right={
            page.older ? (
              <Link
                href={link({ before: page.older })}
                data-testid="traces-older"
                className="oi-link"
                style={{ fontWeight: 600 }}
              >
                {t("telemetry.older")}
              </Link>
            ) : null
          }
        >
          {error ? (
            <div style={{ padding: 14 }}>
              <FilterError message={error} />
            </div>
          ) : rows.length === 0 ? (
            <EmptyWindow
              message={t(
                filter
                  ? "explorer.noMatch"
                  : latest
                    ? "explorer.emptyWindow"
                    : "telemetry.noTraces",
              )}
              latest={latest ? t.fmt.dateTime(latest) : null}
              latestLabel={t("explorer.latestData")}
              showLatest={
                latest && (latest < from || latest > to)
                  ? zoom(
                      new Date(latest.getTime() - 3_600_000),
                      new Date(latest.getTime() + 60_000),
                    )
                  : null
              }
              showLatestLabel={t("explorer.showLatest")}
            />
          ) : (
            <div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: cols,
                  gap: 10,
                  ...head,
                  color: "var(--ink-3)",
                  background: "var(--sunk)",
                  textTransform: "uppercase",
                }}
              >
                <span>{t("traces.col.start")}</span>
                <span>{t("traces.col.rootService")}</span>
                <span>{t("traces.col.operation")}</span>
                <span>{t("traces.col.duration")}</span>
                <span style={{ textAlign: "right" }}>{t("traces.col.spans")}</span>
                <span style={{ textAlign: "right" }}>{t("traces.col.errors")}</span>
                <span style={{ textAlign: "right" }}>{t("traces.col.status")}</span>
              </div>
              {rows.map((r) => {
                const errs = Number(r.error_count);
                const width = Math.max(2, (Number(r.duration_ns) / maxNs) * 100);
                return (
                  <Link
                    key={r.trace_id}
                    data-testid="trace-row"
                    href={link({ trace: r.trace_id })}
                    className="oi-hover"
                    style={{
                      display: "grid",
                      gridTemplateColumns: cols,
                      gap: 10,
                      alignItems: "center",
                      padding: "7px 14px",
                      borderTop: "1px solid var(--line-2)",
                      textDecoration: "none",
                      color: "inherit",
                      fontSize: 12.5,
                    }}
                  >
                    <span style={{ ...MONO, fontSize: 11.5, color: "var(--ink-3)" }}>
                      {r.start_ts.slice(11, 19)}
                    </span>
                    <span
                      style={{
                        ...MONO,
                        fontSize: 11.5,
                        color: "var(--brand)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.root_service}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <TraceServices services={r.services} />
                      <span
                        style={{
                          fontWeight: 600,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={r.services.join(" → ")}
                      >
                        {r.root_name}
                      </span>
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        aria-hidden
                        style={{
                          flex: 1,
                          height: 6,
                          borderRadius: 3,
                          background: "var(--line-2)",
                          overflow: "hidden",
                        }}
                      >
                        <span
                          style={{
                            display: "block",
                            height: "100%",
                            width: `${width}%`,
                            background: errs > 0 ? "var(--dang)" : "var(--brand)",
                            opacity: 0.7,
                          }}
                        />
                      </span>
                      <span style={{ ...MONO, fontSize: 11.5, minWidth: 64, textAlign: "right" }}>
                        {ms(r.duration_ns)}
                      </span>
                    </span>
                    <span
                      style={{ ...MONO, fontSize: 11.5, textAlign: "right", color: "var(--ink-2)" }}
                    >
                      {Number(r.span_count)}
                    </span>
                    <span
                      style={{
                        ...MONO,
                        fontSize: 11.5,
                        textAlign: "right",
                        fontWeight: errs > 0 ? 700 : 400,
                        color: errs > 0 ? "var(--dang)" : "var(--ink-3)",
                      }}
                    >
                      {errs}
                    </span>
                    {/*
                     * The status the caller got. Blank rather than zero when the
                     * trace is not an HTTP request: an invented 0 reads as a status.
                     */}
                    <span
                      style={{
                        ...MONO,
                        fontSize: 11.5,
                        fontWeight: 600,
                        textAlign: "right",
                        color:
                          r.root_status === 0
                            ? "var(--ink-3)"
                            : r.root_status >= 400
                              ? "var(--dang)"
                              : "var(--ok)",
                      }}
                    >
                      {r.root_status === 0 ? "—" : r.root_status}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </ResultsPanel>
      </div>
    </div>
  );
}

async function ConnectTab({
  tenantId,
  admin,
  issued,
  http,
}: {
  tenantId: string;
  admin: boolean;
  issued?: string;
  http: string;
}) {
  const t = await getT();
  const [keys, rejections, reporting, placed] = await Promise.all([
    listKeys(tenantId),
    recentRejections(tenantId),
    // Which packs are actually sending, and which already have their screen.
    // Both are read here rather than guessed from the pack list: "install" on
    // a dashboard that exists, or "reporting" on one that stopped, are the two
    // ways this card could lie.
    packsReporting(tenantId).catch(() => [] as PackId[]),
    packDashboardSlugs(tenantId),
  ]);
  // Who has actually reported, and on what terms. Both from Postgres: the
  // services table already records when telemetry last named a service, so
  // this costs nothing on top of the page.
  const setup = await withTenant(tenantId, async (tx) => {
    const seen = await tx
      .select({
        key: services.key,
        stack: services.techStack,
        at: services.telemetryLastSeenAt,
        override: services.retentionOverrideDays,
      })
      .from(services)
      .where(and(eq(services.tenantId, tenantId), isNotNull(services.telemetryLastSeenAt)))
      .orderBy(desc(services.telemetryLastSeenAt))
      .limit(12);
    const [settings] = await tx
      .select()
      .from(telemetrySettings)
      .where(eq(telemetrySettings.tenantId, tenantId));
    return { seen, settings: settings ?? null };
  });
  const snippet = [
    `OTEL_EXPORTER_OTLP_ENDPOINT=${http}`,
    `OTEL_EXPORTER_OTLP_HEADERS=x-oi-key=${issued ?? "<your key>"}`,
    "OTEL_SERVICE_NAME=checkout-api",
    "OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,service.version=2.31.0",
  ].join("\n");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {issued && (
        <div
          style={{
            ...CARD,
            borderColor: "var(--ok)",
            background: "var(--ok-t)",
            padding: "12px 16px",
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
            {t("telemetry.keyOnce")}
          </div>
          <code style={{ ...MONO, fontSize: 12.5, wordBreak: "break-all" }}>{issued}</code>
        </div>
      )}

      <div style={{ ...CARD, padding: "14px 16px" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("telemetry.fourLines")}</div>
        <p style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.6, margin: "6px 0 10px" }}>
          {t("telemetry.fourLinesBody")}
        </p>
        <pre
          style={{
            ...MONO,
            background: "var(--sunk)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: "10px 12px",
            margin: 0,
            overflowX: "auto",
            lineHeight: 1.7,
          }}
        >
          {snippet}
        </pre>
      </div>

      {/*
        The packs, beside the key they need. A reader on this screen has just
        been handed a token and an endpoint; the next thing they want is
        something to paste them into, and sending them to a repository to look
        for it is where onboarding stops.
      */}
      <div style={{ ...CARD, padding: "14px 16px" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>
          {t("telemetry.packs")}
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 10, lineHeight: 1.5 }}>
          {t("telemetry.packsHint")}
        </div>
        {(
          [
            ["host", "telemetry.packHost"],
            ["postgres", "telemetry.packPostgres"],
            ["docker", "telemetry.packDocker"],
            ["kubernetes", "telemetry.packKubernetes"],
          ] as const
        ).map(([file, label]) => {
          const on = reporting.includes(file);
          const slug = placed[file];
          return (
            <div
              key={file}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                padding: "8px 0",
                borderTop: "1px solid var(--line-2)",
                fontSize: 12.5,
              }}
            >
              <span style={{ ...MONO, fontWeight: 600, minWidth: 130 }}>{file}.yaml</span>
              <span style={{ color: "var(--ink-2)", lineHeight: 1.45, flex: 1, minWidth: 180 }}>
                {t(label)}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: on ? "var(--ok)" : "var(--ink-3)",
                  whiteSpace: "nowrap",
                }}
              >
                {on ? t("telemetry.packReporting") : t("telemetry.packSilent")}
              </span>
              {slug ? (
                <Link
                  href={`/app/dashboards/${slug}`}
                  style={{ fontSize: 11.5, fontWeight: 600, color: "var(--brand)" }}
                >
                  {t("telemetry.packOpen")}
                </Link>
              ) : (
                admin && (
                  <form action={installPackDashboard}>
                    <input type="hidden" name="pack" value={file} />
                    <button
                      type="submit"
                      data-testid={`pack-install-${file}`}
                      style={{
                        border: "1px solid var(--line)",
                        background: "var(--panel)",
                        borderRadius: 7,
                        padding: "3px 9px",
                        fontSize: 11.5,
                        fontWeight: 600,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t("telemetry.packInstall")}
                    </button>
                  </form>
                )
              )}
            </div>
          );
        })}
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 10, lineHeight: 1.5 }}>
          {t("telemetry.packsWhere")}
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-start" }}>
        <div style={{ ...CARD, padding: "14px 16px", flex: "1 1 320px", minWidth: 280 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>
            {t("telemetry.collectors")}
          </div>
          {setup.seen.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
              {t("telemetry.collectorsNone")}
            </div>
          ) : (
            setup.seen.map((c) => (
              <div
                key={c.key}
                data-testid="collector-seen"
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  padding: "5px 0",
                  borderTop: "1px solid var(--line-2)",
                  fontSize: 12.5,
                }}
              >
                <span style={{ fontWeight: 600, minWidth: 0, flex: 1 }}>{c.key}</span>
                {c.stack && (
                  <span style={{ ...MONO, fontSize: 11, color: "var(--ink-3)" }}>{c.stack}</span>
                )}
                <span style={{ fontSize: 11, color: "var(--ink-3)", whiteSpace: "nowrap" }}>
                  {c.at ? t.fmt.relativeCompact(c.at) : "—"}
                </span>
              </div>
            ))
          )}
        </div>

        <div style={{ ...CARD, padding: "14px 16px", flex: "1 1 320px", minWidth: 280 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>
            {t("telemetry.retention")}
          </div>
          {(
            [
              ["telemetry.retentionLogs", setup.settings?.retentionLogsDays ?? 15],
              ["telemetry.retentionTraces", setup.settings?.retentionTracesDays ?? 15],
              ["telemetry.retentionMetrics", setup.settings?.retentionMetricsDays ?? 30],
              ["telemetry.retentionProfiles", setup.settings?.retentionProfilesDays ?? 7],
              ["telemetry.retentionRum", setup.settings?.retentionRumDays ?? 7],
            ] as const
          ).map(([label, days]) => (
            <div
              key={label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                padding: "5px 0",
                borderTop: "1px solid var(--line-2)",
                fontSize: 12.5,
              }}
            >
              <span style={{ color: "var(--ink-2)" }}>{t(label)}</span>
              <span style={{ ...MONO }}>{t("telemetry.nDays", { count: days })}</span>
            </div>
          ))}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              padding: "5px 0",
              borderTop: "1px solid var(--line-2)",
              fontSize: 12.5,
            }}
          >
            <span style={{ color: "var(--ink-2)" }}>{t("telemetry.softCap")}</span>
            <span style={{ ...MONO }}>
              {setup.settings?.dailySoftCapGb
                ? t("telemetry.softCapGb", { gb: setup.settings.dailySoftCapGb })
                : t("telemetry.softCapNone")}
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.5 }}>
            {t("telemetry.retentionWhere")}{" "}
            {admin && (
              <Link href="/app/settings/observability" style={{ color: "var(--brand)" }}>
                {t("telemetry.retentionEdit")}
              </Link>
            )}
          </div>
        </div>
      </div>

      <div style={{ ...CARD, padding: "14px 16px" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 10 }}>
          {t("telemetry.keys")}
        </div>
        {keys.length === 0 && (
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 10 }}>
            {t("telemetry.noKeys")}
          </div>
        )}
        {keys.map((k) => (
          <div
            key={k.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "7px 0",
              borderTop: "1px solid var(--line-2)",
              fontSize: 12.5,
            }}
          >
            <span
              style={{ fontWeight: 600, textDecoration: k.revokedAt ? "line-through" : "none" }}
            >
              {k.label}
            </span>
            <span style={{ ...MONO, fontSize: 11, color: "var(--ink-3)" }}>
              {k.signals.join(", ")}
              {k.lastUsedAt
                ? ` · ${t("telemetry.lastUsed", { when: t.fmt.relativeCompact(k.lastUsedAt) })}`
                : ` · ${t("telemetry.neverUsed")}`}
            </span>
            <span style={{ flex: 1 }} />
            {admin && !k.revokedAt && (
              <form action={revokeIngestionKey}>
                <input type="hidden" name="id" value={k.id} />
                <button
                  type="submit"
                  style={{
                    border: "1px solid var(--line)",
                    background: "var(--panel)",
                    borderRadius: 7,
                    padding: "3px 9px",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {t("telemetry.revoke")}
                </button>
              </form>
            )}
          </div>
        ))}
        {admin && (
          <form action={createIngestionKey} style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input
              name="label"
              placeholder={t("telemetry.keyLabel")}
              className="oi-field"
              style={{ flex: 1, maxWidth: 260, fontSize: 13 }}
            />
            <button
              type="submit"
              style={{
                background: "var(--brand)",
                color: "#fff",
                border: 0,
                borderRadius: 8,
                padding: "6px 12px",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t("telemetry.issueKey")}
            </button>
          </form>
        )}
      </div>

      {rejections.length > 0 && (
        <div style={{ ...CARD, padding: "14px 16px" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("telemetry.rejections")}</div>
          <p
            style={{ fontSize: 12.5, color: "var(--ink-2)", margin: "6px 0 10px", lineHeight: 1.6 }}
          >
            {t("telemetry.rejectionsBody")}
          </p>
          {rejections.map((r, i) => (
            <div
              key={i}
              style={{ padding: "5px 0", borderTop: i ? "1px solid var(--line-2)" : "none" }}
            >
              <div style={{ fontSize: 12.5, color: "var(--dang)" }}>
                {r.reason} <span style={{ color: "var(--ink-3)" }}>· {r.signal}</span>
              </div>
              {r.excerpt && (
                <div style={{ ...MONO, fontSize: 11, color: "var(--ink-3)" }}>{r.excerpt}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
