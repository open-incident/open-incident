/** Acknowledging from a one-tap link: the token names a delivery, the delivery names the member and the escalation. */
import { and, eq } from "drizzle-orm";
import {
  alerts,
  escalations,
  incidents,
  members,
  notificationDeliveries,
  withTenant,
} from "@openincident/db";
import { acknowledgeEscalation } from "@openincident/oncall";

export async function describeAckToken(tenantId: string, token: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  return withTenant(tenantId, async (tx) => {
    const [d] = await tx
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.tenantId, tenantId),
          eq(notificationDeliveries.ackToken, token),
        ),
      );
    if (!d || !d.memberId) return null;
    const [m] = await tx
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(eq(members.id, d.memberId));
    const [esc] = d.escalationId
      ? await tx.select().from(escalations).where(eq(escalations.id, d.escalationId))
      : [];
    const [alert] = esc?.alertId
      ? await tx.select({ title: alerts.title }).from(alerts).where(eq(alerts.id, esc.alertId))
      : [];
    const [inc] = esc?.incidentId
      ? await tx
          .select({ number: incidents.number, name: incidents.name })
          .from(incidents)
          .where(eq(incidents.id, esc.incidentId))
      : [];
    return {
      delivery: d,
      member: m ?? null,
      escalation: esc ?? null,
      title: alert?.title ?? (inc ? `INC-${inc.number} · ${inc.name}` : d.message.subject),
      incidentNumber: inc?.number ?? null,
    };
  });
}

export async function ackByToken(
  tenantId: string,
  token: string,
  channel: string,
): Promise<{ ok: boolean; already: boolean; incidentNumber: number | null; name: string | null }> {
  const info = await describeAckToken(tenantId, token);
  if (!info?.member || !info.escalation)
    return { ok: false, already: false, incidentNumber: null, name: info?.member?.name ?? null };
  if (info.escalation.status !== "pending")
    return { ok: true, already: true, incidentNumber: info.incidentNumber, name: info.member.name };
  const r = await acknowledgeEscalation(
    tenantId,
    info.escalation.id,
    { memberId: info.member.id, name: info.member.name },
    channel,
  );
  await withTenant(tenantId, (tx) =>
    tx
      .update(notificationDeliveries)
      .set({ status: "handled", handledAt: new Date() })
      .where(eq(notificationDeliveries.id, info.delivery.id)),
  ).catch(() => {});
  return {
    ok: r.ok,
    already: false,
    incidentNumber: r.incidentNumber ?? info.incidentNumber,
    name: info.member.name,
  };
}
