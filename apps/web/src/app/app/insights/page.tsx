import Link from "next/link";
import { withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import {
  alertInsights,
  delta,
  followUpInsights,
  incidentInsights,
  pagerInsights,
  periodOf,
  type Stat,
} from "@/lib/insights";
import { PeriodSelect } from "./period-select";
import { getSchedule, listSchedules, scheduleCoverage } from "@/lib/oncall";
import { getPayReport, getPayRules, listPayReports, previousPeriod } from "@/lib/pay";
import { PayTab } from "./pay-tab";
import { isManagerRole } from "@openincident/config";

type Tab = "incidents" | "alerts" | "pager" | "followups" | "pay";
const TABS: Tab[] = ["incidents", "alerts", "pager", "followups", "pay"];

/**
 * Reports, from the design: one period, compared with the previous one, four
 * tabs each with four numbers and the charts that explain them. Every figure
 * comes from the workspace's rows; test incidents are excluded; what cannot be
 * measured is said on screen, never simulated.
 */
export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    days?: string;
    compare?: string;
    period?: string;
    saved?: string;
    error?: string;
  }>;
}) {
  const { tenant, workspace, member } = await requireMember();
  const t = await getT();
  const q = await searchParams;
  const tab: Tab = TABS.includes(q.tab as Tab) ? (q.tab as Tab) : "incidents";
  const daysRaw = Number(q.days ?? 90);
  const days = daysRaw === 30 || daysRaw === 365 ? daysRaw : 90;
  const compare = q.compare !== "0";
  const period = periodOf(days);
  const data = await withTenant(tenant.id, async (tx) => {
    if (tab === "pay") {
      const payPeriod = /^\d{4}-(0[1-9]|1[0-2])$/.test(q.period ?? "")
        ? q.period!
        : previousPeriod(new Date(), workspace.timezone);
      return {
        pay: {
          period: payPeriod,
          rules: await getPayRules(tx, tenant.id),
          report: await getPayReport(tx, tenant.id, payPeriod),
          history: await listPayReports(tx, tenant.id),
        },
      };
    }
    if (tab === "alerts") return { alerts: await alertInsights(tx, tenant.id, period) };
    if (tab === "pager") {
      const pager = await pagerInsights(tx, tenant.id, period, workspace.timezone);
      // Coverage of the next sixty days, across published schedules.
      const now = new Date();
      let expected = 0;
      let covered = 0;
      let gaps = 0;
      for (const sch of (await listSchedules(tx, tenant.id)).filter(
        (x) => x.status === "published",
      )) {
        const detail = await getSchedule(tx, tenant.id, sch.id, { from: now, to: now }, now);
        if (!detail) continue;
        const c = scheduleCoverage(detail, now);
        const horizon = 60 * 24 * 60;
        expected += horizon;
        covered += Math.round(c.coveredRatio * horizon);
        gaps += c.gaps.length;
      }
      return {
        pager,
        coverage: expected ? { ratio: Math.round((covered / expected) * 1000) / 10, gaps } : null,
      };
    }
    if (tab === "followups") return { followups: await followUpInsights(tx, tenant.id, period) };
    return { incidents: await incidentInsights(tx, tenant.id, period) };
  });
  const href = (over: Partial<{ tab: Tab; days: number; compare: boolean }>) =>
    `/app/insights?tab=${over.tab ?? tab}&days=${over.days ?? days}&compare=${(over.compare ?? compare) ? 1 : 0}`;

  const fmtMin = (m: number | null) => (m === null ? "—" : t.fmt.duration(m));
  const fmtPct = (p: number | null) => (p === null ? "—" : `${p} %`);
  const fmtCount = (n: number | null) => (n === null ? "—" : t.fmt.number(n));
  const fmtDays = (d: number | null) =>
    d === null ? "—" : t("insights.days", { count: Math.round(d * 10) / 10 });
  type Card = {
    label: string;
    value: string;
    stat: Stat;
    unit: "count" | "pct" | "minutes" | "days";
    lowerIsBetter: boolean;
    sub: string;
  };
  const cards: Card[] = [];
  if (data.incidents) {
    const d = data.incidents;
    cards.push(
      {
        label: t("insights.inc.count"),
        value: fmtCount(d.count.value),
        stat: d.count,
        unit: "count",
        lowerIsBetter: true,
        sub:
          d.count.prev !== null && compare
            ? t("insights.vsPrev", { count: d.count.prev, days })
            : t("insights.inc.countSub"),
      },
      {
        label: "MTTA",
        value: fmtMin(d.mtta.value),
        stat: d.mtta,
        unit: "minutes",
        lowerIsBetter: true,
        sub: t("insights.inc.mttaSub"),
      },
      {
        label: "MTTR",
        value: fmtMin(d.mttr.value),
        stat: d.mttr,
        unit: "minutes",
        lowerIsBetter: true,
        sub: t("insights.inc.mttrSub"),
      },
      {
        label: t("insights.inc.high"),
        value: fmtCount(d.high.value),
        stat: d.high,
        unit: "count",
        lowerIsBetter: true,
        sub: t("insights.inc.highSub"),
      },
    );
  }
  if (data.alerts) {
    const d = data.alerts;
    cards.push(
      {
        label: t("insights.al.count"),
        value: fmtCount(d.count.value),
        stat: d.count,
        unit: "count",
        lowerIsBetter: true,
        sub: t("insights.al.countSub"),
      },
      {
        label: t("insights.al.conversion"),
        value: fmtPct(d.conversion.value),
        stat: d.conversion,
        unit: "pct",
        lowerIsBetter: false,
        sub: t("insights.al.conversionSub"),
      },
      {
        label: t("insights.al.auto"),
        value: fmtPct(d.autoResolved.value),
        stat: d.autoResolved,
        unit: "pct",
        lowerIsBetter: true,
        sub: t("insights.al.autoSub"),
      },
      {
        label: t("insights.al.sources"),
        value: fmtCount(d.activeSources.value),
        stat: d.activeSources,
        unit: "count",
        lowerIsBetter: false,
        sub: t("insights.al.sourcesSub"),
      },
    );
  }
  if (data.pager) {
    const d = data.pager;
    cards.push(
      {
        label: t("insights.pg.pages"),
        value: fmtCount(d.pages.value),
        stat: d.pages,
        unit: "count",
        lowerIsBetter: true,
        sub: t("insights.pg.pagesSub"),
      },
      {
        label: t("insights.pg.night"),
        value: fmtCount(d.night.value),
        stat: d.night,
        unit: "count",
        lowerIsBetter: true,
        sub: t("insights.pg.nightSub"),
      },
      {
        label: t("insights.pg.ack"),
        value: fmtMin(d.ackMedian.value),
        stat: d.ackMedian,
        unit: "minutes",
        lowerIsBetter: true,
        sub: t("insights.pg.ackSub"),
      },
      {
        label: t("insights.pg.offHours"),
        value: fmtPct(d.offHours.value),
        stat: d.offHours,
        unit: "pct",
        lowerIsBetter: true,
        sub: t("insights.pg.offHoursSub"),
      },
    );
  }
  if (data.followups) {
    const d = data.followups;
    cards.push(
      {
        label: t("insights.fu.created"),
        value: fmtCount(d.created.value),
        stat: d.created,
        unit: "count",
        lowerIsBetter: false,
        sub: t("insights.fu.createdSub"),
      },
      {
        label: t("insights.fu.closed"),
        value: fmtPct(d.closed.value),
        stat: d.closed,
        unit: "pct",
        lowerIsBetter: false,
        sub: t("insights.fu.closedSub"),
      },
      {
        label: t("insights.fu.closure"),
        value: fmtDays(d.closureDays.value),
        stat: d.closureDays,
        unit: "days",
        lowerIsBetter: true,
        sub: t("insights.fu.closureSub"),
      },
      {
        label: t("insights.fu.overdue"),
        value: fmtCount(d.overdue.value),
        stat: d.overdue,
        unit: "count",
        lowerIsBetter: true,
        sub: d.overdueList[0]
          ? t("insights.fu.overdueSub", {
              priority: d.overdueList[0].priority ?? "—",
              days: d.overdueList[0].daysLate,
            })
          : t("insights.fu.overdueNone"),
      },
    );
  }

  const panel: React.CSSProperties = {
    background: "var(--panel)",
    border: "1px solid var(--line)",
    borderRadius: 14,
    padding: "16px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  };
  const h: React.CSSProperties = { fontSize: 14, fontWeight: 600 };
  const sub: React.CSSProperties = { fontWeight: 400, fontSize: 12, color: "var(--ink-3)" };
  const bar = (w: number, color: string) => (
    <div
      style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--sunk)", overflow: "hidden" }}
    >
      <div
        style={{
          height: "100%",
          borderRadius: 4,
          background: color,
          width: `${Math.max(0, Math.min(100, w))}%`,
        }}
      />
    </div>
  );
  const sevTone = (name: string) =>
    /1$/.test(name)
      ? "var(--dang)"
      : /2$/.test(name)
        ? "var(--wait)"
        : /3$/.test(name)
          ? "var(--open)"
          : "var(--ink-3)";
  const heatColor = (v: number) =>
    v === 0
      ? "var(--sunk)"
      : v === 1
        ? "var(--brand-t)"
        : v === 2
          ? "var(--brand-b)"
          : v === 3
            ? "var(--brand-2)"
            : "var(--dang)";
  const empty = (text: string) => (
    <div style={{ fontSize: 12.5, color: "var(--ink-3)", padding: "6px 0" }}>{text}</div>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          flex: "none",
          background: "var(--panel)",
          borderBottom: "1px solid var(--line)",
          padding: "14px 22px 0",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 className="oi-title" style={{ margin: 0 }}>
            {t("insights.title")}
          </h1>
          <span style={{ flex: 1 }} />
          {tab !== "pay" && <PeriodSelect days={days} tab={tab} compare={compare} />}
          <Link
            href={href({ compare: !compare })}
            data-testid="insights-compare"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12.5,
              color: "var(--ink-2)",
              textDecoration: "none",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 38,
                height: 22,
                borderRadius: 999,
                background: compare ? "var(--brand)" : "var(--line)",
                position: "relative",
                display: "inline-block",
                transition: "background .15s",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 2.5,
                  left: compare ? 18 : 3,
                  width: 17,
                  height: 17,
                  borderRadius: "50%",
                  background: "#fff",
                  boxShadow: "0 1px 3px rgba(0,0,0,.25)",
                  transition: "left .15s",
                }}
              />
            </span>
            {t("insights.compare")}
          </Link>
          <a
            href={`/api/insights/export?tab=${tab}&days=${days}`}
            className="oi-hover"
            data-testid="insights-export"
            style={{
              height: 34,
              padding: "0 13px",
              border: "1px solid var(--line)",
              borderRadius: 9,
              background: "var(--panel)",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              fontWeight: 500,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            ↓ {t("insights.exportCsv")}
          </a>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {TABS.map((tb) => (
            <Link
              key={tb}
              href={href({ tab: tb })}
              data-testid={`insights-tab-${tb}`}
              style={{
                padding: "10px 15px",
                fontSize: 13.5,
                fontWeight: tb === tab ? 600 : 500,
                color: tb === tab ? "var(--ink)" : "var(--ink-3)",
                borderBottom: `2px solid ${tb === tab ? "var(--brand)" : "transparent"}`,
                textDecoration: "none",
              }}
            >
              {t(`insights.tab.${tb}`)}
            </Link>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 22px 28px" }}>
        <div
          className="oi-rise"
          style={{ maxWidth: 1100, display: "flex", flexDirection: "column", gap: 14 }}
        >
          {cards.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              {cards.map((c) => {
                const diff =
                  c.stat.value !== null && c.stat.prev !== null ? c.stat.value - c.stat.prev : 0;
                const good = diff === 0 ? null : c.lowerIsBetter ? diff < 0 : diff > 0;
                const sign = diff >= 0 ? "+" : "−";
                const d = !compare
                  ? null
                  : c.unit === "minutes"
                    ? { text: `${sign}${fmtMin(Math.abs(Math.round(diff)))}` }
                    : c.unit === "days"
                      ? { text: `${sign}${fmtDays(Math.abs(diff))}` }
                      : delta(c.stat, c.unit);
                return (
                  <div
                    key={c.label}
                    data-testid="insights-stat"
                    style={{
                      background: "var(--panel)",
                      border: "1px solid var(--line)",
                      borderRadius: 13,
                      padding: "14px 17px",
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)" }}>
                      {c.label}
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginTop: 4 }}>
                      <span
                        style={{
                          fontFamily: "var(--font-title)",
                          fontSize: 24,
                          fontWeight: 600,
                          letterSpacing: "-.01em",
                        }}
                      >
                        {c.value}
                      </span>
                      {d && (
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color:
                              good === null ? "var(--ink-3)" : good ? "var(--ok)" : "var(--dang)",
                          }}
                        >
                          {diff === 0 ? "±0" : d.text}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 3 }}>
                      {c.sub}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {data.incidents && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,3fr) minmax(0,2fr)",
                gap: 14,
              }}
            >
              <div style={panel}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={h}>
                    {days <= 120 ? t("insights.inc.weekly") : t("insights.inc.monthly")}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                    {t("insights.inc.partialNote")}
                  </span>
                </div>
                {(() => {
                  const max = Math.max(1, ...data.incidents.weekly.map((w) => w.count));
                  return (
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 140 }}>
                      {data.incidents.weekly.map((w, i) => (
                        <div
                          key={i}
                          title={`${t.fmt.dateShort(w.label)} — ${w.count}`}
                          style={{
                            flex: 1,
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                            height: "100%",
                            justifyContent: "flex-end",
                            alignItems: "center",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 10.5,
                              fontWeight: 600,
                              color: "var(--ink-3)",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {w.count}
                          </span>
                          <div
                            style={{
                              width: "100%",
                              borderRadius: "5px 5px 3px 3px",
                              background: w.partial ? "var(--brand-t)" : "var(--brand)",
                              height: Math.max(3, Math.round((w.count / max) * 110)),
                              border: w.partial ? "1.5px dashed var(--brand-b)" : "none",
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  );
                })()}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 10.5,
                    color: "var(--ink-3)",
                  }}
                >
                  {data.incidents.weekly
                    .filter(
                      (_, i, a) =>
                        i % Math.max(1, Math.floor(a.length / 4)) === 0 && i < a.length - 1,
                    )
                    .map((w, i) => (
                      <span key={i}>{t.fmt.dayMonth(w.label)}</span>
                    ))}
                  <span>{t("insights.inc.thisPeriod")}</span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={panel}>
                  <span style={h}>{t("insights.inc.bySeverity")}</span>
                  {data.incidents.bySeverity.length === 0 && empty(t("insights.none"))}
                  {(() => {
                    const max = Math.max(1, ...data.incidents.bySeverity.map((b) => b.count));
                    return data.incidents.bySeverity.map((b) => (
                      <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span
                          style={{
                            width: 40,
                            fontFamily: "var(--font-mono)",
                            fontSize: 11.5,
                            fontWeight: 500,
                            color: sevTone(b.name),
                          }}
                        >
                          {b.name}
                        </span>
                        {bar((b.count / max) * 100, sevTone(b.name))}
                        <span
                          style={{
                            width: 24,
                            fontSize: 12,
                            fontWeight: 600,
                            fontVariantNumeric: "tabular-nums",
                            textAlign: "right",
                          }}
                        >
                          {b.count}
                        </span>
                      </div>
                    ));
                  })()}
                </div>
                <div style={{ ...panel, gap: 9 }}>
                  <span style={h}>
                    {t("insights.inc.byService")}{" "}
                    <span style={sub}>· {t("insights.inc.catalogDimension")}</span>
                  </span>
                  {data.incidents.byService.length === 0 && empty(t("insights.none"))}
                  {data.incidents.byService.map((b) => (
                    <div
                      key={b.name}
                      style={{ display: "flex", alignItems: "center", fontSize: 12.5 }}
                    >
                      <span style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12 }}>
                        {b.name}
                      </span>
                      <span
                        style={{ width: 32, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
                      >
                        {b.count}
                      </span>
                      <span
                        style={{
                          width: 96,
                          color: "var(--ink-3)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        MTTR {fmtMin(b.mttr)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {data.alerts && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
                gap: 14,
              }}
            >
              <div style={panel}>
                <span style={h}>{t("insights.al.bySource")}</span>
                {data.alerts.bySource.length === 0 && empty(t("insights.none"))}
                {(() => {
                  const max = Math.max(1, ...data.alerts.bySource.map((b) => b.count));
                  return data.alerts.bySource.map((b, i) => (
                    <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span
                        style={{
                          width: 96,
                          fontSize: 12.5,
                          fontWeight: 500,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {b.name}
                      </span>
                      {bar((b.count / max) * 100, i === 0 ? "var(--brand)" : "var(--brand-b)")}
                      <span
                        style={{
                          width: 34,
                          fontSize: 12,
                          fontWeight: 600,
                          fontVariantNumeric: "tabular-nums",
                          textAlign: "right",
                        }}
                      >
                        {b.count}
                      </span>
                    </div>
                  ));
                })()}
              </div>
              <div style={panel}>
                <span style={h}>
                  {t("insights.al.noisy")} <span style={sub}>· {t("insights.al.noisySub")}</span>
                </span>
                {data.alerts.noisy.length === 0 && empty(t("insights.none"))}
                {data.alerts.noisy.map((n, i) => (
                  <div
                    key={n.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      border: "1px solid var(--line)",
                      borderRadius: 10,
                      padding: "9px 12px",
                      fontSize: 12.5,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        fontVariantNumeric: "tabular-nums",
                        color: i === 0 ? "var(--dang)" : "var(--wait)",
                        flex: "none",
                      }}
                    >
                      {n.count}×
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {n.title}
                    </span>
                    <Link
                      href={
                        n.routeId
                          ? `/app/settings/alert-routes?edit=${n.routeId}`
                          : `/app/alerts/${n.alertId}`
                      }
                      className="oi-hover"
                      style={{
                        height: 28,
                        padding: "0 11px",
                        border: "1px solid var(--line)",
                        borderRadius: 8,
                        background: "var(--panel)",
                        display: "flex",
                        alignItems: "center",
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: "var(--brand)",
                        textDecoration: "none",
                        flex: "none",
                      }}
                    >
                      {n.routeId ? t("insights.al.adjustRoute") : t("insights.al.openAlert")}
                    </Link>
                  </div>
                ))}
                <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
                  {data.alerts.autoResolved.value === null
                    ? t("insights.al.autoNoteNone")
                    : t("insights.al.autoNote", { pct: data.alerts.autoResolved.value })}
                </div>
              </div>
            </div>
          )}

          {data.pager && (
            <div style={{ ...panel, gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <span style={h}>{t("insights.pg.heatTitle")}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                  {t("insights.pg.heatNote")}
                </span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 760 }}>
                  {data.pager.heat.length === 0 && empty(t("insights.pg.none"))}
                  {data.pager.heat.map((row) => (
                    <div
                      key={row.name}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "130px repeat(24, 1fr)",
                        gap: 3,
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12.5,
                          fontWeight: 500,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {row.name}
                      </span>
                      {row.hours.map((v, hr) => (
                        <span
                          key={hr}
                          title={`${row.name} · ${String(hr).padStart(2, "0")}:00 — ${v}`}
                          style={{ height: 22, borderRadius: 5, background: heatColor(v) }}
                        />
                      ))}
                    </div>
                  ))}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "130px repeat(24, 1fr)",
                      gap: 3,
                    }}
                  >
                    <span />
                    {["00:00", "06:00", "12:00", "18:00"].map((l) => (
                      <span
                        key={l}
                        style={{ gridColumn: "span 6", fontSize: 10.5, color: "var(--ink-3)" }}
                      >
                        {l}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 11.5,
                  color: "var(--ink-3)",
                }}
              >
                <span>0</span>
                {[0, 1, 2, 3, 4].map((v) => (
                  <span
                    key={v}
                    style={{ width: 14, height: 14, borderRadius: 4, background: heatColor(v) }}
                  />
                ))}
                <span>4+</span>
              </div>
              {"coverage" in data && data.coverage && (
                <div
                  data-testid="insights-coverage"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 12.5,
                    color: "var(--ink-2)",
                    borderTop: "1px solid var(--line-2)",
                    paddingTop: 10,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: data.coverage.gaps ? "var(--wait)" : "var(--ok)",
                      flex: "none",
                    }}
                  />
                  <span>
                    {t("insights.pg.coverage", {
                      ratio: data.coverage.ratio,
                      gaps: data.coverage.gaps,
                    })}
                  </span>
                  <Link
                    href="/app/on-call"
                    className="oi-link"
                    style={{ marginLeft: "auto", fontWeight: 600 }}
                  >
                    {t("insights.pg.coverageLink")}
                  </Link>
                </div>
              )}
              {data.pager.worstNight && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    background: "var(--dang-t)",
                    border: "1px solid var(--dang)",
                    borderRadius: 11,
                    padding: "10px 14px",
                    fontSize: 12.5,
                    color: "var(--ink-2)",
                    lineHeight: 1.5,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "var(--dang)",
                      flex: "none",
                    }}
                  />
                  <span>
                    <strong>
                      {t("insights.pg.nightBanner", {
                        name: data.pager.worstNight.name,
                        count: data.pager.worstNight.night,
                      })}
                    </strong>{" "}
                    {t("insights.pg.nightBannerNote")}
                  </span>
                </div>
              )}
            </div>
          )}

          {"pay" in data && data.pay && (
            <PayTab
              rules={data.pay.rules}
              period={data.pay.period}
              report={data.pay.report}
              history={data.pay.history}
              manages={isManagerRole(member)}
              memberId={member.id}
              saved={q.saved}
              error={q.error}
            />
          )}
          {data.followups && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
                gap: 14,
              }}
            >
              <div style={panel}>
                <span style={h}>
                  {t("insights.fu.byTeam")} <span style={sub}>· {t("insights.fu.vsPolicy")}</span>
                </span>
                {data.followups.byTeam.length === 0 && empty(t("insights.fu.noTeam"))}
                {data.followups.byTeam.map((b) => (
                  <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        width: 86,
                        fontSize: 12.5,
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {b.name}
                    </span>
                    {bar(b.rate, b.rate >= 75 ? "var(--ok)" : "var(--wait)")}
                    <span
                      style={{
                        width: 44,
                        fontSize: 12,
                        fontWeight: 600,
                        fontVariantNumeric: "tabular-nums",
                        textAlign: "right",
                      }}
                    >
                      {b.rate} %
                    </span>
                  </div>
                ))}
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {t("insights.fu.closureLine", {
                    days: fmtDays(data.followups.closureDays.value),
                    target:
                      data.followups.p1TargetDays === null
                        ? "—"
                        : t("insights.days", { count: data.followups.p1TargetDays }),
                  })}
                </div>
              </div>
              <div style={panel}>
                <span style={h}>{t("insights.fu.overdueNow")}</span>
                {data.followups.overdueList.length === 0 && empty(t("insights.fu.overdueNone"))}
                {data.followups.overdueList.map((o) => (
                  <Link
                    key={o.id}
                    href={`/app/incidents/${o.incidentNumber}?tab=follow-ups`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      border: "1px solid var(--dang)",
                      background: "var(--dang-t)",
                      borderRadius: 10,
                      padding: "10px 13px",
                      fontSize: 12.5,
                      textDecoration: "none",
                      color: "inherit",
                    }}
                  >
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "var(--panel)",
                        color: "var(--dang)",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {o.priority ?? "—"}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontWeight: 500,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {o.title}
                    </span>
                    <span style={{ color: "var(--dang)", fontWeight: 700, flex: "none" }}>
                      {t("insights.fu.daysLate", { count: o.daysLate })}
                    </span>
                  </Link>
                ))}
                <Link
                  href="/app/incidents?view=follow-ups"
                  className="oi-link"
                  style={{ fontSize: 12.5, fontWeight: 600 }}
                >
                  {t("insights.fu.openView")}
                </Link>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--ink-3)",
                    borderTop: "1px solid var(--line-2)",
                    paddingTop: 9,
                    lineHeight: 1.5,
                  }}
                >
                  {t("insights.footnote")}
                </div>
              </div>
            </div>
          )}
          {!data.followups && (
            <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
              {t("insights.footnote")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
