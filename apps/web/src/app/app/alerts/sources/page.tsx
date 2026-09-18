import Link from "next/link";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { alertSources, alerts, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { sourceKindMeta } from "@/lib/alert-sources";
import { IntegrationIcon } from "../../settings/integrations/icons";
import { sourceChoices, urgentFrom, pageableSchedules, pageableTeams } from "./choices";
import { describePage, describeIncident } from "./describe";
import { ConnectTool } from "./connect-tool";

const DAY = 86_400_000;

/**
 * The sources, one card each.
 *
 * The card answers the only three questions a source raises — who it pages,
 * whether it opens an incident, whether it closes its own alerts — because a
 * list of tool names says nothing about what happens at three in the morning.
 */
export default async function AlertSourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; tested?: string; alert?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const params = await searchParams;
  const manages = isManager(member);

  const data = await withTenant(tenant.id, async (tx) => {
    const rows = await tx
      .select()
      .from(alertSources)
      .where(and(eq(alertSources.tenantId, tenant.id), eq(alertSources.managed, false)))
      .orderBy(asc(alertSources.name));
    const since = new Date(Date.now() - 90 * DAY);
    const counted = await tx
      .select({ sourceId: alerts.sourceId, n: sql<number>`count(*)::int`.mapWith(Number) })
      .from(alerts)
      .where(and(eq(alerts.tenantId, tenant.id), gte(alerts.lastAt, since)))
      .groupBy(alerts.sourceId);
    const choices = new Map(
      await Promise.all(
        rows.map(async (s) => [s.id, await sourceChoices(tx, tenant.id, s.id)] as const),
      ),
    );
    return {
      rows,
      counts: new Map(counted.map((c) => [c.sourceId, c.n])),
      choices,
      urgent: await urgentFrom(tx, tenant.id),
      teams: await pageableTeams(tx, tenant.id),
      schedules: await pageableSchedules(tx, tenant.id),
    };
  });

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
        href="/app/alerts"
        className="oi-link"
        style={{ fontSize: 12.5, color: "var(--ink-3)", width: "fit-content" }}
      >
        {t("alt2.sources.back")}
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--title)",
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-.015em",
          }}
        >
          {t("alt2.sources.title")}
        </h1>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("alt2.sources.subtitle")}</span>
        <span style={{ flex: 1 }} />
        {manages && (
          <ConnectTool
            initialOpen={Boolean(params.new)}
            initialKind={params.new && params.new !== "1" ? params.new : null}
            teams={data.teams.map((x) => ({ id: x.id, name: x.name }))}
            schedules={data.schedules}
            urgentFrom={data.urgent}
          />
        )}
      </div>

      {params.tested && (
        <div
          role="status"
          style={{
            padding: "9px 14px",
            borderRadius: 10,
            background: "var(--ok-t)",
            color: "var(--ok)",
            fontSize: 12.5,
            fontWeight: 600,
            display: "flex",
            gap: 10,
            alignItems: "center",
          }}
        >
          {t("alt2.sources.testSent")}
          {params.alert && (
            <Link
              href={`/app/alerts/${params.alert}`}
              className="oi-link"
              style={{ color: "var(--ok)" }}
            >
              {t("alt2.sources.openTestAlert")}
            </Link>
          )}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))",
          gap: 12,
        }}
      >
        {data.rows.map((s) => {
          const meta = sourceKindMeta(s.kind);
          const c = data.choices.get(s.id)!;
          const count = data.counts.get(s.id) ?? 0;
          const quietDays = s.lastAlertAt
            ? Math.floor((Date.now() - s.lastAlertAt.getTime()) / DAY)
            : null;
          const status = !s.active
            ? { label: t("alt2.sources.st.paused"), ink: "var(--ink-3)" }
            : c.route?.testMode
              ? { label: t("alt2.sources.st.test"), ink: "var(--viol)" }
              : quietDays === null
                ? { label: t("alt2.sources.st.waiting"), ink: "var(--wait)" }
                : quietDays >= 7
                  ? { label: t("alt2.sources.st.quiet", { count: quietDays }), ink: "var(--wait)" }
                  : { label: t("alt2.sources.st.receiving"), ink: "var(--ok)" };
          return (
            <Link
              key={s.id}
              href={`/app/alerts/sources/${s.id}`}
              data-testid="source-row"
              className="oi-hover-edge"
              style={{
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-card)",
                boxShadow: "var(--shadow-card)",
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                color: "inherit",
                textDecoration: "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 9,
                    background: "var(--sunk)",
                    display: "grid",
                    placeItems: "center",
                    color: "var(--ink)",
                    flex: "none",
                  }}
                >
                  <IntegrationIcon id={meta.icon} />
                </span>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.name}
                </span>
                <span style={{ flex: 1 }} />
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 11,
                    fontWeight: 600,
                    color: status.ink,
                    flex: "none",
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: status.ink,
                    }}
                  />
                  {status.label}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  fontSize: 12,
                  color: "var(--ink-2)",
                }}
              >
                <span>
                  <strong style={{ color: "var(--ink)" }}>{t("alt2.sources.pageLabel")}</strong>{" "}
                  {describePage(t, c.page, member.id)}
                </span>
                <span>
                  <strong style={{ color: "var(--ink)" }}>{t("alt2.sources.incidentLabel")}</strong>{" "}
                  {describeIncident(t, c.incident, data.urgent)}
                </span>
                <span>
                  <strong style={{ color: "var(--ink)" }}>{t("alt2.sources.autoLabel")}</strong>{" "}
                  {c.autoResolve ? t("common.on") : t("common.off")}
                </span>
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: "var(--ink-3)",
                  borderTop: "1px solid var(--line-2)",
                  paddingTop: 8,
                }}
              >
                {s.lastAlertAt
                  ? t("alt2.sources.meta", { count, when: t.fmt.relative(s.lastAlertAt) })
                  : t("alt2.sources.metaWaiting")}
              </div>
            </Link>
          );
        })}
      </div>
      {data.rows.length === 0 && (
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-card)",
            padding: 36,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t("alt2.sources.emptyTitle")}</div>
          <div style={{ fontSize: 13, color: "var(--ink-2)", maxWidth: 420, lineHeight: 1.5 }}>
            {t("alt2.sources.emptyText")}
          </div>
        </div>
      )}
    </div>
  );
}
