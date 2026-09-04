"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import {
  incidentEvents,
  incidentParticipants,
  incidentRoles,
  incidents,
  members,
  postIncidentTasks,
  roleAssignments,
  withTenant,
  type Tx,
  statusPages,
} from "@openincident/db";
import type { WebhookEvent } from "@openincident/webhooks";
import { publishIncidentUpdate } from "@openincident/statuspages";
import { addFollowUpCore, afterIncidentChange, postUpdateCore } from "@/lib/incident-writes";
import { getT } from "@/i18n/server";
import { requireMember, requireResponder, type CurrentMember } from "@/lib/session";

const numberSchema = z.coerce.number().int().positive();

async function touch(tx: Tx, current: CurrentMember, incidentId: string, now: Date) {
  await tx
    .update(incidents)
    .set({ lastActivityAt: now, updatedAt: now })
    .where(eq(incidents.id, incidentId));
  await tx
    .insert(incidentParticipants)
    .values({
      tenantId: current.tenant.id,
      incidentId,
      memberId: current.member.id,
      kind: "participant",
      firstActivityAt: now,
      lastActivityAt: now,
    })
    .onConflictDoUpdate({
      target: [incidentParticipants.incidentId, incidentParticipants.memberId],
      set: { kind: "participant", lastActivityAt: now },
    });
}

const updateSchema = z.object({
  number: numberSchema,
  statusId: z.string().min(1),
  message: z.string().trim().min(1).max(4000),
  severityId: z.string().optional(),
  nextUpdateMinutes: z.string().optional(),
});

/**
 * The status update — the same write path as `POST /api/v1/incidents/{n}/updates`
 * (lib/incident-writes.ts). Announcements and webhooks follow the commit.
 */
export async function postUpdate(formData: FormData): Promise<{ error: string } | void> {
  const current = await requireResponder();
  const t = await getT();
  const parsed = updateSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: t("incident.update.invalid") };
  const input = parsed.data;
  const tenantId = current.tenant.id;

  const outcome = await withTenant(tenantId, async (tx) => {
    const [inc] = await tx
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.number, input.number)));
    if (!inc) return null;
    const result = await postUpdateCore(
      tx,
      tenantId,
      { kind: "member", memberId: current.member.id, name: current.member.name },
      inc.id,
      {
        statusId: input.statusId,
        message: input.message,
        severityId: input.severityId || null,
        nextUpdateMinutes: input.nextUpdateMinutes ? Number(input.nextUpdateMinutes) : null,
        resolvedLabel: t("incident.update.resolved"),
      },
    );
    return result ? { id: inc.id, result } : null;
  });
  if (outcome) {
    const events: WebhookEvent[] = ["incident.update_published"];
    if (outcome.result.statusChanged || outcome.result.severityChanged)
      events.push("incident.updated");
    if (outcome.result.resolved) events.push("incident.resolved");
    await afterIncidentChange(
      tenantId,
      outcome.id,
      events,
      { message: input.message, by: current.member.name },
      { chat: formData.get("chat") !== "off" },
    );
    if (formData.get("statusPage") === "on") {
      const [page] = await withTenant(tenantId, (tx) =>
        tx
          .select({ id: statusPages.id })
          .from(statusPages)
          .where(eq(statusPages.tenantId, tenantId))
          .limit(1),
      );
      if (page) {
        await publishIncidentUpdate(tenantId, outcome.id, {
          pageId: page.id,
          body: input.message,
          actor: { memberId: current.member.id, name: current.member.name },
        }).catch((err) => console.error("[status] publish failed:", err));
      }
    }
  }
  revalidatePath(`/app/incidents/${input.number}`);
  revalidatePath("/app/incidents");
}

export async function listAssignableMembers(): Promise<Array<{ id: string; name: string }>> {
  const current = await requireMember();
  return withTenant(current.tenant.id, (tx) =>
    tx
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(
        and(
          eq(members.tenantId, current.tenant.id),
          eq(members.status, "active"),
          ne(members.role, "viewer"),
        ),
      )
      .orderBy(asc(members.name)),
  );
}

