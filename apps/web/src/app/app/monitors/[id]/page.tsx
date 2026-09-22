import Link from "next/link";
import { notFound } from "next/navigation";
import { isTelemetryMonitor, withTenant, type TelemetryQuery } from "@openincident/db";
import { getT } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
import { readMonitorChoices } from "@/lib/monitor-choices";
import { getMonitor, monitorCapabilities } from "@/lib/monitors";
import {
  checkNow,
  deleteMonitor,
  deleteMonitorSecret,
  saveMonitorCriteria,
  saveMonitorSecret,
  saveSyntheticJourney,
  togglePause,
} from "../actions";
import { JourneyEditor } from "../journey-editor";
import { JourneyCard } from "./journey-card";
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

/** The left-hand sides a criterion can read, in the order the editor lists them. */
const CRITERION_FIELDS = [
  "reachable",
  "status_code",
  "response_time_ms",
  "body_contains",
  "body_matches",
  "header",
  "days_to_expiry",
  "record_value",
  "ping_received_in",
] as const;

/** The editor's controls: small enough that four fit across a sidebar card. */
const MICRO: React.CSSProperties = {
  height: 26,
  minWidth: 0,
  flex: 1,
  border: "1px solid var(--line)",
  borderRadius: 7,
  padding: "0 6px",
  fontSize: 11.5,
  background: "var(--panel)",
};

const OP_LABEL: Record<string, string> = {
  eq: "=",
  neq: "≠",
  lt: "<",
  lte: "≤",
  gt: ">",
  gte: "≥",
  contains: "contains",
  not_contains: "does not contain",
  matches: "matches",
};

