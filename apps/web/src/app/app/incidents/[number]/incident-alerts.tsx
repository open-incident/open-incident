import Link from "next/link";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  alertSources,
  alerts,
  escalationEvents,
  escalationPaths,
  escalations,
  members,
  withTenant,
} from "@openincident/db";
import { getT } from "@/i18n/server";
import { priorityTone } from "@/lib/tones";
import { requireMember } from "@/lib/session";

/** The side panel's alerting sections: the escalations of this incident and the alerts attached to it. */
export async function IncidentAlerts({ incidentId }: { incidentId: string }) {
  const { tenant } = await requireMember();
  const t = await getT();
  const data = await withTenant(tenant.id, async (tx) => {
    const linked = await tx
      .select({ a: alerts, sourceName: alertSources.name })
      .from(alerts)
      .innerJoin(alertSources, eq(alertSources.id, alerts.sourceId))
      .where(and(eq(alerts.tenantId, tenant.id), eq(alerts.incidentId, incidentId)))
      .orderBy(asc(alerts.firstAt));
    const escs = await tx
      .select()
      .from(escalations)
      .where(and(eq(escalations.tenantId, tenant.id), eq(escalations.incidentId, incidentId)))
      .orderBy(desc(escalations.startedAt));
    const pathIds = [...new Set(escs.map((e) => e.pathId))];
    const paths = pathIds.length
      ? await tx
          .select({ id: escalationPaths.id, name: escalationPaths.name })
          .from(escalationPaths)
          .where(inArray(escalationPaths.id, pathIds))
      : [];
    const ackers = escs.map((e) => e.ackedByMemberId).filter((x): x is string => Boolean(x));
    const people = ackers.length
      ? await tx
          .select({ id: members.id, name: members.name })
          .from(members)
          .where(inArray(members.id, ackers))
      : [];
    const last = escs[0]
      ? await tx
          .select()
          .from(escalationEvents)
          .where(
            and(
              eq(escalationEvents.escalationId, escs[0].id),
              inArray(escalationEvents.kind, ["notified", "retried"]),
            ),
          )
          .orderBy(desc(escalationEvents.occurredAt))
          .limit(1)
      : [];
    return { linked, escs, paths, people, lastNotified: last[0] ?? null };
  });
  if (data.linked.length === 0 && data.escs.length === 0) return null;
  const Sep = () => <div style={{ height: 1, background: "var(--line-2)" }} />;
  return (
    <>
      {data.escs.length > 0 && (
        <>
          <Sep />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="oi-eyebrow">{t("incident.escalations")}</div>
            {data.escs.map((e) => {
              const path = data.paths.find((p) => p.id === e.pathId)?.name ?? "—";
              const acker = data.people.find((p) => p.id === e.ackedByMemberId)?.name;
              const pendingMembers =
                e.id === data.escs[0]?.id && Array.isArray(data.lastNotified?.payload.members)
                  ? (data.lastNotified!.payload.members as string[]).join(", ")
                  : null;
              const tone =
                e.status === "pending"
                  ? ["var(--dang-t)", "var(--dang)"]
                  : e.status === "acked"
                    ? ["var(--ok-t)", "var(--ok)"]
                    : ["var(--sunk)", "var(--ink-2)"];
              return (
                <div
                  key={e.id}
                  data-testid="incident-escalation"
                  style={{
                    border: `1px solid ${e.status === "pending" ? "var(--dang)" : "var(--line)"}`,
                    background: e.status === "pending" ? "var(--dang-t)" : "var(--panel)",
                    borderRadius: 12,
                    padding: "10px 12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    fontSize: 12.5,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{path}</span>
                    <span
                      style={{
                        padding: "1px 8px",
                        borderRadius: 999,
                        background: tone[0],
                        color: tone[1],
                        fontSize: 10.5,
                        fontWeight: 700,
                        marginLeft: "auto",
                      }}
                    >
                      {t(`incident.escalationStatus.${e.status}`)}
                    </span>
                  </div>
                  <div style={{ color: "var(--ink-2)" }}>
                    {e.status === "pending" && pendingMembers
                      ? t("incident.escalationPaging", { members: pendingMembers })
                      : e.status === "acked" && acker
                        ? t("incident.escalationAckedBy", {
                            by: acker,
                            when: e.ackedAt ? t.fmt.relative(e.ackedAt) : "",
                          })
                        : t("incident.escalationStartedAgo", {
                            when: t.fmt.relative(e.startedAt),
                            by: e.triggeredByName ?? "—",
                          })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {data.linked.length > 0 && (
        <>
          <Sep />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="oi-eyebrow">
              {t("incident.linkedAlerts", { count: data.linked.length })}
            </div>
            {data.linked.map(({ a, sourceName }) => {
              const pr = priorityTone(
                a.attributes.priority === "P1" ? 0 : a.attributes.priority === "P2" ? 1 : 2,
              );
              return (
                <Link
                  key={a.id}
                  href={`/app/alerts/${a.id}`}
                  data-testid="linked-alert"
                  className="oi-hover-edge"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    padding: "8px 10px",
                    fontSize: 12.5,
                    color: "inherit",
                    textDecoration: "none",
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: a.status === "firing" ? "var(--dang)" : "var(--ok)",
                      flex: "none",
                    }}
                  />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontWeight: 500,
                    }}
                  >
                    {a.title}
                  </span>
                  {a.attributes.priority && (
                    <span
                      style={{
                        padding: "1px 7px",
                        borderRadius: 999,
                        background: pr.bg,
                        color: pr.ink,
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      {a.attributes.priority}
                    </span>
                  )}
                  <span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{sourceName}</span>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
