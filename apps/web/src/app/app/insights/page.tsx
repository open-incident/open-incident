import Link from "next/link";
import { withTenant } from "@openincident/db";
import { AtlasInsightsTab } from "@/components/atlas/insights-tab";
import { getT, type Translate } from "@/i18n/server";
import { firstName } from "@/i18n/format";
import { isManager, requireMember } from "@/lib/session";
import { getWorkspace } from "@/lib/tenant";
import {
  change,
  followUpInsights,
  incidentInsights,
  pagerInsights,
  periodOf,
  uptimeInsights,
  type ChangeKind,
  type Stat,
} from "@/lib/insights";
import { getPayReport, getPayRules, listPayReports, previousPeriod } from "@/lib/pay";
import type { MessageKey } from "@/i18n/dictionaries/en";
import { PayTab } from "./pay-tab";
import { PeriodMenu } from "./period-menu";

/** The design's five tabs. On-call pay is reached from Pager load, at `?tab=pay`. */
const TABS = ["incidents", "atlas", "pager", "uptime", "followups"] as const;
type Tab = (typeof TABS)[number] | "pay";

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};

type Kpi = {
  label: string;
  value: string;
  delta: string;
  tone: "ok" | "dang" | "flat";
  sub: string;
};

/**
 * Insights — five questions, five tabs, and nothing invented.
 *
 * Test incidents and test alerts are excluded upstream, the current week is
 * drawn hatched because it is partial rather than falling, every figure is set
 * against the previous period of the same length, and a figure this instance
 * cannot measure is a dash rather than a zero.
 */
