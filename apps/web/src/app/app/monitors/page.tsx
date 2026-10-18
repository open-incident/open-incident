import Link from "next/link";
import { isTelemetryMonitor, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { canRespond, isManager, requireMember } from "@/lib/session";
import {
  listHeartbeatRows,
  listMonitors,
  monitorCapabilities,
  probeSummary,
  type BarState,
} from "@/lib/monitors";
import { listServices } from "@/lib/services";
import { NewMonitor } from "./new-monitor";
import { ago, everyLabel, monitorTypeKey } from "./format";

const STATE_TONE: Record<string, [string, string]> = {
  online: ["var(--ok-t)", "var(--ok)"],
  degraded: ["var(--wait-t)", "var(--wait)"],
  offline: ["var(--dang-t)", "var(--dang)"],
  paused: ["var(--sunk)", "var(--ink-3)"],
  waiting: ["var(--sunk)", "var(--ink-2)"],
};

const BAR: Record<BarState, string> = {
  online: "rgba(14,122,88,.55)",
  degraded: "var(--wait)",
  offline: "var(--dang)",
  none: "var(--line)",
};

const GRID = "minmax(0,1fr) 110px 200px 90px 110px 120px";

/**
 * Monitors — what the product watches itself (design: V2Monitors, "Monitors").
 *
 * The row is the whole story: what it is, how it is, ninety days of bars, its
 * uptime, its last answer and how long ago, and which service it belongs to.
 * A monitor that has never run says "waiting for first check" rather than
 * pretending to be online. Heartbeats — the dead-man's switch, an `IN` row —
 * sit in the same list and open their own card.
 */
export default async function MonitorsPage({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    error?: string;
    why?: string;
    type?: string;
    q?: string;
  }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { new: openNew, error, why, type, q } = await searchParams;

  const data = await withTenant(tenant.id, async (tx) => ({
    monitors: await listMonitors(tx, tenant.id),
    heartbeats: await listHeartbeatRows(tx, tenant.id),
    services: await listServices(tx, tenant.id),
    probes: await probeSummary(tx),
  }));
  const capabilities = {
    ...(await monitorCapabilities()),
    // "Incoming request" creates a heartbeat, which is a manager's to create.
    incoming: isManager(member) ? { ok: true } : { ok: false, why: "manager" },
  };
  const now = Date.now();

  type Row = {
    key: string;
    href: string;
    name: string;
    type: string;
    target: string;
    state: string;
    bars: BarState[];
    up: string;
    last: string;
    svc: string;
  };
  const rows: Row[] = [
    ...data.monitors.map((m) => ({
      key: m.id,
      href: `/app/monitors/${m.id}`,
      name: m.name,
      type: monitorTypeKey(m.type),
      target: m.target.replace(/^https?:\/\//, "") || "—",
      state: m.state,
      bars: m.state === "waiting" ? (Array(30).fill("none") as BarState[]) : m.bars90,
      up: m.uptime90 === null ? "—" : `${+m.uptime90.toFixed(2)} %`,
      last: m.lastCheckAt
        ? m.lastLatencyMs !== null && !isTelemetryMonitor(m.type)
          ? `${m.lastLatencyMs >= 1000 ? `${(m.lastLatencyMs / 1000).toFixed(1)} s` : `${m.lastLatencyMs} ms`} · ${ago(m.lastCheckAt, now)}`
          : ago(m.lastCheckAt, now)
        : "—",
      svc: m.serviceKey ?? "—",
    })),
    ...data.heartbeats.map((h) => ({
      key: `hb-${h.id}`,
      href: `/app/monitors/heartbeats#hb-${h.id}`,
      name: h.name,
      type: "IN",
      target: t("mon2.inTarget", { every: everyLabel(h.intervalSeconds) }),
      state: h.state,
      // A heartbeat keeps its last ping, not a history: its bars stay grey
      // rather than drawing ninety days of a green nobody measured.
      bars: Array(30).fill("none") as BarState[],
      up: "—",
      last: h.lastPingAt
        ? new Date(h.lastPingAt).toDateString() === new Date(now).toDateString()
          ? t("mon2.today", { time: t.fmt.time(h.lastPingAt, t.timeZone) })
          : t.fmt.relative(h.lastPingAt)
        : "—",
      svc: h.serviceKey ?? "—",
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const count = (s: string) => rows.filter((r) => r.state === s).length;
  const counts = {
    online: count("online"),
    degraded: count("degraded"),
    offline: count("offline"),
    waiting: count("waiting"),
    // Counted like the rest: a list of seven monitors whose header said
    // nothing because all seven were paused is a header that lies by omission.
    paused: count("paused"),
  };
  const mayEdit = canRespond(member);
  const where = data.probes.regions.join(", ");

  return (
    <div
      style={{
        maxWidth: 1160,
        margin: "0 auto",
        padding: "22px 28px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
      data-screen-label="Monitors"
    >
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
          {t("nav.monitors")}
        </h1>
        <span style={{ display: "flex", gap: 10, fontSize: 12.5 }} data-testid="monitor-counts">
          {counts.online > 0 && (
            <span style={{ color: "var(--ok)", fontWeight: 600 }}>
              {t("monitors.nOnline", { count: counts.online })}
            </span>
          )}
          {counts.degraded > 0 && (
            <span style={{ color: "var(--wait)", fontWeight: 600 }}>
              {t("monitors.nDegraded", { count: counts.degraded })}
            </span>
          )}
          {counts.offline > 0 && (
            <span style={{ color: "var(--dang)", fontWeight: 600 }}>
              {t("monitors.nOffline", { count: counts.offline })}
            </span>
          )}
          {counts.waiting > 0 && (
            <span style={{ color: "var(--ink-3)" }}>
              {t("monitors.nWaiting", { count: counts.waiting })}
            </span>
          )}
          {counts.paused > 0 && (
            <span style={{ color: "var(--ink-3)" }}>
              {t("monitors.nPaused", { count: counts.paused })}
            </span>
          )}
        </span>
        <span style={{ flex: 1 }} />
        {/*
          Where the checks come from. No probe is registered on most instances
          — the worker checks from wherever it runs — and the button says that
          rather than a region nobody configured.
        */}
        <Link
          href="/app/settings/probes"
          className="oi-hover"
          data-testid="monitors-checked-from"
          style={{
            height: 32,
            padding: "0 13px",
            border: "1px solid var(--line)",
            borderRadius: 9,
            background: "var(--panel)",
            display: "flex",
            alignItems: "center",
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
            color: "inherit",
            textDecoration: "none",
          }}
        >
          {data.probes.count > 0
            ? t("mon2.checkedFrom", { where, count: data.probes.count })
            : t("mon2.checkedFromInstance")}
        </Link>
        {mayEdit && (
          <NewMonitor
            capabilities={capabilities}
            initialOpen={!!openNew || !!type}
            initialType={type}
            initialQuery={q}
            services={data.services.map((s) => s.key)}
          />
        )}
      </div>

      {/*
        A refused creation used to come back to this list with the reason in
        the address bar and nowhere else, which reads as "the button does
        nothing". The reason is shown.
      */}
      {error && (
        <div
          role="alert"
          data-testid="monitors-error"
          style={{
            border: "1px solid var(--dang)",
            background: "var(--dang-t)",
            color: "var(--dang)",
            borderRadius: 11,
            padding: "11px 14px",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {error === "telemetry-query"
            ? t("monitors.error.telemetry-query", { why: why ?? t("monitors.error.missing") })
            : error === "steps"
              ? t("monitors.error.steps")
              : t("monitors.error.invalid")}
        </div>
      )}

      {rows.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--line)",
            borderRadius: "var(--radius-card)",
            padding: 28,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            alignItems: "flex-start",
            maxWidth: 640,
          }}
        >
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t("monitors.emptyTitle")}</div>
          <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
            {t("monitors.emptyBody")}
          </div>
        </div>
      ) : (
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-card)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: GRID,
              gap: 12,
              padding: "8px 16px",
              borderBottom: "1px solid var(--line)",
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
            }}
          >
            <span>{t("monitors.colMonitor")}</span>
            <span>{t("monitors.colStatus")}</span>
            <span>{t("mon2.colLast90")}</span>
            <span>{t("monitors.colUptime")}</span>
            <span>{t("monitors.colLastCheck")}</span>
            <span>{t("monitors.colService")}</span>
          </div>
          {rows.map((m) => {
            const tone = STATE_TONE[m.state] ?? STATE_TONE.waiting!;
            return (
              <Link
                key={m.key}
                href={m.href}
                className="oi-hover"
                data-testid="monitor-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: GRID,
                  gap: 12,
                  alignItems: "center",
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--line-2)",
                  textDecoration: "none",
                  color: "inherit",
                  cursor: "pointer",
                }}
              >
                <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                  <span
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {m.name}
                  </span>
                  <span
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      fontFamily: "var(--mono)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {m.type} · {m.target}
                  </span>
                </span>
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
                    width: "fit-content",
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: tone[1] }} />
                  {t(`monitors.state.${m.state}` as "monitors.state.online")}
                </span>
                <span style={{ display: "flex", gap: 1.5, alignItems: "flex-end" }}>
                  {m.bars.map((b, i) => (
                    <span
                      key={i}
                      style={{ flex: 1, height: 14, borderRadius: 1.5, background: BAR[b] }}
                    />
                  ))}
                </span>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    fontWeight: 600,
                    color: m.up === "—" ? "var(--ink-3)" : "var(--ok)",
                  }}
                >
                  {m.up}
                </span>
                <span style={{ fontSize: 12, color: "var(--ink-2)", fontFamily: "var(--mono)" }}>
                  {m.last}
                </span>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "var(--brand)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.svc}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