export async function assignRole(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const roleId = z.string().uuid().parse(formData.get("roleId"));
  const memberId = z.string().uuid().parse(formData.get("memberId"));
  await withTenant(current.tenant.id, async (tx) => {
    const [inc] = await tx
      .select()
      .from(incidents)
      .where(and(eq(incidents.tenantId, current.tenant.id), eq(incidents.number, number)));
    const [role] = await tx
      .select()
      .from(incidentRoles)
      .where(and(eq(incidentRoles.tenantId, current.tenant.id), eq(incidentRoles.id, roleId)));
    const [who] = await tx
      .select()
      .from(members)
      .where(
        and(
          eq(members.tenantId, current.tenant.id),
          eq(members.id, memberId),
          eq(members.status, "active"),
        ),
      );
    if (!inc || !role || !who || who.role === "viewer") return;
    const now = new Date();
    await tx
      .insert(roleAssignments)
      .values({
        tenantId: current.tenant.id,
        incidentId: inc.id,
        roleId: role.id,
        memberId: who.id,
        assignedAt: now,
      })
      .onConflictDoUpdate({
        target: [roleAssignments.incidentId, roleAssignments.roleId],
        set: { memberId: who.id, assignedAt: now },
      });
    await tx.insert(incidentEvents).values({
      tenantId: current.tenant.id,
      incidentId: inc.id,
      kind: "role_assigned",
      actorKind: "member",
      actorMemberId: current.member.id,
      actorName: current.member.name,
      payload: { role: role.isLead ? "lead" : role.id, roleName: role.name, member: who.name },
      occurredAt: now,
    });
    await tx
      .insert(incidentParticipants)
      .values({
        tenantId: current.tenant.id,
        incidentId: inc.id,
        memberId: who.id,
        kind: "participant",
        firstActivityAt: now,
        lastActivityAt: now,
      })
      .onConflictDoUpdate({
        target: [incidentParticipants.incidentId, incidentParticipants.memberId],
        set: { kind: "participant", lastActivityAt: now },
      });
    await touch(tx, current, inc.id, now);
  });
  revalidatePath(`/app/incidents/${number}`);
}

export async function togglePin(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const id = z.string().uuid().parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [ev] = await tx
      .select()
      .from(incidentEvents)
      .where(and(eq(incidentEvents.tenantId, current.tenant.id), eq(incidentEvents.id, id)));
    if (!ev) return;
    await tx.update(incidentEvents).set({ pinned: !ev.pinned }).where(eq(incidentEvents.id, ev.id));
  });
  revalidatePath(`/app/incidents/${number}`);
}

export async function toggleTask(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const id = z.string().uuid().parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [task] = await tx
      .select()
      .from(postIncidentTasks)
      .where(and(eq(postIncidentTasks.tenantId, current.tenant.id), eq(postIncidentTasks.id, id)));
    if (!task) return;
    const now = new Date();
    const done = !task.completedAt;
    await tx
      .update(postIncidentTasks)
      .set({ completedAt: done ? now : null, skippedAt: null, skipReason: null })
      .where(eq(postIncidentTasks.id, task.id));
    if (done) {
      await tx.insert(incidentEvents).values({
        tenantId: current.tenant.id,
        incidentId: task.incidentId,
        kind: "task_completed",
        actorKind: "member",
        actorMemberId: current.member.id,
        actorName: current.member.name,
        payload: { title: task.title },
        occurredAt: now,
      });
    }
    // The flow advances by itself: every task done or skipped closes the incident.
    const remaining = await tx
      .select({ id: postIncidentTasks.id })
      .from(postIncidentTasks)
      .where(
        and(
          eq(postIncidentTasks.incidentId, task.incidentId),
          eq(postIncidentTasks.completedAt, null as unknown as Date),
        ),
      );
    const [inc] = await tx.select().from(incidents).where(eq(incidents.id, task.incidentId));
    if (inc && inc.phase === "post_incident" && remaining.length === 0) {
      await tx
        .update(incidents)
        .set({ phase: "closed", closedAt: now })
        .where(eq(incidents.id, inc.id));
      await tx.insert(incidentEvents).values({
        tenantId: current.tenant.id,
        incidentId: inc.id,
        kind: "closed",
        actorKind: "system",
        payload: { reason: "post_incident_complete" },
        occurredAt: new Date(now.getTime() + 1),
      });
    } else if (inc && inc.phase === "closed" && !done && inc.resolvedAt) {
      await tx
        .update(incidents)
        .set({ phase: "post_incident", closedAt: null })
        .where(eq(incidents.id, inc.id));
    }
    await touch(tx, current, task.incidentId, now);
  });
  revalidatePath(`/app/incidents/${number}`);
}

export async function addFollowUp(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const title = z.string().trim().min(1).max(300).parse(formData.get("title"));
  const priorityName = z.enum(["P1", "P2", "P3"]).catch("P2").parse(formData.get("priority"));
  const tenantId = current.tenant.id;
  const created = await withTenant(tenantId, async (tx) => {
    const [inc] = await tx
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.number, number)));
    if (!inc) return null;
    const fu = await addFollowUpCore(
      tx,
      tenantId,
      { kind: "member", memberId: current.member.id, name: current.member.name },
      inc.id,
      { title, priorityName },
    );
    return fu ? { incidentId: inc.id, followUpId: fu.id, title } : null;
  });
  if (created)
    await afterIncidentChange(tenantId, created.incidentId, ["follow_up.created"], {
      follow_up: { id: created.followUpId, title: created.title },
    });
  revalidatePath(`/app/incidents/${number}`);
}
