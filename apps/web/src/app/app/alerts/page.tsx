import Link from "next/link";
import { headers } from "next/headers";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  alertSources,
  alerts,
  escalationEvents,
  escalations,
  members,
  withTenant,
} from "@openincident/db";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { requestOrigin } from "@/lib/tenant";
import { listAlerts, type AlertListRow } from "@/lib/alerts";
import { curlSnippet } from "@/lib/alert-sources";
import { priorityChip } from "./tone";

type Tab = "firing" | "acked" | "resolved";

/**
 * Alerts — one table, three tabs.
 *
 * Firing is what nobody has taken yet, Acknowledged what somebody has, and
 * Resolved what closed itself or was closed. The row says in one line who is
 * being paged for it, because that is the only question a responder has in
 * front of a list of alerts.
 */
export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const params = await searchParams;
  const manages = isManager(member);
  const tab: Tab =
    params.view === "resolved" ? "resolved" : params.view === "acked" ? "acked" : "firing";

  const data = await withTenant(tenant.id, async (tx) => {
    const [counts] = await tx
      .select({
        firing:
          sql<number>`count(*) filter (where ${alerts.status} = 'firing' and ${alerts.groupId} is null and ${alerts.ackedAt} is null)`.mapWith(
            Number,
          ),
        acked:
          sql<number>`count(*) filter (where ${alerts.status} = 'firing' and ${alerts.groupId} is null and ${alerts.ackedAt} is not null)`.mapWith(
            Number,
          ),
        resolved:
          sql<number>`count(*) filter (where ${alerts.status} = 'resolved' and ${alerts.groupId} is null)`.mapWith(
            Number,
          ),
      })
      .from(alerts)
      .where(eq(alerts.tenantId, tenant.id));
    const all = await listAlerts(tx, tenant.id, tab === "resolved" ? "resolved" : "firing");
    const rows =
      tab === "resolved" ? all : all.filter((a) => (tab === "acked" ? a.acked : !a.acked));
    const ids = rows.map((r) => r.id);
    const ackers = ids.length
      ? await tx
          .select({ id: alerts.id, name: members.name })
          .from(alerts)
          .leftJoin(members, eq(members.id, alerts.ackedByMemberId))
          .where(inArray(alerts.id, ids))
      : [];
    const escRows = ids.length
      ? await tx
          .select({
            id: escalations.id,
            alertId: escalations.alertId,
            status: escalations.status,
          })
          .from(escalations)
          .where(and(eq(escalations.tenantId, tenant.id), inArray(escalations.alertId, ids)))
      : [];
    const escIds = escRows.map((e) => e.id);
    const notified = escIds.length
      ? await tx
          .select({
            escalationId: escalationEvents.escalationId,
            payload: escalationEvents.payload,
          })
          .from(escalationEvents)
          .where(
            and(
              inArray(escalationEvents.escalationId, escIds),
              inArray(escalationEvents.kind, ["notified", "retried"]),
            ),
          )
          .orderBy(asc(escalationEvents.occurredAt))
      : [];
    const [sourceCount] = await tx
      .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
      .from(alertSources)
      .where(and(eq(alertSources.tenantId, tenant.id), eq(alertSources.managed, false)));
    const [sample] = await tx
      .select({ id: alertSources.id, kind: alertSources.kind })
      .from(alertSources)
      .where(and(eq(alertSources.tenantId, tenant.id), eq(alertSources.managed, false)))
      .orderBy(asc(alertSources.createdAt))
      .limit(1);
    return {
      counts: counts ?? { firing: 0, acked: 0, resolved: 0 },
      rows,
      ackers,
      escRows,
      notified,
      sourceCount: sourceCount?.n ?? 0,
      sample: sample ?? null,
    };
  });

  // The last people a level really notified, per escalation — the "Paging …" column.
  const pagedBy = new Map<string, string[]>();
  for (const e of data.notified) {
    const who = Array.isArray(e.payload.members) ? (e.payload.members as string[]) : [];
    if (who.length) pagedBy.set(e.escalationId, who);
  }
  const escOf = new Map(data.escRows.map((e) => [e.alertId ?? "", e]));
  const ackerOf = new Map(data.ackers.map((a) => [a.id, a.name]));

  const who = (a: AlertListRow): string => {
    if (a.testMode) return t("alt2.list.who.test");
    if (a.status === "resolved")
      return a.incidentNumber
        ? t("alt2.list.who.resolvedIncident", { number: a.incidentNumber })
        : t("alt2.list.who.resolved");
    if (a.acked) {
      const name = ackerOf.get(a.id);
      return name ? t("alt2.list.who.acked", { name }) : t("alt2.list.who.ackedNoName");
    }
    const esc = escOf.get(a.id);
    if (!esc) return t("alt2.list.who.nobody");
    if (esc.status !== "pending") return t("alt2.list.who.escalationEnded");
    const names = pagedBy.get(esc.id) ?? [];
    return names.length
      ? t("alt2.list.who.paging", { name: names.join(", ") })
      : t("alt2.list.who.pagingSoon");
  };

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: "firing", label: t("alt2.list.tab.firing"), count: data.counts.firing },
    { id: "acked", label: t("alt2.list.tab.acked"), count: data.counts.acked },
    { id: "resolved", label: t("alt2.list.tab.resolved"), count: data.counts.resolved },
  ];

  const h = await headers();
  const origin = requestOrigin({
    headers: h,
    nextUrl: new URL(`http://${h.get("host") ?? "localhost"}/`),
  });
  const curl = data.sample
    ? curlSnippet(`${origin}/api/ingest/alerts/${data.sample.id}`, data.sample.kind)
    : null;

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
          {t("alt2.list.title")}
        </h1>
        <nav
          aria-label={t("alt2.list.tabsLabel")}
          style={{
            display: "flex",
            gap: 2,
            background: "var(--sunk)",
            borderRadius: 10,
            padding: 3,
          }}
        >
          {tabs.map((x) => {
            const on = x.id === tab;
            return (
              <Link
                key={x.id}
                aria-current={on ? "page" : undefined}
                href={`/app/alerts?view=${x.id}`}
                style={{
                  height: 28,
                  padding: "0 12px",
                  borderRadius: 8,
                  background: on ? "var(--panel)" : "transparent",
                  color: on ? "var(--ink)" : "var(--ink-3)",
                  boxShadow: on ? "var(--shadow-card)" : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12.5,
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                {x.label}
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, opacity: 0.7 }}>
                  {x.count}
                </span>
              </Link>
            );
          })}
        </nav>
        <span style={{ flex: 1 }} />
        <Link
          href="/app/alerts/sources"
          className="oi-hover"
          style={{
            height: 32,
            padding: "0 13px",
            border: "1px solid var(--line)",
            borderRadius: 9,
            background: "var(--panel)",
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontSize: 12.5,
            fontWeight: 600,
            color: "inherit",
            textDecoration: "none",
          }}
        >
          {t("alt2.list.sources", { count: data.sourceCount })}
        </Link>
        {manages && (
          <Link
            href="/app/alerts/sources?new=1"
            className="oi-hover-brand-2"
            style={{
              height: 32,
              padding: "0 13px",
              borderRadius: 9,
              background: "var(--brand)",
              color: "var(--on-brand)",
              display: "flex",
              alignItems: "center",
              fontSize: 12.5,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {t("alt2.list.connect")}
          </Link>
        )}
      </div>

      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-card)",
          overflowX: "auto",
        }}
      >
        {data.rows.map((a) => {
          const chip = priorityChip(a.priorityRank);
          return (
            <Link
              key={a.id}
              href={`/app/alerts/${a.id}`}
              data-testid="alert-card"
              className="oi-hover"
              style={{
                display: "grid",
                gridTemplateColumns: "8px 44px minmax(260px,1fr) 150px 150px 96px",
                gap: 14,
                minWidth: 900,
                alignItems: "center",
                padding: "11px 16px",
                borderBottom: "1px solid var(--line-2)",
                background: a.testMode ? "var(--viol-t)" : "transparent",
                color: "inherit",
                textDecoration: "none",
              }}
            >
              <span
                aria-hidden
                className={
                  a.status === "firing" && !a.acked && !a.testMode ? "oi-pulse" : undefined
                }
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background:
                    a.status === "resolved"
                      ? "var(--ok)"
                      : a.testMode
                        ? "var(--viol)"
                        : "var(--dang)",
                }}
              />
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  borderRadius: 6,
                  padding: "2px 0",
                  textAlign: "center",
                  background: chip.bg,
                  color: chip.ink,
                }}
              >
                {a.priority ?? "—"}
              </span>
              <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {a.title}
                  </span>
                  {a.testMode && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: "var(--viol)",
                        background: "var(--viol-t)",
                        borderRadius: 5,
                        padding: "1px 6px",
                        flex: "none",
                      }}
                    >
                      {t("alt2.list.test")}
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                  {a.sourceName} · {t("alt2.list.grouped", { count: a.groupCount })}
                </span>
              </span>
              <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {a.service && (
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10.5,
                      background: "var(--sunk)",
                      borderRadius: 5,
                      padding: "1px 6px",
                      color: "var(--ink-2)",
                    }}
                  >
                    service:{a.service}
                  </span>
                )}
              </span>
              <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{who(a)}</span>
              <span
                style={{
                  fontSize: 11.5,
                  color: "var(--ink-3)",
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {t.fmt.relativeCompact(a.lastAt)}
              </span>
            </Link>
          );
        })}
        {data.rows.length === 0 && (
          <div
            style={{
              padding: 36,
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>{t("alt2.list.emptyTitle")}</div>
            <div
              style={{
                fontSize: 13,
                color: "var(--ink-2)",
                maxWidth: 420,
                lineHeight: 1.5,
              }}
            >
              {curl ? t("alt2.list.emptyCurl") : t("alt2.list.emptyNoSource")}
            </div>
            {curl ? (
              <code
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11.5,
                  background: "var(--sunk)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  textAlign: "left",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {curl}
              </code>
            ) : (
              manages && (
                <Link
                  href="/app/alerts/sources?new=1"
                  className="oi-hover-brand-2"
                  style={{
                    height: 32,
                    padding: "0 13px",
                    borderRadius: 9,
                    background: "var(--brand)",
                    color: "var(--on-brand)",
                    display: "flex",
                    alignItems: "center",
                    fontSize: 12.5,
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  {t("alt2.list.connect")}
                </Link>
              )
            )}
          </div>
        )}
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("alt2.list.footnote")}</div>
    </div>
  );
}
