"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  incidentEvents,
  incidentParticipants,
  incidentRoles,
  incidentStatuses,
  incidents,
  roleAssignments,
  severities,
  withTenant,
} from "@openincident/db";
import { requireResponder } from "@/lib/session";
import { afterIncidentChange } from "@/lib/incident-writes";

const numberSchema = z.coerce.number().int().positive();

/**
 * Accept from triage → active, first status of the type's lifecycle, the
 * accepting responder takes the lead role. One transaction, one timeline event
 * per fact changed — never a silent transition.
 */
export async function acceptTriage(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  await withTenant(current.tenant.id, async (tx) => {
    const [inc] = await tx
      .select()
      .from(incidents)
      .where(and(eq(incidents.tenantId, current.tenant.id), eq(incidents.number, number)));
    if (!inc || inc.phase !== "triage") return;
    const [first] = await tx
      .select()
      .from(incidentStatuses)
      .where(eq(incidentStatuses.typeId, inc.typeId))
      .orderBy(asc(incidentStatuses.rank))
      .limit(1);
    // A triaged alert has no severity yet: SEV3 (the third level) is the sane
    // starting point the design proposes — changeable in one click afterwards.
    const [sev] = inc.severityId
      ? [{ id: inc.severityId, name: "" }]
      : await tx
          .select({ id: severities.id, name: severities.name })
          .from(severities)
          .where(and(eq(severities.tenantId, current.tenant.id), eq(severities.rank, 2)));
    const now = new Date();
    await tx
      .update(incidents)
      .set({
        phase: "active",
        statusId: first?.id ?? null,
        severityId: sev?.id ?? inc.severityId,
        acceptedAt: now,
        lastActivityAt: now,
        updatedAt: now,
        nextUpdateDueAt: first?.updateReminderMinutes
          ? new Date(now.getTime() + first.updateReminderMinutes * 60_000)
          : null,
      })
      .where(eq(incidents.id, inc.id));
    const [sevRow] = sev?.id
      ? await tx.select({ name: severities.name }).from(severities).where(eq(severities.id, sev.id))
      : [];
    await tx.insert(incidentEvents).values({
      tenantId: current.tenant.id,
      incidentId: inc.id,
      kind: "accepted",
      actorKind: "member",
      actorMemberId: current.member.id,
      actorName: current.member.name,
      payload: { severity: sevRow?.name ?? null, status: first?.name ?? null },
      occurredAt: now,
    });
    const [lead] = await tx
      .select({ id: incidentRoles.id })
      .from(incidentRoles)
      .where(and(eq(incidentRoles.tenantId, current.tenant.id), eq(incidentRoles.isLead, true)));
    if (lead) {
      await tx
        .insert(roleAssignments)
        .values({
          tenantId: current.tenant.id,
          incidentId: inc.id,
          roleId: lead.id,
          memberId: current.member.id,
        })
        .onConflictDoNothing();
      await tx.insert(incidentEvents).values({
        tenantId: current.tenant.id,
        incidentId: inc.id,
        kind: "role_assigned",
        actorKind: "member",
        actorMemberId: current.member.id,
        actorName: current.member.name,
        payload: { role: "lead", member: current.member.name },
        occurredAt: new Date(now.getTime() + 1),
      });
    }
    await tx
      .insert(incidentParticipants)
      .values({
        tenantId: current.tenant.id,
        incidentId: inc.id,
        memberId: current.member.id,
        kind: "participant",
      })
      .onConflictDoUpdate({
        target: [incidentParticipants.incidentId, incidentParticipants.memberId],
        set: { kind: "participant", lastActivityAt: now },
      });
  });
  const [accepted] = await withTenant(current.tenant.id, (tx) =>
    tx
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(eq(incidents.tenantId, current.tenant.id), eq(incidents.number, number))),
  );
  if (accepted) await afterIncidentChange(current.tenant.id, accepted.id, ["incident.updated"]);
  revalidatePath("/app/incidents");
  redirect(`/app/incidents/${number}`);
}

/** Decline: closed with a reason — the reason is required, and it lands in the timeline. */
export async function declineTriage(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const reason = String(formData.get("reason") ?? "")
    .trim()
    .slice(0, 500);
  if (!reason) return;
  await withTenant(current.tenant.id, async (tx) => {
    const [inc] = await tx
      .select()
      .from(incidents)
      .where(and(eq(incidents.tenantId, current.tenant.id), eq(incidents.number, number)));
    if (!inc || inc.phase !== "triage") return;
    const now = new Date();
    await tx
      .update(incidents)
      .set({ phase: "closed", closedAt: now, lastActivityAt: now, updatedAt: now })
      .where(eq(incidents.id, inc.id));
    await tx.insert(incidentEvents).values({
      tenantId: current.tenant.id,
      incidentId: inc.id,
      kind: "declined",
      actorKind: "member",
      actorMemberId: current.member.id,
      actorName: current.member.name,
      payload: { reason },
      occurredAt: now,
    });
  });
  revalidatePath("/app/incidents");
  redirect("/app/incidents?view=triage");
}
