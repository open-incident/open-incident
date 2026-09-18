import { and, desc, eq, inArray } from "drizzle-orm";
import {
  escalationEvents,
  escalationPaths,
  escalations,
  members,
  withTenant,
} from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { card, eyebrow } from "./side-panel";

/**
 * The side card of what was paged: one line per escalation, who is ringing
 * right now or who answered. The alerts themselves are the card above; this one
 * only appears when someone was actually paged.
 */
export async function IncidentEscalations({ incidentId }: { incidentId: string }) {
  const { tenant } = await requireMember();
  const t = await getT();
  const data = await withTenant(tenant.id, async (tx) => {
    const escs = await tx
      .select()
      .from(escalations)
      .where(and(eq(escalations.tenantId, tenant.id), eq(escalations.incidentId, incidentId)))
      .orderBy(desc(escalations.startedAt));
    if (escs.length === 0) return { escs, paths: [], people: [], lastNotified: null };
    const pathIds = [...new Set(escs.map((e) => e.pathId))];
    const paths = await tx
      .select({ id: escalationPaths.id, name: escalationPaths.name })
      .from(escalationPaths)
      .where(inArray(escalationPaths.id, pathIds));
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
    return { escs, paths, people, lastNotified: last[0] ?? null };
  });
  if (data.escs.length === 0) return null;

  return (
    <div style={card}>
      <div style={eyebrow}>{t("incident.escalations")}</div>
      {data.escs.map((e) => {
        const path = data.paths.find((p) => p.id === e.pathId)?.name ?? "—";
        const acker = data.people.find((p) => p.id === e.ackedByMemberId)?.name;
        const pendingMembers =
          e.id === data.escs[0]?.id && Array.isArray(data.lastNotified?.payload.members)
            ? (data.lastNotified!.payload.members as string[]).join(", ")
            : null;
        const ink =
          e.status === "pending"
            ? "var(--dang)"
            : e.status === "acked"
              ? "var(--ok)"
              : "var(--ink-2)";
        return (
          <div
            key={e.id}
            data-testid="incident-escalation"
            style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12.5 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 600 }}>{path}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: ink }}>
                {t(`incident.escalationStatus.${e.status}`)}
              </span>
            </div>
            <div style={{ color: "var(--ink-3)", fontSize: 11.5, lineHeight: 1.45 }}>
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
  );
}
