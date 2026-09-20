import Link from "next/link";
import { getT } from "@/i18n/server";
import {
  rumErrors,
  rumRoutes,
  rumSegments,
  rumReplayed,
  rumSession,
  rumSessions,
  rumVitals,
} from "@/lib/telemetry";
import { ReplayPlayer } from "./replay-player";
import type { MessageKey } from "@/i18n/dictionaries/en";

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};
const MONO: React.CSSProperties = { fontFamily: "var(--mono)", fontSize: 11.5 };
const EYEBROW: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".06em",
  color: "var(--ink-3)",
};

const WINDOWS = [1, 24, 168] as const;
const VIEWS = ["overview", "sessions", "errors"] as const;
type View = (typeof VIEWS)[number];

/** Google's own thresholds, so "good" here means what it means everywhere. */
/** The acronyms a reader already knows, kept as acronyms. */
const WEB_VITALS = new Set(["LCP", "INP", "CLS", "FCP", "TTFB"]);

const THRESHOLDS: Record<string, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
  // Not Google's, because Google has none for these. Apple's own guidance puts
  // a cold start over 2 s in the territory the watchdog eventually kills, and
  // Android's vitals dashboard marks 5 s as excessive; a tap that takes longer
  // than a second to paint is the one users call "laggy".
  app_start: [2000, 5000],
  screen_load: [1000, 2500],
};

function tone(vital: string, value: number): string {
  const t = THRESHOLDS[vital];
  if (!t || !Number.isFinite(value) || value === 0) return "var(--ink-3)";
  return value <= t[0] ? "var(--ok)" : value <= t[1] ? "var(--wait)" : "var(--dang)";
}

function vitalText(vital: string, value: number): string {
  if (!Number.isFinite(value) || value === 0) return "—";
  return vital === "CLS" ? value.toFixed(3) : `${Math.round(value)} ms`;
}

/**
 * What a browser saw, which is the one thing the rest of the telemetry cannot
 * say. A p95 of 40 ms at the edge and a page that takes four seconds to become
 * usable are both true at once, and only this knows the second.
 *
 * Everything is a **p75**. An average page load is a number no visitor
 * experienced — dragged down by cached repeat visits, hiding the first-time
 * visitor on a phone who is the one deciding whether to come back. The 75th
 * percentile is also what Google's thresholds are defined against, so a "good"
 * here means the same as a "good" in every other tool the reader has used.
 */
export async function RumTab({
  tenantId,
  view = "overview",
  sinceHours = 24,
  session,
}: {
  tenantId: string;
  view?: View;
  sinceHours?: number;
  session?: string;
}) {
  const t = await getT();
  const window = { sinceHours };
  const vitals = await rumVitals(tenantId, window);

  if (vitals.length === 0 && view === "overview") {
    return <Empty />;
  }

  const link = (over: Record<string, string>) => {
    const p = new URLSearchParams({
      tab: "rum",
      view,
      since: String(sinceHours),
      ...over,
    });
    return `/app/telemetry?${p.toString()}`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {VIEWS.map((v) => (
          <Link
            key={v}
            href={link({ view: v, session: "" })}
            style={{
              fontSize: 12.5,
              padding: "5px 11px",
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: v === view ? "var(--panel)" : "transparent",
              color: v === view ? "var(--ink)" : "var(--ink-3)",
              fontWeight: v === view ? 600 : 400,
              textDecoration: "none",
            }}
          >
            {t(`rum.view.${v}` as MessageKey)}
          </Link>
        ))}
        <span style={{ flex: 1 }} />
        {WINDOWS.map((w) => (
          <Link
            key={w}
            href={link({ since: String(w) })}
            style={{
              fontSize: 12,
              padding: "4px 9px",
              borderRadius: 7,
              border: "1px solid var(--line)",
              background: w === sinceHours ? "var(--panel)" : "transparent",
              color: w === sinceHours ? "var(--ink)" : "var(--ink-3)",
              textDecoration: "none",
            }}
          >
            {t(w === 1 ? "rum.last1h" : w === 24 ? "rum.last24h" : "rum.last7d")}
          </Link>
        ))}
      </div>

      {view === "overview" && <Overview tenantId={tenantId} window={window} vitals={vitals} />}
      {view === "sessions" && (
        <Sessions tenantId={tenantId} window={window} open={session} link={link} />
      )}
      {view === "errors" && <Errors tenantId={tenantId} window={window} />}
    </div>
  );
}