/** One monitor: how it is, how it got there, and what it does when it breaks. */
export default async function MonitorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; queued?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { id } = await params;
  const { error, queued } = await searchParams;

  const m = await withTenant(tenant.id, (tx) => getMonitor(tx, tenant.id, id));
  if (!m) notFound();
  // Read from the rule, not from the monitor row: the rule is what the next
  // alert obeys, and the two would drift the moment someone edits it.
  const choices = await withTenant(tenant.id, (tx) => readMonitorChoices(tx, tenant.id, id));
  const mayEdit = canRespond(member);
  const telemetry = isTelemetryMonitor(m.type);
  const tone = STATE_TONE[m.state] ?? STATE_TONE.waiting!;
  // A journey that is not being played is worth saying out loud, on the
  // monitor's own page: the reader is looking at it because it has not moved.
  const runnerLive = m.journey ? (await monitorCapabilities()).synthetic?.ok : true;

  const latencies = m.checks
    .filter((c) => c.latencyMs !== null)
    .slice(0, 48)
    .reverse();
  const maxLatency = Math.max(1, ...latencies.map((c) => c.latencyMs!));

  const downtimeText =
    m.downtime90Seconds >= 3600
      ? `${Math.floor(m.downtime90Seconds / 3600)} h ${Math.floor((m.downtime90Seconds % 3600) / 60)}`
      : `${Math.floor(m.downtime90Seconds / 60)} min`;

  return (
    <div
      className="oi-rise"
      style={{
        maxWidth: 1160,
        margin: "0 auto",
        padding: "22px 28px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <Link
        href="/app/monitors"
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
              {t(`monitors.state.${m.state}` as MessageKey)}
            </span>
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              {t("monitors.metaLine", {
                type: m.type.toUpperCase(),
                every:
                  m.intervalSeconds % 3600 === 0
                    ? t("monitors.everyHours", { count: m.intervalSeconds / 3600 })
                    : m.intervalSeconds % 60 === 0
                      ? t("monitors.everyMinutes", { count: m.intervalSeconds / 60 })
                      : t("monitors.everySeconds", { count: m.intervalSeconds }),
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
              {m.target}
            </div>
          )}
        </div>
        {mayEdit && (
          <div style={{ display: "flex", gap: 8, flex: "none", flexWrap: "wrap" }}>
            <form action={togglePause}>
              <input type="hidden" name="id" value={m.id} />
              <button type="submit" className="oi-hover" style={GHOST}>
                {m.paused ? t("monitors.resume") : t("monitors.pause")}
              </button>
            </form>
            {m.type !== "manual" && m.type !== "incoming" && (
              <form action={checkNow}>
                <input type="hidden" name="id" value={m.id} />
                <button type="submit" className="oi-hover" style={GHOST}>
                  {t("monitors.checkNow")}
                </button>
              </form>
            )}
            {/*
              A monitor could be created and never removed: the action existed
              and no screen called it. Here rather than in a menu, next to the
              other two things one does to a monitor.
            */}
            <form action={deleteMonitor}>
              <input type="hidden" name="id" value={m.id} />
              <button
                type="submit"
                data-testid="monitor-delete"
                className="oi-hover-dang"
                style={{ ...GHOST, color: "var(--dang)" }}
              >
                {t("monitors.delete")}
              </button>
            </form>
          </div>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 320px",
          gap: 14,
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 1,
              background: "var(--line)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {(telemetry
              ? [
                  /*
                    A telemetry monitor never reached out, so it has no uptime
                    and no latency to show. What it does have is series: how
                    many it is watching, and how many of them are breaching.
                  */
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
                    ink: m.series.some((s) => s.state === "breaching" || s.state === "no_data")
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
                    v: m.lastCheckAt ? m.lastCheckAt.toLocaleTimeString() : "—",
                    ink: "var(--ink)",
                  },
                ]
              : [
                  {
                    l: t("monitors.kpiUptime"),
                    v: m.uptime90 === null ? "—" : `${m.uptime90.toFixed(2)} %`,
                    ink: m.uptime90 === null ? "var(--ink-3)" : "var(--ok)",
                  },
                  {
                    l: t("monitors.kpiNow"),
                    v: m.lastLatencyMs !== null ? `${m.lastLatencyMs} ms` : "—",
                    ink: "var(--ink)",
                  },
                  {
                    l: t("monitors.kpiChecks"),
                    v: String(m.checks.length),
                    ink: "var(--ink)",
                  },
                  {
                    l: t("monitors.kpiDowntime"),
                    v: m.downtime90Seconds > 0 ? downtimeText : "0",
                    ink: "var(--ink)",
                  },
                ]
            ).map((k) => (
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

          {m.journey && !runnerLive && (
            <div
              style={{
                border: "1px solid var(--wait)",
                background: "var(--wait-t)",
                borderRadius: 12,
                padding: "11px 14px",
                fontSize: 12.5,
                lineHeight: 1.5,
              }}
            >
              {t("synthetic.runnerOffline")}
            </div>
          )}
          {queued && (
            <div
              style={{
                border: "1px solid var(--line)",
                background: "var(--sunk)",
                borderRadius: 12,
                padding: "11px 14px",
                fontSize: 12.5,
              }}
            >
              {t("synthetic.runQueued")}
            </div>
          )}
          {error && (
            <div
              style={{
                border: "1px solid var(--dang)",
                background: "var(--dang-t)",
                borderRadius: 12,
                padding: "11px 14px",
                fontSize: 12.5,
                lineHeight: 1.5,
              }}
            >
              {t(
                (error === "no-runner"
                  ? "synthetic.errorNoRunner"
                  : error === "secret"
                    ? "synthetic.errorSecret"
                    : "synthetic.errorSteps") as MessageKey,
              )}
            </div>
          )}

          {m.journey && (
            <JourneyCard
              monitorId={m.id}
              journey={m.journey}
              lastCheck={m.checks[0] ? { id: m.checks[0].id, result: m.checks[0].result } : null}
            />
          )}

          {m.journey && mayEdit && (
            <details style={{ ...CARD, gap: 10 }}>
              <summary style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                {t("synthetic.editJourney")}
              </summary>
              <form action={saveSyntheticJourney} style={{ display: "grid", gap: 12 }}>
                <input type="hidden" name="id" value={m.id} />
                <JourneyEditor initial={m.journey} />
                <button
                  type="submit"
                  data-testid="journey-save"
                  style={{
                    height: 32,
                    padding: "0 14px",
                    borderRadius: 9,
                    background: "var(--brand)",
                    color: "var(--on-brand)",
                    border: 0,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    width: "fit-content",
                  }}
                >
                  {t("synthetic.saveJourney")}
                </button>
              </form>
            </details>
          )}

          {/*
            The series, which is what a telemetry monitor actually has. One row
            per alert it could raise, with what it last measured and why — so
            a person can tell "nothing is wrong" from "nothing is arriving"
            without opening a query console.
          */}
          {telemetry && (
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
                  /*
                    A series can be breaching and not yet firing: `for` holds
                    it for a few runs. Showing only the published state would
                    print "within range" next to a detail reading "1 > 0",
                    which is the screen contradicting itself. The holding is
                    its own word, in its own colour.
                  */
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
          )}

          {latencies.length > 0 && (
            <div style={{ ...CARD, gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {t("monitors.responseTime")}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                  {t("monitors.lastChecks", { count: latencies.length })}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 2,
                  justifyContent: "flex-start",
                  height: 80,
                }}
              >
                {latencies.map((c, i) => (
                  <span
                    key={i}
                    title={`${c.latencyMs} ms`}
                    style={{
                      flex: 1,
                      maxWidth: 18,
                      borderRadius: "2px 2px 0 0",
                      background: c.state === "online" ? "var(--brand-b)" : "var(--wait)",
                      height: `${Math.max(4, (c.latencyMs! / maxLatency) * 100)}%`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/*
            Recent checks, for the types that make one. A telemetry monitor
            writes series rather than checks, and an empty table promising a
            first check that will never come is worse than no table.
          */}
          {!telemetry && (
            <div style={{ ...CARD, padding: 0, gap: 0 }}>
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
              {m.checks.length === 0 ? (
                <div style={{ padding: "16px", fontSize: 13, color: "var(--ink-2)" }}>
                  {t("monitors.noChecksYet")}
                </div>
              ) : (
                m.checks.slice(0, 8).map((c, i) => {
                  const ct = STATE_TONE[c.state] ?? STATE_TONE.waiting!;
                  return (
                    <div
                      key={i}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "70px 96px minmax(0,1fr) 84px",
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
                          color: ct[1],
                        }}
                      >
                        <span
                          style={{ width: 6, height: 6, borderRadius: "50%", background: ct[1] }}
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
                      <span style={{ fontFamily: "var(--mono)", textAlign: "right" }}>
                        {c.latencyMs !== null ? `${c.latencyMs} ms` : "—"}
                      </span>
                    </div>
                  );
                })
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
            <div style={CARD}>
              <div style={EYEBROW}>{t("monitors.criteria")}</div>
              {m.criteria.length === 0 && (
                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                  {t("monitors.noCriteria")}
                </div>
              )}
              {m.criteria.map((c, i) => {
                const dot =
                  c.then === "online"
                    ? "var(--ok)"
                    : c.then === "degraded"
                      ? "var(--wait)"
                      : "var(--dang)";
                return (
                  <div key={i} style={{ display: "flex", gap: 8, fontSize: 12.5, lineHeight: 1.5 }}>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: dot,
                        marginTop: 7,
                        flex: "none",
                      }}
                    />
                    <span>
                      {t(`monitors.on.${c.on}` as MessageKey)}{" "}
                      <span style={{ fontFamily: "var(--mono)" }}>
                        {OP_LABEL[c.op] ?? c.op} {c.value}
                      </span>{" "}
                      →{" "}
                      <strong style={{ color: dot }}>
                        {t(`monitors.state.${c.then}` as MessageKey)}
                      </strong>
                    </span>
                  </div>
                );
              })}
              {/*
                The creation form calls these "default criteria · editable
                later". This is the later. Folded away because the reader who
                opened this page during an incident wants to read the rules,
                not edit them — and one click is a small price for a form that
                is not in the way the other ninety-nine times.
              */}
              {mayEdit && (
                <details data-testid="criteria-edit">
                  <summary style={{ cursor: "pointer", fontSize: 11.5, color: "var(--ink-3)" }}>
                    {t("monitors.editCriteria")}
                  </summary>
                  <form
                    action={saveMonitorCriteria}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      marginTop: 8,
                    }}
                  >
                    <input type="hidden" name="id" value={m.id} />
                    {[...m.criteria, null].map((c, i) => (
                      <div
                        key={i}
                        data-testid="criterion-row"
                        style={{ display: "flex", gap: 4, alignItems: "center" }}
                      >
                        <select
                          name="on"
                          defaultValue={c?.on ?? "response_time_ms"}
                          className="oi-field"
                          style={MICRO}
                        >
                          {CRITERION_FIELDS.map((f) => (
                            <option key={f} value={f}>
                              {t(`monitors.on.${f}` as MessageKey)}
                            </option>
                          ))}
                        </select>
                        <select
                          name="op"
                          defaultValue={c?.op ?? "gt"}
                          className="oi-field"
                          style={{ ...MICRO, width: 64, flex: "none" }}
                        >
                          {Object.keys(OP_LABEL).map((op) => (
                            <option key={op} value={op}>
                              {OP_LABEL[op]}
                            </option>
                          ))}
                        </select>
                        <input
                          name="value"
                          defaultValue={c?.value ?? ""}
                          placeholder={t("monitors.criterionValue")}
                          className="oi-field"
                          style={{ ...MICRO, width: 78, flex: "none" }}
                        />
                        <select
                          name="then"
                          defaultValue={c?.then ?? "degraded"}
                          className="oi-field"
                          style={{ ...MICRO, width: 96, flex: "none" }}
                        >
                          {(["online", "degraded", "offline"] as const).map((st) => (
                            <option key={st} value={st}>
                              {t(`monitors.state.${st}` as MessageKey)}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                      <button
                        type="submit"
                        data-testid="criteria-save"
                        style={{
                          height: 26,
                          padding: "0 10px",
                          border: "1px solid var(--line)",
                          borderRadius: 8,
                          background: "var(--panel)",
                          fontSize: 11.5,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {t("common.save")}
                      </button>
                      <span style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.4 }}>
                        {t("monitors.criteriaNote")}
                      </span>
                    </div>
                  </form>
                </details>
              )}
            </div>
          )}

          <div style={CARD}>
            <div style={EYEBROW}>{t("monitors.whenOffline")}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              <strong>{t("monitors.page")}:</strong>{" "}
              {choices.choices.page.kind === "owner"
                ? t("monitors.pageOwner")
                : choices.choices.page.kind === "nobody"
                  ? t("monitors.pageNobody")
                  : (choices.pageName ?? t("monitors.pageSomeone"))}{" "}
              · <strong>{t("monitors.incident")}:</strong>{" "}
              {t(`monitors.incidentFrom.${choices.choices.incident}` as MessageKey)} ·{" "}
              <strong>{t("monitors.autoResolve")}:</strong>{" "}
              {choices.choices.autoResolve ? t("common.on") : t("common.off")}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              {t(choices.own ? "monitors.choicesRule" : "monitors.sameThreeChoices")}
            </div>
          </div>

          {m.journey && mayEdit && (
            <div style={CARD}>
              <div style={EYEBROW}>{t("synthetic.credentials")}</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.45 }}>
                {t("synthetic.credentialsHint")}
              </div>
              {m.secretNames.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                  {t("synthetic.secretsNone")}
                </div>
              ) : (
                m.secretNames.map((name) => (
                  <div
                    key={name}
                    style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}
                  >
                    <span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{name}</span>
                    <span style={{ color: "var(--ink-3)", fontSize: 11.5 }}>
                      {t("synthetic.secretStored")}
                    </span>
                    <span style={{ flex: 1 }} />
                    <form action={deleteMonitorSecret}>
                      <input type="hidden" name="id" value={m.id} />
                      <input type="hidden" name="name" value={name} />
                      <button
                        type="submit"
                        style={{
                          border: 0,
                          background: "none",
                          color: "var(--dang)",
                          fontSize: 11.5,
                          cursor: "pointer",
                        }}
                      >
                        {t("synthetic.remove")}
                      </button>
                    </form>
                  </div>
                ))
              )}
              {/* Written, never read back: the field is empty every time,
                  because there is nothing to prefill it with. */}
              <form action={saveMonitorSecret} style={{ display: "grid", gap: 6 }}>
                <input type="hidden" name="id" value={m.id} />
                <input
                  name="name"
                  required
                  pattern="[A-Za-z0-9_]{1,64}"
                  placeholder="PASSWORD"
                  className="oi-field"
                  style={{ ...SECRET_FIELD, fontFamily: "var(--mono)" }}
                />
                <input
                  name="value"
                  type="password"
                  required
                  autoComplete="new-password"
                  placeholder={t("synthetic.secretValue")}
                  className="oi-field"
                  style={SECRET_FIELD}
                />
                <button
                  type="submit"
                  data-testid="monitor-secret-save"
                  style={{
                    height: 30,
                    borderRadius: 8,
                    border: "1px solid var(--line)",
                    background: "var(--panel)",
                    color: "inherit",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {t("synthetic.secretSave")}
                </button>
              </form>
            </div>
          )}

          {m.serviceKey && (
            <div style={CARD}>
              <div style={EYEBROW}>{t("monitors.service")}</div>
              <Link
                href={`/app/services`}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "var(--brand)",
                  textDecoration: "none",
                }}
              >
                {m.serviceKey}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const SECRET_FIELD: React.CSSProperties = {
  height: 30,
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "0 9px",
  fontSize: 12.5,
  outline: "none",
  background: "var(--panel)",
  color: "inherit",
  width: "100%",
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
};
