import Link from "next/link";
import { withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { getWorkspace } from "@/lib/tenant";
import {
  delta,
  followUpInsights,
  incidentInsights,
  pagerInsights,
  periodOf,
  type Stat,
} from "@/lib/insights";
import { listMonitors } from "@/lib/monitors";
import type { MessageKey } from "@/i18n/dictionaries/en";

const TABS = ["incidents", "pager", "uptime", "followups"] as const;
type Tab = (typeof TABS)[number];

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};

/**
 * Insights — four questions, four tabs, and nothing invented.
 *
 * Test incidents and test alerts are excluded upstream, the current week is
 * drawn hatched because it is partial rather than falling, and a figure this
 * instance cannot measure is said to be unmeasurable instead of shown as zero.
 */
export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; days?: string }>;
}) {
  const { tenant } = await requireMember();
  const t = await getT();
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "")
    ? (sp.tab as Tab)
    : "incidents";
  const days = sp.days === "30" ? 30 : sp.days === "365" ? 365 : 90;
  const period = periodOf(days);
  const workspace = await getWorkspace();

  const data = await withTenant(tenant.id, async (tx) => ({
    incidents: await incidentInsights(tx, tenant.id, period),
    pager: await pagerInsights(tx, tenant.id, period, workspace?.timezone ?? "Europe/Paris"),
    followUps: await followUpInsights(tx, tenant.id, period),
    monitors: await listMonitors(tx, tenant.id),
  }));

  const num = (v: number | null, suffix = "") =>
    v === null ? "—" : `${t.fmt.number(Math.round(v * 10) / 10)}${suffix}`;
  const mins = (v: number | null) =>
    v === null
      ? "—"
      : v >= 60
        ? `${Math.floor(v / 60)} h ${String(Math.round(v % 60)).padStart(2, "0")}`
        : `${Math.round(v * 10) / 10} min`;

  const kpi = (
    label: string,
    value: string,
    stat: Stat,
    unit: "count" | "pct" | "minutes" | "days",
    sub: string,
    lowerIsBetter = false,
  ) => {
    const d = delta(stat, unit);
    const improving =
      d && stat.value !== null && stat.prev !== null
        ? lowerIsBetter
          ? stat.value <= stat.prev
          : stat.value >= stat.prev
        : null;
    return { label, value, deltaText: d?.text ?? "", improving, sub };
  };

  const uptimeAvg = (() => {
    const known = data.monitors.filter((m) => m.uptime90 !== null);
    if (known.length === 0) return null;
    return known.reduce((a, m) => a + m.uptime90!, 0) / known.length;
  })();

  const kpis =
    tab === "incidents"
      ? [
          kpi(
            t("insights.kpiIncidents"),
            num(data.incidents.count.value),
            data.incidents.count,
            "count",
            t("insights.vsPrevious", { count: days }),
            true,
          ),
          kpi(
            t("insights.kpiTta"),
            mins(data.incidents.mtta.value),
            data.incidents.mtta,
            "minutes",
            t("insights.median"),
            true,
          ),
          kpi(
            t("insights.kpiTtr"),
            mins(data.incidents.mttr.value),
            data.incidents.mttr,
            "minutes",
            t("insights.median"),
            true,
          ),
          kpi(
            t("insights.kpiHigh"),
            num(data.incidents.high.value),
            data.incidents.high,
            "count",
            t("insights.highSeverity"),
            true,
          ),
        ]
      : tab === "pager"
        ? [
            kpi(
              t("insights.kpiPages"),
              num(data.pager.pages.value),
              data.pager.pages,
              "count",
              t("insights.allSchedules"),
              true,
            ),
            kpi(
              t("insights.kpiNight"),
              num(data.pager.night.value),
              data.pager.night,
              "count",
              t("insights.localTime"),
              true,
            ),
            kpi(
              t("insights.kpiAck"),
              mins(data.pager.ackMedian.value),
              data.pager.ackMedian,
              "minutes",
              t("insights.pageToAck"),
              true,
            ),
            kpi(
              t("insights.kpiOffHours"),
              data.pager.offHours.value === null
                ? "—"
                : `${Math.round(data.pager.offHours.value)} %`,
              data.pager.offHours,
              "pct",
              t("insights.shareOfPages"),
              true,
            ),
          ]
        : tab === "uptime"
          ? [
              {
                label: t("insights.kpiUptime"),
                value: uptimeAvg === null ? "—" : `${uptimeAvg.toFixed(2)} %`,
                deltaText: "",
                improving: null,
                sub: t("insights.allMonitors"),
              },
              {
                label: t("insights.kpiMonitors"),
                value: String(data.monitors.length),
                deltaText: "",
                improving: null,
                sub: t("insights.active"),
              },
              {
                label: t("insights.kpiDegraded"),
                value: String(
                  data.monitors.filter((m) => m.state === "degraded" || m.state === "offline")
                    .length,
                ),
                deltaText: "",
                improving: null,
                sub: t("insights.rightNow"),
              },
              {
                label: t("insights.kpiWatched"),
                value: String(new Set(data.monitors.map((m) => m.serviceKey).filter(Boolean)).size),
                deltaText: "",
                improving: null,
                sub: t("insights.servicesWatched"),
              },
            ]
          : [
              kpi(
                t("insights.kpiCreated"),
                num(data.followUps.created.value),
                data.followUps.created,
                "count",
                t("insights.fromIncidents"),
              ),
              kpi(
                t("insights.kpiCompleted"),
                data.followUps.closed.value === null
                  ? "—"
                  : `${Math.round(data.followUps.closed.value)}`,
                data.followUps.closed,
                "pct",
                t("insights.ofCreated"),
              ),
              kpi(
                t("insights.kpiMedianClose"),
                data.followUps.closureDays.value === null
                  ? "—"
                  : `${Math.round(data.followUps.closureDays.value)} ${t("insights.days")}`,
                data.followUps.closureDays,
                "days",
                t("insights.creationToDone"),
                true,
              ),
              kpi(
                t("insights.kpiOverdue"),
                num(data.followUps.overdue.value),
                data.followUps.overdue,
                "count",
                t("insights.pastDue"),
                true,
              ),
            ];

  const weeks = data.incidents.weekly;
  const maxWeek = Math.max(1, ...weeks.map((w) => w.count));
  const maxService = Math.max(1, ...data.incidents.byService.map((s) => s.count));
  const heatColour = (v: number) =>
    v === 0
      ? "var(--sunk)"
      : v === 1
        ? "var(--brand-b)"
        : v === 2
          ? "var(--brand-2)"
          : v === 3
            ? "var(--brand)"
            : "var(--dang)";

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
          {t("nav.insights")}
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
              href={`/app/insights?tab=${x}&days=${days}`}
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
              {t(`insights.tab.${x}` as MessageKey)}
            </Link>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <div
          style={{
            display: "flex",
            gap: 2,
            background: "var(--sunk)",
            borderRadius: 9,
            padding: 3,
          }}
        >
          {[30, 90, 365].map((d) => (
            <Link
              key={d}
              href={`/app/insights?tab=${tab}&days=${d}`}
              style={{
                height: 26,
                padding: "0 10px",
                borderRadius: 7,
                background: days === d ? "var(--panel)" : "transparent",
                color: days === d ? "var(--ink)" : "var(--ink-3)",
                boxShadow: days === d ? "var(--shadow-card)" : "none",
                display: "flex",
                alignItems: "center",
                fontSize: 12,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              {t("insights.lastDays", { count: d })}
            </Link>
          ))}
        </div>
        <a
          href={`/api/insights/export?tab=${tab}&days=${days}`}
          className="oi-hover"
          style={{
            height: 32,
            padding: "0 12px",
            border: "1px solid var(--line)",
            borderRadius: 9,
            background: "var(--panel)",
            display: "flex",
            alignItems: "center",
            fontSize: 12.5,
            fontWeight: 600,
            textDecoration: "none",
            color: "inherit",
          }}
        >
          {t("insights.exportCsv")}
        </a>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ ...CARD, padding: "13px 16px" }}>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: ".08em",
                color: "var(--ink-3)",
              }}
            >
              {k.label}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 3 }}>
              <span
                style={{
                  fontFamily: "var(--title)",
                  fontSize: 24,
                  fontWeight: 600,
                  letterSpacing: "-.02em",
                }}
              >
                {k.value}
              </span>
              {k.deltaText && (
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: k.improving ? "var(--ok)" : "var(--dang)",
                  }}
                >
                  {k.deltaText}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {tab === "incidents" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,3fr) minmax(0,2fr)",
            gap: 12,
            alignItems: "start",
          }}
        >
          <div style={{ ...CARD, padding: "14px 18px" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("insights.perWeek")}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                {t("insights.partialWeek")}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: 6,
                height: 130,
                marginTop: 14,
              }}
            >
              {weeks.map((w) => (
                <div
                  key={w.label.toISOString()}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: 4,
                    height: "100%",
                  }}
                >
                  <span style={{ fontSize: 10, color: "var(--ink-3)" }}>{w.count}</span>
                  <div
                    title={t.fmt.dateTime(w.label, t.timeZone)}
                    style={{
                      width: "100%",
                      borderRadius: "5px 5px 2px 2px",
                      height: `${Math.max(2, (w.count / maxWeek) * 100)}%`,
                      background: w.partial
                        ? "repeating-linear-gradient(135deg,var(--brand-b) 0 4px,var(--sunk) 4px 8px)"
                        : "var(--brand)",
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
          <div
            style={{
              ...CARD,
              padding: "14px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 9,
            }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("insights.byService")}</span>
            {data.incidents.byService.length === 0 ? (
              <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                {t("insights.noneInPeriod")}
              </span>
            ) : (
              data.incidents.byService.map((s) => (
                <div
                  key={s.name}
                  style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}
                >
                  <span
                    style={{
                      width: 120,
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.name}
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 8,
                      borderRadius: 999,
                      background: "var(--sunk)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        background: "var(--brand)",
                        width: `${(s.count / maxService) * 100}%`,
                      }}
                    />
                  </div>
                  <span style={{ width: 24, textAlign: "right", fontWeight: 600 }}>{s.count}</span>
                  <span style={{ width: 78, textAlign: "right", color: "var(--ink-3)" }}>
                    {s.mttr === null ? "—" : `${t("insights.mttrShort")} ${mins(s.mttr)}`}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === "pager" && (
        <div
          style={{
            ...CARD,
            padding: "14px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("insights.pagesByHour")}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{t("insights.twoAmNote")}</span>
          </div>
          {data.pager.heat.length === 0 ? (
            <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
              {t("insights.noPagesInPeriod")}
            </span>
          ) : (
            <>
              {data.pager.heat.slice(0, 8).map((h) => (
                <div
                  key={h.name}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "120px repeat(24, 1fr)",
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
                    {h.name}
                  </span>
                  {h.hours.map((v, i) => (
                    <span
                      key={i}
                      title={`${String(i).padStart(2, "0")}:00 — ${v}`}
                      style={{ height: 20, borderRadius: 4, background: heatColour(v) }}
                    />
                  ))}
                </div>
              ))}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "120px repeat(4, 1fr)",
                  gap: 3,
                  fontSize: 10.5,
                  color: "var(--ink-3)",
                }}
              >
                <span />
                <span>00:00</span>
                <span>06:00</span>
                <span>12:00</span>
                <span>18:00</span>
              </div>
            </>
          )}
          {data.pager.worstNight && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "var(--dang-t)",
                borderRadius: 10,
                padding: "10px 13px",
                fontSize: 12.5,
              }}
            >
              <span
                style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--dang)" }}
              />
              <span>
                <strong>
                  {t("insights.worstNight", {
                    name: data.pager.worstNight.name,
                    count: data.pager.worstNight.night,
                  })}
                </strong>{" "}
                {t("insights.worstNightTail")}
              </span>
            </div>
          )}
        </div>
      )}

      {tab === "uptime" && (
        <div style={{ ...CARD, padding: 0, overflow: "hidden" }}>
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid var(--line)",
              fontSize: 13.5,
              fontWeight: 600,
            }}
          >
            {t("insights.byMonitor")}
          </div>
          {data.monitors.length === 0 ? (
            <div style={{ padding: 18, fontSize: 13, color: "var(--ink-2)" }}>
              {t("insights.noMonitors")}
            </div>
          ) : (
            data.monitors.map((m) => (
              <div
                key={m.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) 200px 90px",
                  gap: 12,
                  alignItems: "center",
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--line-2)",
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.name}
                </span>
                <span style={{ display: "flex", gap: 1.5, alignItems: "flex-end" }}>
                  {m.days.map((d) => (
                    <span
                      key={d.day}
                      style={{
                        flex: 1,
                        height: 14,
                        borderRadius: 1.5,
                        background:
                          d.state === "offline"
                            ? "var(--dang)"
                            : d.state === "degraded"
                              ? "var(--wait)"
                              : d.state === "online"
                                ? "rgba(14,122,88,.55)"
                                : "var(--line)",
                      }}
                    />
                  ))}
                </span>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    fontWeight: 600,
                    textAlign: "right",
                    color: m.uptime90 === null ? "var(--ink-3)" : "var(--ok)",
                  }}
                >
                  {m.uptime90 === null ? "—" : `${m.uptime90.toFixed(2)} %`}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "followups" && (
        <div style={{ ...CARD, padding: "14px 18px", fontSize: 13, color: "var(--ink-2)" }}>
          {t("insights.followUpsNote")}
        </div>
      )}

      <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("insights.excludesTests")}</div>
    </div>
  );
}
