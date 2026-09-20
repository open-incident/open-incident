import Link from "next/link";
import { and, count, desc, eq, gte, ne, sql } from "drizzle-orm";
import { changeEvents, incidents, services, withTenant } from "@openincident/db";
import { servicesOverview, type ServiceRow } from "@openincident/telemetry";
import { getT } from "@/i18n/server";
import type { LocaleFormat } from "@/i18n/format";

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};

const MONO: React.CSSProperties = { fontFamily: "var(--mono)" };

export const SERVICE_WINDOWS = [60, 360, 1440] as const;
export type ServiceWindowMinutes = (typeof SERVICE_WINDOWS)[number];

export function serviceWindowOf(value: string | undefined): ServiceWindowMinutes {
  const n = Number(value);
  return (SERVICE_WINDOWS as readonly number[]).includes(n) ? (n as ServiceWindowMinutes) : 60;
}

/**
 * Every service that has sent a span, and which one to look at first.
 *
 * The signals are stored under `service.name`, and that is all a service is
 * here — nothing has to be declared before it appears. The list is ordered by
 * traffic rather than by name: a table of forty services sorted alphabetically
 * makes the reader do the sorting.
 *
 * The line above it is the only thing on this screen that draws a conclusion,
 * and it only draws one it can show its work for: a service whose failures
 * have multiplied in the last quarter of the window, and — when one lines up —
 * the change that landed just before them. No model is involved; it is two
 * numbers and a timestamp, which is also why it can be wrong out loud rather
 * than confidently.
 */
