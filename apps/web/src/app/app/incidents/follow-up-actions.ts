"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { followUps, incidentEvents, incidents, withTenant } from "@openincident/db";
import { requireResponder } from "@/lib/session";
import { exportFollowUp } from "@openincident/trackers";
import { getT } from "@/i18n/server";
import { currentOrigin } from "@/lib/tenant";

/** Done ↔ open. Written to the follow-up and to the incident's timeline in one transaction. */
export async function toggleFollowUp(formData: FormData) {
  const current = await requireResponder();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(followUps)
      .where(and(eq(followUps.tenantId, current.tenant.id), eq(followUps.id, id)));
    if (!row) return;
    const done = row.status !== "done";
    await tx
      .update(followUps)
      .set({
        status: done ? "done" : "open",
        completedAt: done ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(followUps.id, row.id));
    await tx.insert(incidentEvents).values({
      tenantId: current.tenant.id,
      incidentId: row.incidentId,
      kind: done ? "follow_up_completed" : "follow_up_created",
      actorKind: "member",
      actorMemberId: current.member.id,
      actorName: current.member.name,
      payload: { title: row.title, reopened: !done },
    });
    await tx
      .update(incidents)
      .set({ lastActivityAt: new Date() })
      .where(eq(incidents.id, row.incidentId));
  });
  revalidatePath("/app/incidents");
}

/** Export to a connected tracker — the issue is created there, the reference kept here. */
export async function exportFollowUpAction(
  id: string,
  kind: "github" | "gitlab" | "jira" | "linear",
): Promise<{ error: string } | void> {
  const current = await requireResponder();
  const t = await getT();
  const res = await exportFollowUp(
    current.tenant.id,
    id,
    kind,
    { memberId: current.member.id, name: current.member.name },
    await currentOrigin(),
  );
  if (!res.ok) return { error: t(`followUp.exportError.${res.reason}`) };
  revalidatePath("/app/incidents");
  revalidatePath("/app/incidents/[number]", "page");
}
