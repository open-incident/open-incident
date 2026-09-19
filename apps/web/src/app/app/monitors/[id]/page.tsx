import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
import { readMonitorChoices } from "@/lib/monitor-choices";
import { getMonitor } from "@/lib/monitors";
import { checkNow, deleteMonitor, togglePause } from "../actions";
import type { MessageKey } from "@/i18n/dictionaries/en";

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
export default async function MonitorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { id } = await params;

  const m = await withTenant(tenant.id, (tx) => getMonitor(tx, tenant.id, id));
  if (!m) notFound();
  // Read from the rule, not from the monitor row: the rule is what the next
  // alert obeys, and the two would drift the moment someone edits it.
  const choices = await withTenant(tenant.id, (tx) => readMonitorChoices(tx, tenant.id, id));
  const mayEdit = canRespond(member);
  const tone = STATE_TONE[m.state] ?? STATE_TONE.waiting!;

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
            {[
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
            ].map((k) => (
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
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={CARD}>
            <div style={EYEBROW}>{t("monitors.criteria")}</div>
            {m.criteria.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                {t("monitors.noCriteria")}
              </div>
            ) : (
              m.criteria.map((c, i) => {
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
              })
            )}
          </div>

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
