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
  const win = windowFor(range);
  const endpoints = otlpEndpoints(hostOf(tenant));

  /** Every link out of the controls keeps everything else. */
  const link = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const base: Record<string, string | undefined> = {
      tab,
      signal: tab === "explore" ? signal : undefined,
      range: range === DEFAULT_RANGE ? undefined : range,
      service: sp.service,
      q: sp.q,
    };
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) q.set(k, v);
    return `/app/telemetry?${q.toString()}`;
  };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "22px 28px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--title)",
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-.015em",
          }}
        >
          {t("nav.telemetry")}
        </h1>
        <div
          style={{
            display: "flex",
            gap: 2,
            background: "var(--sunk)",
            borderRadius: 10,
            padding: 3,
          }}
        >
          {TABS.map((x) => (
            <Link
              key={x}
              data-testid={`telemetry-tab-${x}`}
              href={link({ tab: x, signal: x === "explore" ? signal : undefined })}
              style={{
                height: 28,
                padding: "0 12px",
                borderRadius: 8,
                background: tab === x ? "var(--panel)" : "transparent",
                color: tab === x ? "var(--ink)" : "var(--ink-3)",
                boxShadow: tab === x ? "var(--shadow-card)" : "none",
                display: "flex",
                alignItems: "center",
                fontSize: 12.5,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              {t(`telemetry.tab.${x}`)}
            </Link>
          ))}
        </div>
        {/*
          A filtered list that does not say it is filtered is a list somebody
          will read as "there is nothing else". The chip says which service,
          and removing it is one click.
        */}
        {sp.service && tab !== "setup" && (
          <Link
            href={link({ service: undefined })}
            data-testid="telemetry-service-filter"
            title={t("telemetry.clearService")}
            aria-label={t("telemetry.clearService")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 26,
              padding: "0 10px",
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--sunk)",
              fontSize: 12,
              color: "var(--ink)",
              textDecoration: "none",
            }}
          >
            <span style={{ fontFamily: "var(--mono)" }}>{sp.service}</span>
            <span style={{ color: "var(--ink-3)" }} aria-hidden>
              ✕
            </span>
          </Link>
        )}
        <span style={{ flex: 1 }} />
        <Usage tenantId={tenant.id} label={t("telemetry.todayRows")} />
      </div>

      {/*
        The Explorer's two controls, above everything it can look at: the
        signal, and the window. They are one row because they are one thought
        — "traces, last hour" — and because the window is the thing that keeps
        a list of traces from reading a month of them.
      */}
      {tab === "explore" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            marginTop: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 2,
              background: "var(--sunk)",
              borderRadius: 9,
              padding: 3,
            }}
          >
            {SIGNALS.map((x) => (
              <Link
                key={x}
                data-testid={`telemetry-signal-${x}`}
                href={link({ signal: x, before: undefined })}
                style={{
                  height: 26,
                  padding: "0 10px",
                  borderRadius: 7,
                  background: signal === x ? "var(--panel)" : "transparent",
                  color: signal === x ? "var(--ink)" : "var(--ink-3)",
                  boxShadow: signal === x ? "var(--shadow-card)" : "none",
                  display: "flex",
                  alignItems: "center",
                  fontSize: 12,
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                {t(`telemetry.tab.${x}`)}
              </Link>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          {/* The window. `sql` writes its own time bounds, and metrics carry
              their own longer horizon, so neither is offered one here. */}
          {signal !== "sql" && signal !== "metrics" && (
            <div style={{ display: "flex", gap: 2 }}>
              {(Object.keys(RANGES) as RangeKey[]).map((k) => (
                <Link
                  key={k}
                  data-testid={`telemetry-range-${k}`}
                  href={link({ range: k, before: undefined })}
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11.5,
                    fontWeight: 600,
                    padding: "3px 8px",
                    borderRadius: 7,
                    textDecoration: "none",
                    color: range === k ? "var(--ink)" : "var(--ink-3)",
                    background: range === k ? "var(--panel)" : "transparent",
                    border: `1px solid ${range === k ? "var(--line)" : "transparent"}`,
                  }}
                >
                  {k}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        {tab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <ServicesTab tenantId={tenant.id} sinceMinutes={serviceWindowOf(String(win.minutes))} />
            <MapTab
              tenantId={tenant.id}
              sinceMinutes={windowOf(String(win.minutes))}
              highlight={sp.service}
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
          (signal === "logs" || signal === "traces" || signal === "exceptions") && (
            <div style={{ display: "grid", gridTemplateColumns: "196px minmax(0,1fr)", gap: 18 }}>
              <FacetRail
                kind={signal}
                tenantId={tenant.id}
                from={win.from}
                to={win.to}
                filter={sp.q}
                service={sp.service}
                link={link}
              />
              <div style={{ minWidth: 0 }}>
                {signal === "logs" && (
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
                  />
                )}
                {signal === "traces" && (
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
                  />
                )}
                {signal === "exceptions" && (
                  <ExceptionsTab
                    tenantId={tenant.id}
                    open={sp.fp}
                    mayEdit={canRespond(member)}
                    service={sp.service}
                    filter={sp.q}
                  />
                )}
              </div>
            </div>
          )}
        {tab === "explore" && signal === "metrics" && (
          <MetricsTab tenantId={tenant.id} open={sp.metric} />
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
          <ConnectTab tenantId={tenant.id} admin={admin} issued={sp.issued} http={endpoints.http} />
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

async function Empty({ message }: { message: string }) {
  return (
    <div
      style={{
        ...CARD,
        padding: "28px 20px",
        textAlign: "center",
        color: "var(--ink-3)",
        fontSize: 13,
      }}
    >
      {message}
    </div>
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
}) {
  const t = await getT();
  // The filter is compiled here rather than validated first: the compiler is
  // the only thing that knows what is valid, and running it twice to ask the
  // same question would be two places for the answer to differ.
  let page: Awaited<ReturnType<typeof logs>> = { rows: [], older: null };
  let shapes: Awaited<ReturnType<typeof logPatterns>> = [];
  let error: string | null = null;
  try {
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

  const modeHref = (on: boolean) => link({ patterns: on ? "1" : undefined, before: undefined });
  const bar = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <QueryBar
        tenantId={tenantId}
        signal="logs"
        query={filter}
        service={service}
        mayEdit={mayEdit}
      />
      <div style={{ display: "flex", gap: 6 }}>
        {[false, true].map((on) => (
          <Link
            key={String(on)}
            href={modeHref(on)}
            data-testid={on ? "logs-patterns" : "logs-stream"}
            style={{
              fontSize: 12,
              padding: "4px 10px",
              borderRadius: 7,
              border: "1px solid var(--line)",
              background: on === !!patterns ? "var(--panel)" : "transparent",
              color: on === !!patterns ? "var(--ink)" : "var(--ink-3)",
              fontWeight: on === !!patterns ? 600 : 400,
              textDecoration: "none",
            }}
          >
            {t(on ? "logs.patterns" : "logs.stream")}
          </Link>
        ))}
      </div>
    </div>
  );
  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {bar}
        <FilterError message={error} />
      </div>
    );
  }
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

  if (patterns) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {bar}
        {shapes.length === 0 ? (
          <Empty message={t(filter ? "explorer.noMatch" : "telemetry.noLogs")} />
        ) : (
          <div style={{ ...CARD, overflow: "hidden" }} data-testid="log-patterns">
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
                  style={{
                    display: "grid",
                    gridTemplateColumns: "58px 70px minmax(0,1fr) 110px",
                    gap: 10,
                    padding: "8px 14px",
                    borderTop: i ? "1px solid var(--line-2)" : "none",
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
                    {p.occurrences}×
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
                    style={{ ...MONO, fontSize: 10.5, color: "var(--ink-3)", textAlign: "right" }}
                  >
                    {p.services.slice(0, 2).join(", ")}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
        <span style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.5 }}>
          {t("logs.patternsNote")}
        </span>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {bar}
        <Empty message={t(filter ? "explorer.noMatch" : "telemetry.noLogs")} />
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {bar}
      <div
        style={{
          ...CARD,
          overflow: "hidden",
          background: "var(--topbar-dark)",
          fontFamily: "var(--mono)",
          fontSize: 11.5,
          lineHeight: 1.6,
        }}
      >
        {/*
         * A terminal, not a table.
         *
         * Logs are read the way logs have always been read — fixed width, one
         * line each, scanned rather than parsed — and the dark ground is what
         * makes a level jump out of a thousand lines. It is the same treatment
         * the product already gives an alert payload, and it is deliberately
         * dark in both themes: a log stream is a code block, not a surface.
         */}
        {rows.map((l, i) => {
          const tone = severityTone(l.severity_number);
          const line = (
            <>
              <span style={{ color: "#6F7E89" }}>{l.ts.slice(11, 23)}</span>
              <span style={{ fontWeight: 700, color: tone.color }}>
                {(l.severity_text || tone.label).slice(0, 5)}
              </span>
              <span
                style={{
                  color: "var(--code-blue)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {l.service_name}
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {l.body}
              </span>
            </>
          );
          const shared: React.CSSProperties = {
            display: "grid",
            gridTemplateColumns: "92px 52px 150px minmax(0,1fr)",
            gap: 12,
            padding: "5px 16px",
            borderTop: i ? "1px solid #1C2329" : "none",
            color: "#C9D3DA",
            textDecoration: "none",
          };
          // The whole line opens the trace when there is one. A link in its own
          // column made the reader aim at six characters; the line is the
          // target, and a line without a trace simply is not one.
          return l.trace_id ? (
            <Link
              key={`${l.ts}-${i}`}
              href={link({ signal: "traces", trace: l.trace_id, before: undefined })}
              style={{ ...shared, cursor: "pointer" }}
              title={t("telemetry.openTrace")}
            >
              {line}
            </Link>
          ) : (
            <div key={`${l.ts}-${i}`} style={shared}>
              {line}
            </div>
          );
        })}
        <div
          style={{
            padding: "8px 16px",
            color: "#6F7E89",
            fontSize: 11,
            display: "flex",
            gap: 12,
          }}
        >
          <span>{t("telemetry.logsFoot", { count: rows.length })}</span>
          <span style={{ flex: 1 }} />
          {/* A cursor, not an offset: see recentLogs. */}
          {page.older && (
            <Link
              href={link({ before: page.older })}
              data-testid="logs-older"
              style={{ color: "var(--code-blue)", fontWeight: 600, textDecoration: "none" }}
            >
              {t("telemetry.older")}
            </Link>
          )}
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("telemetry.logsNote")}</div>
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
}) {
  const t = await getT();
  let page: Awaited<ReturnType<typeof traces>> = { rows: [], older: null };
  let error: string | null = null;
  try {
    page = await traces(tenantId, { from, to, service, filter, before });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const rows = page.rows;

  const bar = (
    <QueryBar
      tenantId={tenantId}
      signal="traces"
      query={filter}
      service={service}
      mayEdit={mayEdit}
    />
  );
  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {bar}
        <FilterError message={error} />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {bar}
        <Empty message={t(filter ? "explorer.noMatch" : "telemetry.noTraces")} />
      </div>
    );
  }
  const spans = open ? await trace(tenantId, open) : [];
  const correlated = open ? (await logs(tenantId, { traceId: open, limit: 50 })).rows : [];
  // The incidents a trace can be hung on: the open ones, newest first. Read
  // only when a trace is open — the list itself has nothing to attach.
  const attachable = open
    ? await withTenant(tenantId, (tx) =>
        tx
          .select({ id: incidents.id, number: incidents.number, title: incidents.name })
          .from(incidents)
          .where(and(eq(incidents.tenantId, tenantId), ne(incidents.phase, "closed")))
          .orderBy(desc(incidents.declaredAt))
          .limit(25),
      )
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {bar}
      {/*
       * Stacked, not side by side.
       *
       * The list is what you scan and the trace is what you read, and they
       * want different widths: a waterfall squeezed into half the page loses
       * the only axis that matters. Putting the list across the top also keeps
       * the trace you came from visible while you read the one you opened.
       */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/*
         * Capped once a trace is open, so opening one does not push it below a
         * hundred rows of list. Left full height when nothing is open, because
         * then the list *is* the screen.
         */}
        <div
          style={{
            ...CARD,
            overflow: "hidden",
            ...(open ? { maxHeight: 220, overflowY: "auto" as const } : {}),
          }}
        >
          {rows.map((r, i) => (
            <Link
              key={r.trace_id}
              data-testid="trace-row"
              href={link({ trace: r.trace_id })}
              style={{
                display: "grid",
                gridTemplateColumns: "76px 52px minmax(0,1fr) auto 76px 66px",
                gap: 12,
                alignItems: "center",
                padding: "8px 14px",
                borderTop: i ? "1px solid var(--line-2)" : "none",
                background: r.trace_id === open ? "var(--sunk)" : "transparent",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <span style={{ ...MONO, fontSize: 11.5, color: "var(--ink-3)" }}>
                {r.start_ts.slice(11, 19)}
              </span>
              {/*
               * The status the caller got, which is the thing somebody scans a
               * trace list for. Blank rather than zero when the trace is not an
               * HTTP request, or predates the column: an invented 0 would read
               * as a status.
               */}
              <span
                style={{
                  ...MONO,
                  fontSize: 11.5,
                  fontWeight: 600,
                  textAlign: "center",
                  padding: "1px 0",
                  borderRadius: 6,
                  background:
                    r.root_status === 0
                      ? "transparent"
                      : r.root_status >= 400
                        ? "var(--dang-t)"
                        : "var(--ok-t)",
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
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.root_name}
              </span>
              {/* Which services the request went through, before opening it. */}
              <TraceServices services={r.services} />
              <span style={{ ...MONO, color: "var(--ink-2)", textAlign: "right" }}>
                {ms(r.duration_ns)}
              </span>
              <span
                style={{
                  ...MONO,
                  fontSize: 10.5,
                  textAlign: "right",
                  color: Number(r.error_count) > 0 ? "var(--dang)" : "var(--ink-3)",
                }}
              >
                {t("telemetry.nSpans", { count: Number(r.span_count) })}
              </span>
            </Link>
          ))}
        </div>
        {page.older && (
          <div style={{ display: "flex" }}>
            <Link
              href={link({ before: page.older })}
              data-testid="traces-older"
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--brand)",
                textDecoration: "none",
              }}
            >
              {t("telemetry.older")}
            </Link>
          </div>
        )}

        {open && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ ...CARD, padding: "14px 16px" }}>
              {/*
               * The header names the request rather than its id. A trace id is
               * what you paste into a search box; "POST /checkout/confirm ·
               * 500" is what tells you, in one line, whether this is the one
               * you are looking for.
               */}
              {(() => {
                const root = spans.find((sp) => !sp.parent_span_id) ?? spans[0];
                if (!root) return null;
                const status = root.http_status_code;
                return (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 10,
                      flexWrap: "wrap",
                      marginBottom: 12,
                    }}
                  >
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{root.name}</span>
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
                    <span style={{ ...MONO, fontSize: 11, color: "var(--ink-3)" }}>
                      {open.slice(0, 8)} · {root.start_ts.slice(11, 23)}
                    </span>
                  </div>
                );
              })()}
              {attached && (
                <Link
                  href={`/app/incidents/${attached}`}
                  data-testid="trace-attached"
                  style={{
                    display: "block",
                    marginBottom: 10,
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "var(--ok)",
                    textDecoration: "none",
                  }}
                >
                  {t("trace.attached", { number: attached })}
                </Link>
              )}
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
            <div style={{ ...CARD, padding: "12px 16px" }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>
                {t("telemetry.logsOfTrace")}
              </div>
              {correlated.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                  {t("telemetry.noLogsHere")}
                </div>
              ) : (
                correlated.map((l, i) => (
                  <div key={i} style={{ ...MONO, padding: "3px 0", color: "var(--ink)" }}>
                    <span style={{ color: "var(--ink-3)" }}>{l.ts.slice(11, 23)} </span>
                    {l.body}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
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