export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    days?: string;
    period?: string;
    saved?: string;
    error?: string;
  }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const sp = await searchParams;
  const tab: Tab =
    sp.tab === "pay"
      ? "pay"
      : (TABS as readonly string[]).includes(sp.tab ?? "")
        ? (sp.tab as Tab)
        : "incidents";
  const days = sp.days === "30" ? 30 : sp.days === "365" ? 365 : 90;
  const period = periodOf(days);
  const workspace = await getWorkspace();
  const tz = workspace?.timezone ?? "Europe/Paris";

  const header = (
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
        style={{ display: "flex", gap: 2, background: "var(--sunk)", borderRadius: 10, padding: 3 }}
      >
        {TABS.map((x) => (
          <Link
            key={x}
            data-testid={`insights-tab-${x}`}
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
      {tab !== "pay" && <PeriodMenu tab={tab} days={days} exportable />}
    </div>
  );

  const shell = (children: React.ReactNode) => (
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
      {header}
      {children}
    </div>
  );

  // ✦ Atlas: the whole tab — its four figures included — is Atlas's own block.
  if (tab === "atlas") return shell(<AtlasInsightsTab tenantId={tenant.id} days={days} />);

  // On-call pay reads a month, not a window of days, and nothing else here
  // needs it: it is loaded only when it is the one being shown.
  if (tab === "pay") {
    const payPeriod = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.period ?? "")
      ? sp.period!
      : previousPeriod(new Date(), tz);
    const pay = await withTenant(tenant.id, async (tx) => ({
      rules: await getPayRules(tx, tenant.id),
      report: await getPayReport(tx, tenant.id, payPeriod),
      history: await listPayReports(tx, tenant.id),
    }));
    return shell(
      <>
        <Link
          href={`/app/insights?tab=pager&days=${days}`}
          style={{
            fontSize: 12.5,
            color: "var(--ink-3)",
            textDecoration: "none",
            width: "fit-content",
          }}
        >
          {t("insights.backToPager")}
        </Link>
        <PayTab
          rules={pay.rules}
          period={payPeriod}
          report={pay.report}
          history={pay.history}
          manages={isManager(member)}
          memberId={member.id}
          saved={sp.saved}
          error={sp.error}
        />
      </>,
    );
  }

  const data = await withTenant(tenant.id, async (tx) => ({
    incidents: tab === "incidents" ? await incidentInsights(tx, tenant.id, period) : null,
    pager: tab === "pager" ? await pagerInsights(tx, tenant.id, period, tz) : null,
    uptime: tab === "uptime" ? await uptimeInsights(tx, tenant.id, period) : null,
    followUps: tab === "followups" ? await followUpInsights(tx, tenant.id, period) : null,
  }));

  const num = (v: number | null) => (v === null ? "—" : t.fmt.number(Math.round(v * 10) / 10));
  const mins = (v: number | null) =>
    v === null
      ? "—"
      : v >= 60
        ? t.fmt.duration(v)
        : `${t.fmt.number(v < 10 ? Math.round(v * 10) / 10 : Math.round(v))} min`;
  const pct = (v: number | null, digits = 0) =>
    v === null ? "—" : `${t.fmt.number(Math.round(v * 10 ** digits) / 10 ** digits)} %`;

  const sign = (n: number) => (Math.abs(n) < 1e-9 ? "±" : n > 0 ? "+" : "−");
  const fmt = {
    rel: (n: number) => `${sign(Math.round(n))}${t.fmt.number(Math.abs(Math.round(n)))} %`,
    count: (n: number) => `${sign(n)}${t.fmt.number(Math.abs(Math.round(n)))}`,
    tenth: (n: number) => `${sign(n)}${t.fmt.number(Math.abs(Math.round(n * 10) / 10))}`,
    pts: (n: number) =>
      `${sign(Math.round(n))}${t("insights.pts", { value: t.fmt.number(Math.abs(Math.round(n))) })}`,
    hundredths: (n: number) => `${sign(n)}${t.fmt.number(Math.abs(Math.round(n * 100) / 100))}`,
    duration: (n: number) => `${sign(Math.round(n))}${t.fmt.duration(Math.abs(n))}`,
    days: (n: number) =>
      `${sign(Math.round(n))}${t("insights.daysShort", { count: Math.abs(Math.round(n)) })}`,
  };

  const kpi = (
    label: string,
    value: string,
    stat: Stat,
    kind: ChangeKind,
    format: (n: number) => string,
    sub: string,
    lowerIsBetter: boolean,
  ): Kpi => {
    let c = change(stat, kind);
    let f = format;
    // A count that was zero before has no relative change: say by how much.
    if (c === null && kind === "rel" && stat.value !== null && stat.prev === 0) {
      c = stat.value;
      f = fmt.count;
    }
    if (c === null) return { label, value, delta: "", tone: "flat", sub };
    const flat = Math.abs(c) < 1e-9 || f(c).startsWith("±");
    return {
      label,
      value,
      delta: f(c),
      tone: flat ? "flat" : c < 0 === lowerIsBetter ? "ok" : "dang",
      sub,
    };
  };

  let kpis: Kpi[] = [];
  if (data.incidents) {
    const d = data.incidents;
    kpis = [
      kpi(
        t("insights.kpiIncidents"),
        num(d.count.value),
        d.count,
        "rel",
        fmt.rel,
        t("insights.vsPrevious", { count: days }),
        true,
      ),
      kpi(
        t("insights.kpiTta"),
        mins(d.mtta.value),
        d.mtta,
        "rel",
        fmt.rel,
        t("insights.median"),
        true,
      ),
      kpi(
        t("insights.kpiTtr"),
        mins(d.mttr.value),
        d.mttr,
        "rel",
        fmt.rel,
        t("insights.median"),
        true,
      ),
      kpi(
        d.highNames.length === 2 ? d.highNames.join(" + ").toUpperCase() : t("insights.kpiHigh"),
        num(d.high.value),
        d.high,
        "abs",
        fmt.count,
        t("insights.highSeverity"),
        true,
      ),
    ];
  } else if (data.pager) {
    const d = data.pager;
    kpis = [
      kpi(
        t("insights.kpiPages"),
        num(d.pages.value),
        d.pages,
        "rel",
        fmt.rel,
        t("insights.allSchedules"),
        true,
      ),
      kpi(
        t("insights.kpiNight"),
        num(d.night.value),
        d.night,
        "abs",
        fmt.count,
        t("insights.localTime"),
        true,
      ),
      kpi(
        t("insights.kpiAck"),
        mins(d.ackMedian.value),
        d.ackMedian,
        "abs",
        fmt.tenth,
        t("insights.pageToAck"),
        true,
      ),
      kpi(
        t("insights.kpiOffHours"),
        pct(d.offHours.value),
        d.offHours,
        "pts",
        fmt.pts,
        t("insights.shareOfPages"),
        true,
      ),
    ];
  } else if (data.uptime) {
    const d = data.uptime;
    const span = t("insights.daysShort", { count: days });
    kpis = [
      kpi(
        t("insights.kpiUptime"),
        pct(d.uptime.value, 2),
        d.uptime,
        "pts",
        fmt.hundredths,
        t("insights.allMonitors"),
        false,
      ),
      kpi(
        t("insights.kpiDowntime"),
        d.downtime.value === null ? "—" : t.fmt.duration(d.downtime.value),
        d.downtime,
        "abs",
        fmt.duration,
        span,
        true,
      ),
      kpi(
        t("insights.kpiDegradedTime"),
        d.degraded.value === null ? "—" : t.fmt.duration(d.degraded.value),
        d.degraded,
        "abs",
        fmt.duration,
        span,
        true,
      ),
      kpi(
        t("insights.kpiMonitors"),
        num(d.monitors.value),
        d.monitors,
        "abs",
        fmt.count,
        t("insights.active"),
        false,
      ),
    ];
  } else if (data.followUps) {
    const d = data.followUps;
    const worst = d.overdueList[0];
    kpis = [
      kpi(
        t("insights.kpiCreated"),
        num(d.created.value),
        d.created,
        "abs",
        fmt.count,
        t("insights.fromIncidentsCount", { count: d.createdFrom }),
        false,
      ),
      kpi(
        t("insights.kpiCompleted"),
        pct(d.closed.value),
        d.closed,
        "pts",
        fmt.pts,
        t("insights.doneOf", { done: d.done, total: d.created.value ?? 0 }),
        false,
      ),
      kpi(
        t("insights.kpiMedianClose"),
        d.closureDays.value === null
          ? "—"
          : t("insights.daysShort", { count: Math.round(d.closureDays.value) }),
        d.closureDays,
        "abs",
        fmt.days,
        t("insights.creationToDone"),
        true,
      ),
      kpi(
        t("insights.kpiOverdue"),
        num(d.overdue.value),
        d.overdue,
        "abs",
        fmt.count,
        worst
          ? t("insights.overdueWorst", { priority: worst.priority ?? "—", days: worst.daysLate })
          : t("insights.nothingOverdue"),
        true,
      ),
    ];
  }

  return shell(
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        {kpis.map((k) => (
          <div key={k.label} data-testid="insights-stat" style={{ ...CARD, padding: "13px 16px" }}>
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
              {k.delta && (
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    color:
                      k.tone === "ok"
                        ? "var(--ok)"
                        : k.tone === "dang"
                          ? "var(--dang)"
                          : "var(--ink-3)",
                  }}
                >
                  {k.delta}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {data.incidents && <IncidentsBody t={t} data={data.incidents} days={days} mins={mins} />}

      {data.pager && (
        <>
          <PagerBody t={t} data={data.pager} />
          <div
            style={{
              background: "var(--sunk)",
              borderRadius: "var(--radius-card)",
              padding: "12px 14px",
              fontSize: 12,
              lineHeight: 1.55,
              color: "var(--ink-2)",
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span style={{ flex: 1, minWidth: 240 }}>{t("insights.payLink")}</span>
            <Link
              href={`/app/insights?tab=pay&days=${days}`}
              data-testid="insights-pay-link"
              style={{ fontWeight: 600, color: "var(--brand)", textDecoration: "none" }}
            >
              {t("insights.payOpen")}
            </Link>
          </div>
        </>
      )}

      {(data.uptime || data.followUps) && (
        <div
          style={{
            border: "1px dashed var(--line)",
            borderRadius: "var(--radius-card)",
            padding: 26,
            textAlign: "center",
            fontSize: 13,
            color: "var(--ink-2)",
          }}
        >
          {t("insights.excludesTests")}
        </div>
      )}
    </>,
  );
}

function IncidentsBody({
  t,
  data,
  days,
  mins,
}: {
  t: Translate;
  data: Awaited<ReturnType<typeof incidentInsights>>;
  days: number;
  mins: (v: number | null) => string;
}) {
  const weeks = data.weekly;
  const maxWeek = Math.max(1, ...weeks.map((w) => w.count));
  const maxService = Math.max(1, ...data.byService.map((s) => s.count));
  const monthly = days > 120;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0,3fr) minmax(0,2fr)",
        gap: 12,
        alignItems: "start",
      }}
    >
      <div style={{ ...CARD, padding: "14px 18px" }} data-testid="insights-weekly">
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>
            {monthly ? t("insights.perMonth") : t("insights.perWeek")}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
            {monthly ? t("insights.partialMonth") : t("insights.partialWeek")}
          </span>
        </div>
        <div
          style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 130, marginTop: 14 }}
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
                title={t.fmt.dateCompact(w.label)}
                style={{
                  width: "100%",
                  borderRadius: "5px 5px 2px 2px",
                  height: `${Math.round((w.count / maxWeek) * 100)}%`,
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
        style={{ ...CARD, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 9 }}
        data-testid="insights-by-service"
      >
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("insights.byService")}</span>
        {data.byService.length === 0 ? (
          <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
            {t("insights.noneInPeriod")}
          </span>
        ) : (
          data.byService.map((s) => (
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
                    width: `${Math.round((s.count / maxService) * 100)}%`,
                  }}
                />
              </div>
              <span style={{ width: 24, textAlign: "right", fontWeight: 600 }}>{s.count}</span>
              <span style={{ width: 72, textAlign: "right", color: "var(--ink-3)" }}>
                {t("insights.mttrShort")} {mins(s.mttr)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PagerBody({ t, data }: { t: Translate; data: Awaited<ReturnType<typeof pagerInsights>> }) {
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
  // First names, as people call each other — the full name when two share one.
  const firsts = data.heat.map((h) => firstName(h.name));
  const label = (name: string) => {
    const f = firstName(name);
    return firsts.filter((x) => x === f).length > 1 ? name : f;
  };
  return (
    <div
      style={{ ...CARD, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}
      data-testid="insights-heat"
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("insights.pagesByHour")}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{t("insights.twoAmNote")}</span>
      </div>
      {data.heat.length === 0 ? (
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {t("insights.noPagesInPeriod")}
        </span>
      ) : (
        <>
          {data.heat.slice(0, 8).map((h) => (
            <div
              key={h.name}
              style={{
                display: "grid",
                gridTemplateColumns: "120px repeat(24,1fr)",
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
                {label(h.name)}
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
              gridTemplateColumns: "120px repeat(4,1fr)",
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
      {data.worstNight && (
        <div
          data-testid="insights-night"
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
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--dang)" }} />
          <strong>
            {t("insights.worstNight", {
              name: label(data.worstNight.name),
              count: data.worstNight.night,
            })}
          </strong>{" "}
          {t("insights.worstNightTail")}
        </div>
      )}
    </div>
  );
}
