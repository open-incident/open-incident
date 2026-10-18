"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { postIncidentTaskDefs, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";
import type { Done } from "../types/actions";

const taskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  phase: z.enum(["documenting", "reviewing"]),
  defaultAssigneeRole: z.enum(["lead", "communication", "none"]).default("lead"),
  dueAfterDays: z.string().optional(),
});

/** Adds a task definition to a phase; incidents entering the flow from now on get it. */
export async function createTask(formData: FormData): Promise<Done> {
  const current = await requireManager();
  const t = await getT();
  const parsed = taskSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: t("settingsV2.error.invalid") };
  const input = parsed.data;
  const due = input.dueAfterDays ? Number(input.dueAfterDays) : null;
  if (due !== null && (!Number.isInteger(due) || due < 1 || due > 90))
    return { ok: false, error: t("settingsV2.error.invalid") };
  await withTenant(current.tenant.id, async (tx) => {
    const [maxRow] = await tx
      .select({
        max: sql<number>`coalesce(max(${postIncidentTaskDefs.position}), -1)`.mapWith(Number),
      })
      .from(postIncidentTaskDefs)
      .where(
        and(
          eq(postIncidentTaskDefs.tenantId, current.tenant.id),
          eq(postIncidentTaskDefs.phase, input.phase),
        ),
      );
    await tx.insert(postIncidentTaskDefs).values({
      tenantId: current.tenant.id,
      phase: input.phase,
      title: input.title,
      defaultAssigneeRole: input.defaultAssigneeRole === "none" ? null : input.defaultAssigneeRole,
      dueAfterDays: due,
      position: (maxRow?.max ?? -1) + 1,
    });
    await recordAudit(tx, current, "config", "post_incident_task.created", {
      title: input.title,
      phase: input.phase,
    });
  });
  revalidatePath("/app/settings/types");
  return { ok: true, message: t("settingsV2.types.taskAdded") };
}

export async function deleteTask(formData: FormData): Promise<Done> {
  const current = await requireManager();
  const t = await getT();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: t("settingsV2.error.invalid") };
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(postIncidentTaskDefs)
      .where(
        and(
          eq(postIncidentTaskDefs.tenantId, current.tenant.id),
          eq(postIncidentTaskDefs.id, id.data),
        ),
      );
    if (!row) return;
    await tx.delete(postIncidentTaskDefs).where(eq(postIncidentTaskDefs.id, row.id));
    await recordAudit(tx, current, "config", "post_incident_task.deleted", { title: row.title });
  });
  revalidatePath("/app/settings/types");
  return { ok: true, message: t("settingsV2.types.taskRemoved") };
}