async function Empty() {
  const t = await getT();
  return (
    <div
      style={{
        ...CARD,
        padding: "28px 20px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("rum.emptyTitle")}</span>
      <span
        style={{
          fontSize: 12.5,
          color: "var(--ink-2)",
          lineHeight: 1.6,
          maxWidth: 620,
          margin: "0 auto",
        }}
      >
        {t("rum.emptyBody")}
      </span>
      <pre
        style={{
          ...MONO,
          textAlign: "left",
          background: "var(--sunk)",
          border: "1px solid var(--line)",
          borderRadius: 8,
          padding: "10px 12px",
          margin: "6px auto 0",
          maxWidth: 640,
          overflowX: "auto",
        }}
      >
        {'<script src="https://<your instance>/rum/oi-rum.js"\n' +
          '        data-app="<application id>"\n' +
          '        data-endpoint="https://otlp.<your workspace host>"\n' +
          "        defer></script>"}
      </pre>
      <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{t("rum.emptyWhere")}</span>
    </div>
  );
}

async function Overview({
  tenantId,
  window,
  vitals,
}: {
  tenantId: string;
  window: { sinceHours: number };
  vitals: Awaited<ReturnType<typeof rumVitals>>;
}) {
  const t = await getT();
  const [routes, devices, countries] = await Promise.all([
    rumRoutes(tenantId, window),
    rumSegments(tenantId, "device", window),
    rumSegments(tenantId, "country", window),
  ]);
  const byName = new Map(vitals.map((v) => [v.vital_name, v]));
  /*
   * Which tiles to draw.
   *
   * The web five are shown whenever a page has reported, and when nothing has
   * reported at all — that empty row is what tells somebody the screen works
   * and the traffic has not arrived. The mobile two are appended only when a
   * phone has actually sent them, because a workspace with no application has
   * no use for two permanently blank tiles, and one with only an application
   * should not be asked to read five.
   */
  const web = (["LCP", "INP", "CLS", "FCP", "TTFB"] as const).filter(() =>
    vitals.length === 0 ? true : vitals.some((v) => WEB_VITALS.has(v.vital_name)),
  );
  const mobile = (["app_start", "screen_load"] as const).filter((n) => byName.has(n));
  const shown: string[] = [...web, ...mobile];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${Math.max(1, shown.length)}, 1fr)`,
          gap: 1,
          background: "var(--line)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {shown.map((name) => {
          const row = byName.get(name);
          const value = row?.p75 ?? 0;
          return (
            <div key={name} style={{ background: "var(--panel)", padding: "12px 14px" }}>
              <div style={EYEBROW}>
                {WEB_VITALS.has(name) ? name : t(`rum.vital.${name}` as MessageKey)}
              </div>
              <div
                style={{ fontSize: 19, fontWeight: 600, color: tone(name, value), marginTop: 3 }}
              >
                {vitalText(name, value)}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 2 }}>
                {row ? t("rum.samples", { count: Number(row.samples) }) : t("rum.notMeasured")}
              </div>
            </div>
          );
        })}
      </div>
      <span style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.5 }}>
        {t("rum.p75Note")}
      </span>

      <div
        style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)", gap: 12 }}
      >
        <div style={{ ...CARD, overflow: "hidden" }} data-testid="rum-routes">
          <Head>{t("rum.byRoute")}</Head>
          {routes.map((r) => (
            <div
              key={r.route}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) 70px 90px 80px 70px",
                gap: 8,
                padding: "7px 14px",
                borderTop: "1px solid var(--line-2)",
                fontSize: 12,
                alignItems: "center",
              }}
            >
              <span style={{ ...MONO, overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.route || "/"}
              </span>
              <span style={{ ...MONO, color: "var(--ink-3)" }}>{r.views}</span>
              <span style={{ ...MONO, color: tone("LCP", r.lcp_p75) }}>
                {vitalText("LCP", r.lcp_p75)}
              </span>
              <span style={{ ...MONO, color: tone("CLS", r.cls_p75) }}>
                {vitalText("CLS", r.cls_p75)}
              </span>
              <span
                style={{ ...MONO, color: Number(r.errors) > 0 ? "var(--dang)" : "var(--ink-3)" }}
              >
                {r.errors}
              </span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Segment title={t("rum.byDevice")} rows={devices} />
          <Segment title={t("rum.byCountry")} rows={countries} />
        </div>
      </div>
    </div>
  );
}

async function Segment({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ segment: string; views: string; lcp_p75: number }>;
}) {
  const t = await getT();
  return (
    <div style={{ ...CARD, overflow: "hidden" }}>
      <Head>{title}</Head>
      {rows.length === 0 && (
        <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--ink-3)" }}>
          {t("rum.noSegment")}
        </div>
      )}
      {rows.map((r) => (
        <div
          key={r.segment || "?"}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) 60px 80px",
            gap: 8,
            padding: "7px 14px",
            borderTop: "1px solid var(--line-2)",
            fontSize: 12,
          }}
        >
          <span>{r.segment || t("rum.unknown")}</span>
          <span style={{ ...MONO, color: "var(--ink-3)" }}>{r.views}</span>
          <span style={{ ...MONO, color: tone("LCP", r.lcp_p75) }}>
            {vitalText("LCP", r.lcp_p75)}
          </span>
        </div>
      ))}
    </div>
  );
}

async function Sessions({
  tenantId,
  window,
  open,
  link,
}: {
  tenantId: string;
  window: { sinceHours: number };
  open?: string;
  link: (over: Record<string, string>) => string;
}) {
  const t = await getT();
  const rows = await rumSessions(tenantId, window);
  const [timeline, replayed] = await Promise.all([
    open
      ? rumSession(tenantId, open)
      : Promise.resolve([] as Awaited<ReturnType<typeof rumSession>>),
    // One query for the whole page of rows: the badge is worth a round trip,
    // not fifty.
    rumReplayed(
      tenantId,
      rows.map((r) => r.session_id),
    ),
  ]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: open ? "minmax(0,1fr) minmax(0,1.1fr)" : "1fr",
        gap: 12,
      }}
    >
      <div style={{ ...CARD, overflow: "hidden", alignSelf: "start" }} data-testid="rum-sessions">
        <Head>{t("rum.sessions")}</Head>
        {rows.length === 0 && (
          <div style={{ padding: "14px", fontSize: 12.5, color: "var(--ink-3)" }}>
            {t("rum.noSessions")}
          </div>
        )}
        {rows.map((s) => (
          <Link
            key={s.session_id}
            href={link({ session: s.session_id })}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) 60px 60px 80px",
              gap: 8,
              padding: "8px 14px",
              borderTop: "1px solid var(--line-2)",
              fontSize: 12,
              alignItems: "center",
              textDecoration: "none",
              color: "inherit",
              background: s.session_id === open ? "var(--sunk)" : "transparent",
            }}
          >
            <span style={{ minWidth: 0 }}>
              <span style={{ ...MONO, display: "block" }}>{s.session_id.slice(0, 12)}</span>
              <span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
                {s.started_at.slice(5, 16)} · {s.device}
                {s.country ? ` · ${s.country}` : ""} · {s.browser}
              </span>
            </span>
            <span style={{ ...MONO, color: "var(--ink-3)" }}>
              {t("rum.nViews", { count: Number(s.n_views) })}
            </span>
            <span
              style={{ ...MONO, color: Number(s.n_errors) > 0 ? "var(--dang)" : "var(--ink-3)" }}
            >
              {s.n_errors}
            </span>
            <span style={{ ...MONO, color: tone("LCP", s.lcp_p75) }}>
              {vitalText("LCP", s.lcp_p75)}
              {replayed.has(s.session_id) && (
                <span
                  data-testid="replay-badge"
                  title={t("rum.hasReplay")}
                  style={{ color: "var(--viol)", marginLeft: 5 }}
                >
                  ●
                </span>
              )}
            </span>
          </Link>
        ))}
      </div>

      {open && (
        <div style={{ ...CARD, overflow: "hidden" }} data-testid="rum-timeline">
          {replayed.has(open) && (
            <>
              <Head>{t("rum.replay")}</Head>
              <ReplayPlayer
                sessionId={open}
                labels={{
                  play: t("rum.replayPlay"),
                  loading: t("rum.replayLoading"),
                  failed: t("rum.replayFailed"),
                  empty: t("rum.replayEmpty"),
                  events: t("rum.replayEvents", { count: "{count}" }),
                  isolated: t("rum.replayIsolated"),
                }}
              />
            </>
          )}
          <Head>{t("rum.timeline")}</Head>
          {timeline.map((e, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "72px 100px minmax(0,1fr)",
                gap: 8,
                padding: "6px 14px",
                borderTop: "1px solid var(--line-2)",
                fontSize: 12,
                alignItems: "baseline",
              }}
            >
              <span style={{ ...MONO, color: "var(--ink-3)" }}>{e.at.slice(11, 19)}</span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: e.event_type === "error" ? "var(--dang)" : "var(--ink-2)",
                }}
              >
                {t(`rum.event.${e.event_type}` as MessageKey)}
              </span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {e.vital_name ? (
                  <span style={{ color: tone(e.vital_name, e.vital_value) }}>
                    {e.vital_name} {vitalText(e.vital_name, e.vital_value)}
                  </span>
                ) : e.error_type ? (
                  <span style={{ color: "var(--dang)" }}>
                    {e.error_type}: {e.error_message}
                  </span>
                ) : (
                  <span style={{ ...MONO, color: "var(--ink-3)" }}>{e.route || e.url}</span>
                )}
                {/* A browser error that carries a trace reaches the backend it
                    came from — the one link that makes RUM part of the rest. */}
                {e.trace_id && (
                  <Link
                    href={`/app/telemetry?tab=traces&trace=${e.trace_id}`}
                    style={{ marginLeft: 8, fontSize: 11, color: "var(--brand)" }}
                  >
                    {t("rum.openTrace")}
                  </Link>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

async function Errors({ tenantId, window }: { tenantId: string; window: { sinceHours: number } }) {
  const t = await getT();
  const rows = await rumErrors(tenantId, window);
  return (
    <div style={{ ...CARD, overflow: "hidden" }} data-testid="rum-errors">
      <Head>{t("rum.errors")}</Head>
      {rows.length === 0 && (
        <div style={{ padding: "14px", fontSize: 12.5, color: "var(--ink-3)" }}>
          {t("rum.noErrors")}
        </div>
      )}
      {rows.map((r, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) 90px 90px",
            gap: 10,
            padding: "8px 14px",
            borderTop: "1px solid var(--line-2)",
            fontSize: 12,
            alignItems: "center",
          }}
        >
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontWeight: 600, color: "var(--dang)" }}>
              {r.error_type}
            </span>
            <span
              style={{
                display: "block",
                color: "var(--ink-2)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {r.message}
            </span>
            <span style={{ ...MONO, fontSize: 10.5, color: "var(--ink-3)" }}>{r.route}</span>
          </span>
          <span style={{ ...MONO, color: "var(--ink)" }}>
            {t("rum.nTimes", { count: Number(r.occurrences) })}
          </span>
          <span style={{ ...MONO, color: "var(--ink-3)" }}>
            {t("rum.nPeople", { count: Number(r.sessions) })}
          </span>
        </div>
      ))}
    </div>
  );
}

function Head({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "10px 14px",
        borderBottom: "1px solid var(--line)",
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {children}
    </div>
  );
}
