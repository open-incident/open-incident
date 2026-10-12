"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { postIncidentTaskDefs, withTenant } from "@openincident/db";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";

/** Where to land after a task gesture: the screen it came from, never elsewhere. */
function backTo(formData: FormData, extra: string): string {
  const back = String(formData.get("back") ?? "");
  const base = back.startsWith("/app/settings/types") ? back : "/app/settings/types";
  return `${base}${base.includes("?") ? "&" : "?"}${extra}`;
}

const taskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  phase: z.enum(["documenting", "reviewing"]),
  defaultAssigneeRole: z.enum(["lead", "communication", "none"]).default("lead"),
  dueAfterDays: z.string().optional(),
});

/** Adds a task definition to a phase; incidents entering the flow from now on get it. */
export async function createTask(formData: FormData) {
  const current = await requireManager();
  const parsed = taskSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect(backTo(formData, "error=invalid"));
  const input = parsed.data;
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
      dueAfterDays: input.dueAfterDays ? Number(input.dueAfterDays) : null,
      position: (maxRow?.max ?? -1) + 1,
    });
    await recordAudit(tx, current, "config", "post_incident_task.created", {
      title: input.title,
      phase: input.phase,
    });
  });
  revalidatePath("/app/settings/types");
  redirect(backTo(formData, "saved=1"));
}

export async function deleteTask(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(postIncidentTaskDefs)
      .where(
        and(eq(postIncidentTaskDefs.tenantId, current.tenant.id), eq(postIncidentTaskDefs.id, id)),
      );
    if (!row) return;
    await tx.delete(postIncidentTaskDefs).where(eq(postIncidentTaskDefs.id, row.id));
    await recordAudit(tx, current, "config", "post_incident_task.deleted", { title: row.title });
  });
  revalidatePath("/app/settings/types");
  redirect(backTo(formData, "saved=1"));
}
