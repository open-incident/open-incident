"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant, workingHoursSets } from "@openincident/db";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";

const PAGE = "/app/settings/working-hours";
const schema = z.object({
  id: z.string().uuid().or(z.literal("")).optional(),
  name: z.string().trim().min(2).max(60),
  timezone: z.string().regex(/^[A-Za-z_]+(\/[A-Za-z_]+)*$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
});

export async function saveWorkingHours(formData: FormData) {
  const current = await requireManager();
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect(`${PAGE}?error=invalid`);
  const input = parsed.data;
  const days = formData
    .getAll("days")
    .map(Number)
    .filter((d) => d >= 1 && d <= 7);
  if (days.length === 0) redirect(`${PAGE}?error=invalid`);
  await withTenant(current.tenant.id, async (tx) => {
    if (input.id)
      await tx
        .update(workingHoursSets)
        .set({
          name: input.name,
          timezone: input.timezone,
          days,
          startTime: input.startTime,
          endTime: input.endTime,
          updatedAt: new Date(),
        })
        .where(
          and(eq(workingHoursSets.tenantId, current.tenant.id), eq(workingHoursSets.id, input.id)),
        );
    else
      await tx.insert(workingHoursSets).values({
        tenantId: current.tenant.id,
        name: input.name,
        timezone: input.timezone,
        days,
        startTime: input.startTime,
        endTime: input.endTime,
      });
    await recordAudit(
      tx,
      current,
      "config",
      input.id ? "working_hours.updated" : "working_hours.created",
      { name: input.name },
    );
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?saved=1`);
}

export async function deleteWorkingHours(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [w] = await tx
      .select()
      .from(workingHoursSets)
      .where(and(eq(workingHoursSets.tenantId, current.tenant.id), eq(workingHoursSets.id, id)));
    if (!w) return;
    await tx.delete(workingHoursSets).where(eq(workingHoursSets.id, id));
    await recordAudit(tx, current, "config", "working_hours.deleted", { name: w.name });
  });
  revalidatePath(PAGE);
}