export async function ServicesTab({
  tenantId,
  sinceMinutes,
}: {
  tenantId: string;
  sinceMinutes: ServiceWindowMinutes;
}) {
  const t = await getT();
  const rows = await servicesOverview(tenantId, sinceMinutes).catch(() => [] as ServiceRow[]);
  const known = await withTenant(tenantId, async (tx) => {
    const svc = await tx
      .select({ id: services.id, key: services.key, ownerTeamId: services.ownerTeamId })
      .from(services)
      .where(eq(services.tenantId, tenantId));
    const open = await tx
      .select({ serviceId: incidents.serviceId, n: count() })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), ne(incidents.phase, "closed")))
      .groupBy(incidents.serviceId);
    const changes = await tx
      .select({
        id: changeEvents.id,
        title: changeEvents.title,
        serviceId: changeEvents.serviceId,
        occurredAt: changeEvents.occurredAt,
      })
      .from(changeEvents)
      .where(
        and(
          eq(changeEvents.tenantId, tenantId),
          gte(changeEvents.occurredAt, sql`now() - (${sinceMinutes} * interval '1 minute')`),
        ),
      )
      .orderBy(desc(changeEvents.occurredAt))
      .limit(20);
    return { svc, open, changes };
  });

  const byKey = new Map(known.svc.map((s) => [s.key, s]));
  const openByService = new Map(known.open.map((o) => [o.serviceId, o.n]));

  const insight = findInsight(rows);
  const insightChange = insight
    ? (known.changes.find((c) => c.serviceId === byKey.get(insight.service)?.id) ?? null)
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="services-tab">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)", flex: 1 }}>
          {t("telemetry.servicesHint")}
        </span>
        {SERVICE_WINDOWS.map((m) => (
          <Link
            key={m}
            href={`/app/telemetry?tab=services&since=${m}`}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: "3px 9px",
              borderRadius: 7,
              textDecoration: "none",
              color: m === sinceMinutes ? "var(--ink)" : "var(--ink-3)",
              background: m === sinceMinutes ? "var(--panel)" : "transparent",
              border: `1px solid ${m === sinceMinutes ? "var(--line)" : "transparent"}`,
            }}
          >
            {m < 1440 ? `${m / 60} h` : "24 h"}
          </Link>
        ))}
      </div>

      {insight && (
        <div
          data-testid="services-insight"
          style={{
            ...CARD,
            padding: "11px 14px",
            borderColor: "var(--dang)",
            background: "var(--dang-t)",
            fontSize: 12.5,
            lineHeight: 1.55,
          }}
        >
          <span style={{ fontWeight: 600 }}>{insight.service}</span>{" "}
          {t("telemetry.servicesJump", {
            from: pct(t.fmt, insight.earlierErrorRate),
            to: pct(t.fmt, insight.recentErrorRate),
            errors: insight.recentErrors,
          })}
          {insightChange && (
            <> {t("telemetry.servicesAfterChange", { title: insightChange.title })}</>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{ ...CARD, padding: "30px 22px", textAlign: "center" }}>
          <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
            {t("telemetry.servicesEmpty")}
          </span>
        </div>
      ) : (
        <div style={{ ...CARD, overflow: "hidden" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) 90px 100px 90px 120px 90px",
              gap: 12,
              padding: "8px 16px",
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: ".07em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              background: "var(--sunk)",
            }}
          >
            <span>{t("telemetry.servicesService")}</span>
            <span style={{ textAlign: "right" }}>{t("telemetry.servicesRps")}</span>
            <span style={{ textAlign: "right" }}>{t("telemetry.servicesErrors")}</span>
            <span style={{ textAlign: "right" }}>p99</span>
            <span>{t("telemetry.servicesLatency")}</span>
            <span style={{ textAlign: "right" }}>{t("telemetry.servicesIncidents")}</span>
          </div>
          {rows.map((row) => {
            const svc = byKey.get(row.service);
            const open = svc ? (openByService.get(svc.id) ?? 0) : 0;
            const bad = row.errorRate >= 0.05;
            return (
              <div
                key={row.service}
                data-testid="service-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) 90px 100px 90px 120px 90px",
                  gap: 12,
                  alignItems: "center",
                  padding: "10px 16px",
                  borderTop: "1px solid var(--line-2)",
                  fontSize: 12.5,
                }}
              >
                <span style={{ minWidth: 0 }}>
                  {svc ? (
                    <Link
                      href={`/app/services/${svc.id}`}
                      style={{ fontWeight: 600, textDecoration: "none", color: "inherit" }}
                    >
                      {row.service}
                    </Link>
                  ) : (
                    <span style={{ fontWeight: 600 }}>{row.service}</span>
                  )}
                  {svc && !svc.ownerTeamId && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: "var(--ink-3)" }}>
                      {t("telemetry.servicesNoOwner")}
                    </span>
                  )}
                </span>
                <span style={{ ...MONO, textAlign: "right" }}>{t.fmt.decimal(row.rps, 2)}</span>
                <span
                  style={{
                    ...MONO,
                    textAlign: "right",
                    color: bad ? "var(--dang)" : "var(--ink-2)",
                    fontWeight: bad ? 600 : 400,
                  }}
                >
                  {pct(t.fmt, row.errorRate)}
                </span>
                <span style={{ ...MONO, textAlign: "right" }}>{ms(t.fmt, row.p99Ms)}</span>
                <Spark values={row.latency} />
                <span style={{ textAlign: "right" }}>
                  {open > 0 && svc ? (
                    // Its own page, where its incidents are listed. The
                    // incident list has no per-service filter, and linking to
                    // it unfiltered would be a link that lies about where it
                    // goes.
                    <Link
                      href={`/app/services/${svc.id}`}
                      style={{ color: "var(--dang)", fontWeight: 600, textDecoration: "none" }}
                    >
                      {open}
                    </Link>
                  ) : (
                    <span style={{ color: "var(--ink-3)" }}>—</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
        {t("telemetry.servicesFrom")}
      </div>
    </div>
  );
}

/**
 * The one service worth a sentence, or none.
 *
 * Three conditions together, because any one of them alone produces a banner
 * every day and a banner every day is wallpaper: the recent failure share has
 * to be at least double the earlier one, it has to be worth noticing on its
 * own (5 % of requests), and it has to be made of enough failures that the
 * ratio is not two requests out of three.
 */
function findInsight(rows: ServiceRow[]): ServiceRow | null {
  const candidates = rows.filter(
    (r) =>
      r.recentErrors >= 10 &&
      r.recentErrorRate >= 0.05 &&
      r.recentErrorRate >= Math.max(2 * r.earlierErrorRate, 0.01),
  );
  return candidates.sort((a, b) => b.recentErrorRate - a.recentErrorRate)[0] ?? null;
}

/** A sparkline, drawn rather than fetched — same reason as the dashboards' charts. */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <span style={{ color: "var(--ink-3)", fontSize: 11 }}>—</span>;
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  const span = hi - lo || 1;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${100 - ((v - lo) / span) * 90 - 5}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: 22 }}>
      <polyline
        points={points}
        fill="none"
        stroke="var(--brand)"
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/*
 * Both of these take the formatter rather than reaching for `toFixed`: a
 * decimal separator is a property of the reader's language, and "0.4 %" in a
 * French interface is the kind of detail that makes a product feel translated
 * rather than written.
 */
function pct(fmt: LocaleFormat, v: number): string {
  if (v === 0) return "0 %";
  if (v > 0 && v < 0.001) return `<${fmt.decimal(0.1)} %`;
  return `${fmt.decimal(v * 100)} %`;
}

function ms(fmt: LocaleFormat, v: number): string {
  if (v >= 1000) return `${fmt.decimal(v / 1000, 2)} s`;
  return `${fmt.number(Math.round(v))} ms`;
}
