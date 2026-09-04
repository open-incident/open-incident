"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { incidentFields, incidentTypes, withTenant } from "@openincident/db";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";

const schema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,39}$/),
  label: z.string().trim().max(80).optional(),
  type: z.enum(["text", "long_text", "select", "number", "link", "catalog_entry"]),
  incidentTypeId: z.string().uuid().or(z.literal("")),
  options: z.string().optional(),
  required: z.string().optional(),
});

/**
 * Creates a custom field and, when a type is named, adds it to that type's
 * declaration form — a field exists to be read, and the form is its reader.
 */
export async function createField(formData: FormData) {
  const current = await requireManager();
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect("/app/settings/fields?error=invalid");
  const input = parsed.data;
  const options =
    input.type === "select"
      ? (input.options ?? "")
          .split(/[\n,]/)
          .map((o) => o.trim())
          .filter(Boolean)
      : [];
  if (input.type === "select" && options.length === 0)
    redirect("/app/settings/fields?error=options");
  const required = input.required === "on";

  await withTenant(current.tenant.id, async (tx) => {
    const [dup] = await tx
      .select({ id: incidentFields.id })
      .from(incidentFields)
      .where(
        and(eq(incidentFields.tenantId, current.tenant.id), eq(incidentFields.key, input.key)),
      );
    if (dup) redirect("/app/settings/fields?error=duplicate");
    const [maxRow] = await tx
      .select({ max: sql<number>`coalesce(max(${incidentFields.position}), -1)`.mapWith(Number) })
      .from(incidentFields)
      .where(eq(incidentFields.tenantId, current.tenant.id));
    await tx.insert(incidentFields).values({
      tenantId: current.tenant.id,
      key: input.key,
      label: input.label || input.key,
      type: input.type,
      options,
      incidentTypeId: input.incidentTypeId || null,
      position: (maxRow?.max ?? -1) + 1,
    });
    if (input.incidentTypeId) {
      const [type] = await tx
        .select()
        .from(incidentTypes)
        .where(
          and(
            eq(incidentTypes.tenantId, current.tenant.id),
            eq(incidentTypes.id, input.incidentTypeId),
          ),
        );
      if (type && !type.declareForm.some((f) => f.key === input.key)) {
        await tx
          .update(incidentTypes)
          .set({ declareForm: [...type.declareForm, { key: input.key, required }] })
          .where(eq(incidentTypes.id, type.id));
      }
    }
    await recordAudit(tx, current, "config", "incident_field.created", {
      key: input.key,
      type: input.type,
    });
  });
  revalidatePath("/app/settings/fields");
  revalidatePath("/app/settings/types");
  redirect("/app/settings/fields?saved=1");
}

/** Deleting a field also removes it from every declaration form; stored values stay on past incidents. */
export async function deleteField(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [field] = await tx
      .select()
      .from(incidentFields)
      .where(and(eq(incidentFields.tenantId, current.tenant.id), eq(incidentFields.id, id)));
    if (!field) return;
    const types = await tx
      .select()
      .from(incidentTypes)
      .where(eq(incidentTypes.tenantId, current.tenant.id));
    for (const ty of types) {
      if (ty.declareForm.some((f) => f.key === field.key)) {
        await tx
          .update(incidentTypes)
          .set({ declareForm: ty.declareForm.filter((f) => f.key !== field.key) })
          .where(eq(incidentTypes.id, ty.id));
      }
    }
    await tx.delete(incidentFields).where(eq(incidentFields.id, field.id));
    await recordAudit(tx, current, "config", "incident_field.deleted", { key: field.key });
  });
  revalidatePath("/app/settings/fields");
  revalidatePath("/app/settings/types");
}
