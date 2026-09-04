"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { incidentStatuses, incidentTypes, severities, withTenant } from "@openincident/db";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";

const sevSchema = z.object({
  severityId: z.string().uuid(),
  name: z.string().trim().min(1).max(20),
  description: z.string().trim().max(200).optional(),
  postIncident: z.enum(["always", "yes", "opt_in", "never"]),
});

export async function saveSeverity(formData: FormData) {
  const current = await requireManager();
  const parsed = sevSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect("/app/settings/types?seg=severities&error=invalid");
  const input = parsed.data;
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(severities)
      .where(and(eq(severities.tenantId, current.tenant.id), eq(severities.id, input.severityId)));
    if (!row) return;
    await tx
      .update(severities)
      .set({
        name: input.name,
        description: input.description || null,
        postIncident: input.postIncident,
      })
      .where(eq(severities.id, row.id));
    await recordAudit(tx, current, "config", "severity.updated", {
      from: row.name,
      to: input.name,
      postIncident: input.postIncident,
    });
  });
  revalidatePath("/app/settings/types");
  redirect("/app/settings/types?seg=severities&saved=1");
}

const statusSchema = z.object({
  statusId: z.string().uuid(),
  typeId: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).optional(),
  updateReminderMinutes: z.string().optional(),
  publicStatus: z.enum(["investigating", "identified", "monitoring"]).or(z.literal("")).optional(),
});

export async function saveStatus(formData: FormData) {
  const current = await requireManager();
  const parsed = statusSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect("/app/settings/types?error=invalid");
  const input = parsed.data;
  const countsInMttr = formData.get("countsInMttr") === "on";
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(incidentStatuses)
      .where(
        and(
          eq(incidentStatuses.tenantId, current.tenant.id),
          eq(incidentStatuses.id, input.statusId),
        ),
      );
    if (!row) return;
    await tx
      .update(incidentStatuses)
      .set({
        name: input.name,
        description: input.description || null,
        updateReminderMinutes: input.updateReminderMinutes
          ? Number(input.updateReminderMinutes)
          : null,
        publicStatus: input.publicStatus || null,
        countsInMttr,
      })
      .where(eq(incidentStatuses.id, row.id));
    await recordAudit(tx, current, "config", "incident_status.updated", {
      from: row.name,
      to: input.name,
    });
  });
  revalidatePath("/app/settings/types");
  revalidatePath("/app/incidents");
  redirect(`/app/settings/types?type=${input.typeId}&node=${input.statusId}&saved=1`);
}

const typeSchema = z.object({
  name: z.string().trim().min(2).max(60),
  baseTypeId: z.string().uuid(),
  teamEntryId: z.string().uuid().or(z.literal("")),
});

/**
 * "+ New type": a copy of a base type — its lifecycle statuses, its form, its
 * post-incident entry rule — under a new name, optionally declarable by one
 * team only. Everything is editable afterwards on the type's own page.
 */
export async function createType(formData: FormData) {
  const current = await requireManager();
  const parsed = typeSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect("/app/settings/types?error=invalid");
  const input = parsed.data;
  const created = await withTenant(current.tenant.id, async (tx) => {
    const types = await tx
      .select()
      .from(incidentTypes)
      .where(eq(incidentTypes.tenantId, current.tenant.id));
    const base = types.find((x) => x.id === input.baseTypeId);
    if (!base) redirect("/app/settings/types?error=invalid");
    if (types.some((x) => x.name.toLowerCase() === input.name.toLowerCase()))
      redirect("/app/settings/types?error=duplicate");
    const omit = (o: Record<string, unknown>, keys: string[]) =>
      Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
    const [type] = await tx
      .insert(incidentTypes)
      .values({
        ...(omit(base, [
          "id",
          "tenantId",
          "name",
          "isDefault",
          "restrictedToTeamIds",
          "position",
          "createdAt",
          "updatedAt",
        ]) as Partial<typeof incidentTypes.$inferInsert>),
        tenantId: current.tenant.id,
        name: input.name,
        isDefault: false,
        restrictedToTeamIds: input.teamEntryId ? [input.teamEntryId] : null,
        position: Math.max(-1, ...types.map((x) => x.position)) + 1,
      } as typeof incidentTypes.$inferInsert)
      .returning({ id: incidentTypes.id });
    const statuses = await tx
      .select()
      .from(incidentStatuses)
      .where(eq(incidentStatuses.typeId, base.id));
    for (const st of statuses) {
      await tx.insert(incidentStatuses).values({
        ...(omit(st, ["id", "typeId", "createdAt", "updatedAt"]) as Partial<
          typeof incidentStatuses.$inferInsert
        >),
        tenantId: current.tenant.id,
        typeId: type!.id,
      } as typeof incidentStatuses.$inferInsert);
    }
    await recordAudit(tx, current, "config", "incident_type.created", {
      name: input.name,
      basedOn: base.name,
      team: input.teamEntryId || null,
    });
    return type!.id;
  });
  revalidatePath("/app/settings/types");
  revalidatePath("/app/incidents/new");
  redirect(`/app/settings/types?type=${created}&saved=1`);
}
