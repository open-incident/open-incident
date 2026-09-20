import Link from "next/link";
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
import { createIngestionKey, revokeIngestionKey } from "./actions";
import { NotInstalled } from "./not-installed";
import { ExceptionsTab } from "./exceptions-tab";
import { MetricsTab } from "./metrics-tab";
import { MapTab } from "./map-tab";
import { SqlTab } from "./sql-tab";
import { ProfilesTab } from "./profiles-tab";
import { FilterError, QueryBar } from "./query-bar";
import { RumTab } from "./rum-tab";
import { SlosTab } from "./slos-tab";
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

const TABS = [
  "logs",
  "traces",
  "metrics",
  "exceptions",
  "profiles",
  "rum",
  "slos",
  "map",
  "sql",
  "connect",
] as const;
type Tab = (typeof TABS)[number];

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

  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "logs";
  const endpoints = otlpEndpoints(hostOf(tenant));

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
              href={`/app/telemetry?tab=${x}${sp.service && x !== "connect" ? `&service=${encodeURIComponent(sp.service)}` : ""}`}
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
        {sp.service && tab !== "connect" && (
          <Link
            href={`/app/telemetry?tab=${tab}`}
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

      <div style={{ marginTop: 18 }}>
        {tab === "logs" && (
          <LogsTab
            tenantId={tenant.id}
            service={sp.service}
            filter={sp.q}
            mayEdit={canRespond(member)}
            patterns={sp.patterns === "1"}
          />
        )}
        {tab === "traces" && (
          <TracesTab
            tenantId={tenant.id}
            open={sp.trace}
            service={sp.service}
            filter={sp.q}
            mayEdit={canRespond(member)}
          />
        )}
        {tab === "metrics" && <MetricsTab tenantId={tenant.id} open={sp.metric} />}
        {tab === "exceptions" && (
          <ExceptionsTab
            tenantId={tenant.id}
            open={sp.fp}
            mayEdit={canRespond(member)}
            service={sp.service}
            filter={sp.q}
          />
        )}
        {tab === "map" && (
          <MapTab tenantId={tenant.id} sinceMinutes={windowOf(sp.since)} highlight={sp.service} />
        )}
        {tab === "profiles" && (
          <ProfilesTab
            tenantId={tenant.id}
            service={sp.service}
            type={sp.type}
            sinceMinutes={profileWindowOf(sp.since)}
            compare={sp.compare === "1"}
          />
        )}
        {tab === "rum" && (
          <RumTab
            tenantId={tenant.id}
            view={rumViewOf(sp.view)}
            sinceHours={rumWindowOf(sp.since)}
            session={sp.session}
          />
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
        {tab === "sql" && <SqlTab tenantId={tenant.id} query={sp.q} />}
        {tab === "connect" && (
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
}: {
  tenantId: string;
  service?: string;
  filter?: string;
  mayEdit: boolean;
  /** The same stream, folded into the shapes of line it contains. */
  patterns?: boolean;
}) {
  const t = await getT();
  // The filter is compiled here rather than validated first: the compiler is
  // the only thing that knows what is valid, and running it twice to ask the
  // same question would be two places for the answer to differ.
  let rows: Awaited<ReturnType<typeof logs>> = [];
  let shapes: Awaited<ReturnType<typeof logPatterns>> = [];
  let error: string | null = null;
  try {
    if (patterns) shapes = await logPatterns(tenantId, { sinceHours: 24, service, filter });
    else rows = await logs(tenantId, { limit: 200, ...(service ? { service } : {}), filter });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const modeHref = (on: boolean) => {
    const p = new URLSearchParams({
      tab: "logs",
      ...(service ? { service } : {}),
      ...(filter ? { q: filter } : {}),
      ...(on ? { patterns: "1" } : {}),
    });
    return `/app/telemetry?${p.toString()}`;
  };
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
                      ? `/app/telemetry?${new URLSearchParams({
                          tab: "logs",
                          ...(service ? { service } : {}),
                          q: `body contains '${literal}'`,
                        }).toString()}`
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
              href={`/app/telemetry?tab=traces&trace=${l.trace_id}`}
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
        <div style={{ padding: "8px 16px", color: "#6F7E89", fontSize: 11 }}>
          {t("telemetry.logsFoot", { count: rows.length })}
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
}: {
  tenantId: string;
  open?: string;
  service?: string;
  filter?: string;
  mayEdit: boolean;
}) {
  const t = await getT();
  let rows: Awaited<ReturnType<typeof traces>> = [];
  let error: string | null = null;
  try {
    rows = await traces(tenantId, { service, filter });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

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
  const correlated = open ? await logs(tenantId, { traceId: open, limit: 50 }) : [];

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
              href={`/app/telemetry?tab=traces&trace=${r.trace_id}`}
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
              <Waterfall
                spans={spans}
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
  const [keys, rejections] = await Promise.all([listKeys(tenantId), recentRejections(tenantId)]);
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
        ).map(([file, label]) => (
          <div
            key={file}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              padding: "6px 0",
              borderTop: "1px solid var(--line-2)",
              fontSize: 12.5,
            }}
          >
            <span style={{ ...MONO, fontWeight: 600, minWidth: 130 }}>{file}.yaml</span>
            <span style={{ color: "var(--ink-2)", lineHeight: 1.45 }}>{t(label)}</span>
          </div>
        ))}
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 10, lineHeight: 1.5 }}>
          {t("telemetry.packsWhere")}
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
