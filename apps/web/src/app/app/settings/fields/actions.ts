"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { incidentFields, incidentTypes, withTenant, type DeclareFormField } from "@openincident/db";
import { getT } from "@/i18n/server";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";
import type { DialogResult } from "@/components/settings/dialog";

const KINDS = ["text", "long_text", "select", "number", "link"] as const;

const schema = z.object({
  id: z.string().uuid().or(z.literal("")).optional(),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(KINDS).optional(),
  options: z.string().optional(),
  required: z.enum(["optional", "required"]).default("optional"),
  types: z.string().uuid().or(z.literal("")).default(""),
});

/** The API name a label makes: lowercase, underscores, starting with a letter. */
function keyFrom(name: string, taken: Set<string>): string {
  let base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36);
  if (!/^[a-z]/.test(base)) base = `f_${base}`.replace(/_+$/, "");
  if (base.length < 2) base = `${base}_field`;
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}_${i}`;
  return key;
}

function optionsOf(raw: string | undefined): string[] {
  return [
    ...new Set(
      (raw ?? "")
        .split(/[\n,]/)
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  ].slice(0, 50);
}

/**
 * "+ New field" and "Edit": the name (its API name is made from it once, at
 * creation), the kind (fixed afterwards: incidents may hold values of it),
 * the options of a single select, whether declaring asks for it, and the
 * types it belongs to. The required-ness is written into the declaration
 * form of every type the field belongs to — the form is what reads it.
 *
 * The same dialog deletes it (`intent=delete`): it leaves every form; the
 * values recorded on past incidents stay.
 */
export async function saveField(_prev: DialogResult, formData: FormData): Promise<DialogResult> {
  const current = await requireManager();
  const t = await getT();
  if (formData.get("intent") === "delete") return removeField(formData);
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: t("settingsV2.fields.errorName") };
  const input = parsed.data;
  const options = optionsOf(input.options);

  const out = await withTenant(current.tenant.id, async (tx) => {
    const fields = await tx
      .select()
      .from(incidentFields)
      .where(eq(incidentFields.tenantId, current.tenant.id));
    const types = await tx
      .select()
      .from(incidentTypes)
      .where(eq(incidentTypes.tenantId, current.tenant.id));
    const row = input.id ? fields.find((f) => f.id === input.id) : undefined;
    if (input.id && !row) return t("settingsV2.error.invalid");
    if (fields.some((f) => f.id !== row?.id && f.label.toLowerCase() === input.name.toLowerCase()))
      return t("settingsV2.fields.errorDuplicate");
    if (input.types && !types.some((ty) => ty.id === input.types))
      return t("settingsV2.error.invalid");
    const kind = row ? row.type : input.kind;
    if (!kind) return t("settingsV2.error.invalid");
    if (kind === "select" && options.length === 0) return t("settingsV2.fields.errorOptions");
    const typeId = input.types || null;
    const required = input.required === "required";

    let key: string;
    if (row) {
      key = row.key;
      await tx
        .update(incidentFields)
        .set({
          label: input.name,
          options: kind === "select" ? options : row.options,
          incidentTypeId: typeId,
        })
        .where(eq(incidentFields.id, row.id));
    } else {
      key = keyFrom(input.name, new Set(fields.map((f) => f.key)));
      const [maxRow] = await tx
        .select({
          max: sql<number>`coalesce(max(${incidentFields.position}), -1)`.mapWith(Number),
        })
        .from(incidentFields)
        .where(eq(incidentFields.tenantId, current.tenant.id));
      await tx.insert(incidentFields).values({
        tenantId: current.tenant.id,
        key,
        label: input.name,
        type: kind as (typeof KINDS)[number],
        options: kind === "select" ? options : [],
        incidentTypeId: typeId,
        position: (maxRow?.max ?? -1) + 1,
      });
    }

    // Every type the field belongs to asks for it, as chosen; the others drop it.
    for (const ty of types) {
      const covered = typeId === null || ty.id === typeId;
      const without = ty.declareForm.filter((f) => f.key !== key);
      const next: DeclareFormField[] = covered ? [...without, { key, required }] : without;
      const was = ty.declareForm.find((f) => f.key === key);
      const same = covered ? was?.required === required : !was;
      if (same) continue;
      // Keep the field's place in the form when it was already there.
      const ordered =
        was && covered ? ty.declareForm.map((f) => (f.key === key ? { key, required } : f)) : next;
      await tx
        .update(incidentTypes)
        .set({ declareForm: ordered })
        .where(eq(incidentTypes.id, ty.id));
    }
    await recordAudit(
      tx,
      current,
      "config",
      row ? "incident_field.updated" : "incident_field.created",
      { key, type: kind, required, incidentType: typeId },
    );
    return row ? "saved" : "created";
  });
  if (out !== "saved" && out !== "created") return { ok: false, error: out };
  revalidatePath("/app/settings/fields");
  revalidatePath("/app/settings/types");
  revalidatePath("/app/incidents/new");
  return {
    ok: true,
    message: out === "created" ? t("settingsV2.fields.added") : t("settingsV2.fields.saved"),
  };
}

/** Deleting a field also removes it from every declaration form; stored values stay on past incidents. */
async function removeField(formData: FormData): Promise<DialogResult> {
  const current = await requireManager();
  const t = await getT();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: t("settingsV2.error.invalid") };
  await withTenant(current.tenant.id, async (tx) => {
    const [field] = await tx
      .select()
      .from(incidentFields)
      .where(and(eq(incidentFields.tenantId, current.tenant.id), eq(incidentFields.id, id.data)));
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
  revalidatePath("/app/incidents/new");
  return { ok: true, message: t("settingsV2.fields.deleted") };
}
