"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { alertEvents, alerts, incidentEvents, withTenant } from "@openincident/db";
import {
  acknowledgeEscalation,
  cancelEscalation,
  startEscalation,
  unacknowledgeEscalation,
} from "@openincident/oncall";
import { requireResponder } from "@/lib/session";

const idSchema = z.string().uuid();

/** Acknowledges from the web: the escalation's timers stop, the alert shows who took it. */
export async function acknowledgeAlert(formData: FormData) {
  const current = await requireResponder();
  const id = idSchema.parse(formData.get("id"));
  const tenantId = current.tenant.id;
  const [alert] = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(alerts)
      .where(and(eq(alerts.tenantId, tenantId), eq(alerts.id, id))),
  );
  if (!alert) return;
  const actor = { memberId: current.member.id, name: current.member.name };
  const now = new Date();
  if (alert.escalationId) {
    const r = await acknowledgeEscalation(tenantId, alert.escalationId, actor, "web", now);
    if (r.ok) {
      revalidatePath(`/app/alerts/${id}`);
      revalidatePath("/app/alerts");
      return;
    }
  }
  await withTenant(tenantId, async (tx) => {
    await tx
      .update(alerts)
      .set({ ackedAt: now, ackedByMemberId: actor.memberId })
      .where(eq(alerts.id, id));
    await tx.insert(alertEvents).values({
      tenantId,
      alertId: id,
      kind: "acknowledged",
      actorKind: "member",
      actorMemberId: actor.memberId,
      actorName: actor.name,
      payload: { channel: "web" },
      occurredAt: now,
    });
  });
  revalidatePath(`/app/alerts/${id}`);
  revalidatePath("/app/alerts");
}

export async function unacknowledgeAlert(formData: FormData) {
  const current = await requireResponder();
  const id = idSchema.parse(formData.get("id"));
  const tenantId = current.tenant.id;
  const [alert] = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(alerts)
      .where(and(eq(alerts.tenantId, tenantId), eq(alerts.id, id))),
  );
  if (!alert) return;
  const actor = { memberId: current.member.id, name: current.member.name };
  const undone = alert.escalationId
    ? await unacknowledgeEscalation(tenantId, alert.escalationId, actor)
    : false;
  if (!undone) {
    await withTenant(tenantId, async (tx) => {
      await tx
        .update(alerts)
        .set({ ackedAt: null, ackedByMemberId: null })
        .where(eq(alerts.id, id));
      await tx.insert(alertEvents).values({
        tenantId,
        alertId: id,
        kind: "unacknowledged",
        actorKind: "member",
        actorMemberId: actor.memberId,
        actorName: actor.name,
        payload: {},
        occurredAt: new Date(),
      });
    });
  }
  revalidatePath(`/app/alerts/${id}`);
  revalidatePath("/app/alerts");
}

/** Snooze: the pending escalation is stopped and a fresh one starts when the snooze ends. */
export async function snoozeAlert(formData: FormData) {
  const current = await requireResponder();
  const id = idSchema.parse(formData.get("id"));
  const minutes = z.coerce
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .catch(30)
    .parse(formData.get("minutes"));
  const tenantId = current.tenant.id;
  const now = new Date();
  const until = new Date(now.getTime() + minutes * 60_000);
  const alert = await withTenant(tenantId, async (tx) => {
    const [a] = await tx
      .select()
      .from(alerts)
      .where(and(eq(alerts.tenantId, tenantId), eq(alerts.id, id)));
    if (!a || a.status !== "firing") return null;
    await tx.update(alerts).set({ snoozedUntil: until }).where(eq(alerts.id, id));
    await tx.insert(alertEvents).values({
      tenantId,
      alertId: id,
      kind: "snoozed",
      actorKind: "member",
      actorMemberId: current.member.id,
      actorName: current.member.name,
      payload: { minutes, until: until.toISOString() },
      occurredAt: now,
    });
    return a;
  });
  if (alert?.escalationId) {
    const [esc] = await withTenant(tenantId, async (tx) => {
      const { escalations } = await import("@openincident/db");
      return tx.select().from(escalations).where(eq(escalations.id, alert.escalationId!));
    });
    if (esc && esc.status === "pending") {
      await cancelEscalation(tenantId, esc.id, "snoozed", now);
      await startEscalation(tenantId, {
        pathId: esc.pathId,
        alertId: id,
        incidentId: esc.incidentId,
        urgency: esc.urgency,
        priorityRank: esc.priorityRank,
        deferMinutes: minutes,
        triggeredBy: { kind: "member", memberId: current.member.id, name: current.member.name },
        now,
      });
    }
  }
  revalidatePath(`/app/alerts/${id}`);
  revalidatePath("/app/alerts");
}

/** Resolves by hand: the alert closes, its escalation ends, the linked incident learns about it. */
export async function resolveAlert(formData: FormData) {
  const current = await requireResponder();
  const id = idSchema.parse(formData.get("id"));
  const tenantId = current.tenant.id;
  const now = new Date();
  const alert = await withTenant(tenantId, async (tx) => {
    const [a] = await tx
      .select()
      .from(alerts)
      .where(and(eq(alerts.tenantId, tenantId), eq(alerts.id, id)));
    if (!a || a.status !== "firing") return null;
    await tx
      .update(alerts)
      .set({ status: "resolved", resolvedAt: now, lastAt: now })
      .where(eq(alerts.id, id));
    await tx
      .update(alerts)
      .set({ status: "resolved", resolvedAt: now })
      .where(eq(alerts.groupId, id));
    await tx.insert(alertEvents).values({
      tenantId,
      alertId: id,
      kind: "resolved",
      actorKind: "member",
      actorMemberId: current.member.id,
      actorName: current.member.name,
      payload: { by: "member" },
      occurredAt: now,
    });
    if (a.incidentId) {
      await tx.insert(incidentEvents).values({
        tenantId,
        incidentId: a.incidentId,
        kind: "note",
        actorKind: "member",
        actorMemberId: current.member.id,
        actorName: current.member.name,
        payload: { system: "alert_resolved", alertId: id, title: a.title },
        occurredAt: now,
      });
    }
    return a;
  });
  if (alert?.escalationId)
    await cancelEscalation(tenantId, alert.escalationId, "alert_resolved", now);
  revalidatePath(`/app/alerts/${id}`);
  revalidatePath("/app/alerts");
}
