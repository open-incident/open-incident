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
import { Person } from "./side-panel";

/**
 * What was paged, as rows of the roles card: who answered the page ("first
 * responder"), or who is being rung right now. Nothing when nobody was paged.
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

  // Who the page reached, as people of the roles card: the one who answered,
  // or the ones being rung right now; an escalation that ended without anyone
  // keeps one line with its outcome.
  return (
    <>
      {data.escs.map((e) => {
        const path = data.paths.find((p) => p.id === e.pathId)?.name ?? "—";
        const acker = data.people.find((p) => p.id === e.ackedByMemberId)?.name ?? null;
        const pendingMembers =
          e.id === data.escs[0]?.id && Array.isArray(data.lastNotified?.payload.members)
            ? (data.lastNotified!.payload.members as string[]).join(", ")
            : null;
        if (e.status === "acked" && acker)
          return (
            <Person
              key={e.id}
              testid="incident-escalation"
              name={acker}
              sub={t("incv2.roles.firstResponder", { path })}
            />
          );
        if (e.status === "pending")
          return (
            <Person
              key={e.id}
              testid="incident-escalation"
              name={pendingMembers}
              fallback={path}
              sub={t("incv2.roles.beingPaged", { path })}
              subInk="var(--dang)"
            />
          );
        return (
          <Person
            key={e.id}
            testid="incident-escalation"
            name={null}
            fallback={path}
            sub={`${t(`incident.escalationStatus.${e.status}`)} · ${t.fmt.relative(e.startedAt)}`}
          />
        );
      })}
    </>
  );
}
