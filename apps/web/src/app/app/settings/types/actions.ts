"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  incidentFields,
  incidentStatuses,
  incidentTypes,
  incidents,
  withTenant,
  workspaces,
} from "@openincident/db";
import { getT } from "@/i18n/server";
import { parseTemplateField } from "@/lib/post-mortem-template";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";
import type { DialogResult } from "@/components/settings/dialog";
import type { FormResult } from "@/components/settings/settings-form";

const PAGE = "/app/settings/types";

/** What a gesture of the lifecycle answers: the toast to show, or why nothing changed. */
export type Done = { ok: true; message: string } | { ok: false; error: string };

/** A dialog answer that also says where to go next (the new type, the default one). */
export type Moved = { ok: true; message: string; href: string } | { ok: false; error: string };

function revalidate() {
  revalidatePath(PAGE);
  revalidatePath("/app/incidents/new");
}

/* ---------- Types ---------- */

const typeSchema = z.object({
  name: z.string().trim().min(2).max(60),
  baseTypeId: z.string().uuid(),
});

/**
 * "+ New type": a copy of a base type — its statuses, its declaration form,
 * who may declare it, its privacy and its post-incident threshold — under a
 * new name. Everything is editable afterwards on the type's own sheet.
 */
export async function createType(_prev: Moved | null, formData: FormData): Promise<Moved> {
  const current = await requireManager();
  const t = await getT();
  const parsed = typeSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: t("settingsV2.types.errorName") };
  const input = parsed.data;
  const out = await withTenant(current.tenant.id, async (tx) => {
    const types = await tx
      .select()
      .from(incidentTypes)
      .where(eq(incidentTypes.tenantId, current.tenant.id));
    const base = types.find((x) => x.id === input.baseTypeId);
    if (!base) return { error: t("settingsV2.error.invalid") };
    if (types.some((x) => x.name.toLowerCase() === input.name.toLowerCase()))
      return { error: t("settingsV2.types.errorDuplicate") };
    const [type] = await tx
      .insert(incidentTypes)
      .values({
        tenantId: current.tenant.id,
        name: input.name,
        description: base.description,
        isDefault: false,
        privateByDefault: base.privateByDefault,
        restrictedToTeamIds: base.restrictedToTeamIds,
        postIncidentFromRank: base.postIncidentFromRank,
        declareForm: base.declareForm,
        position: Math.max(-1, ...types.map((x) => x.position)) + 1,
      })
      .returning({ id: incidentTypes.id });
    const statuses = await tx
      .select()
      .from(incidentStatuses)
      .where(eq(incidentStatuses.typeId, base.id));
    for (const st of statuses)
      await tx.insert(incidentStatuses).values({
        tenantId: current.tenant.id,
        typeId: type!.id,
        name: st.name,
        description: st.description,
        rank: st.rank,
        updateReminderMinutes: st.updateReminderMinutes,
        countsInMttr: st.countsInMttr,
        publicStatus: st.publicStatus,
      });
    await recordAudit(tx, current, "config", "incident_type.created", {
      name: input.name,
      basedOn: base.name,
    });
    return { id: type!.id, base: base.name };
  });
  if ("error" in out) return { ok: false, error: out.error ?? t("settingsV2.error.invalid") };
  revalidate();
  return {
    ok: true,
    message: t("settingsV2.types.created", { base: out.base }),
    href: `${PAGE}?type=${out.id}`,
  };
}

/** Removes a type nobody has used. A type with incidents stays: they point at it. */
export async function deleteType(_prev: Moved | null, formData: FormData): Promise<Moved> {
  const current = await requireManager();
  const t = await getT();
  const typeId = z.string().uuid().safeParse(formData.get("typeId"));
  if (!typeId.success) return { ok: false, error: t("settingsV2.error.invalid") };
  const outcome = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(incidentTypes)
      .where(and(eq(incidentTypes.tenantId, current.tenant.id), eq(incidentTypes.id, typeId.data)));
    if (!row || row.isDefault) return "refused" as const;
    const [used] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(incidents)
      .where(and(eq(incidents.tenantId, current.tenant.id), eq(incidents.typeId, row.id)));
    if ((used?.n ?? 0) > 0) return "in_use" as const;
    await tx.delete(incidentStatuses).where(eq(incidentStatuses.typeId, row.id));
    await tx.delete(incidentTypes).where(eq(incidentTypes.id, row.id));
    await recordAudit(tx, current, "config", "incident_type.deleted", { name: row.name });
    return "deleted" as const;
  });
  if (outcome === "in_use") return { ok: false, error: t("settingsV2.types.errorInUse") };
  if (outcome === "refused") return { ok: false, error: t("settingsV2.error.invalid") };
  revalidate();
  return { ok: true, message: t("settingsV2.types.deleted"), href: PAGE };
}

const rulesSchema = z.object({
  typeId: z.string().uuid(),
  name: z.string().trim().min(2).max(60),
  teamId: z.string().uuid().or(z.literal("")).optional(),
  // "never" | "always" | "<severity rank>"
  rule: z.string(),
});

/**
 * The "Rules for <type>" card, saved as one: its name, who may declare it,
 * whether its incidents start private, and from which severity a resolved
 * incident of this type enters the post-incident flow.
 */
export async function saveTypeRules(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const current = await requireManager();
  const t = await getT();
  const parsed = rulesSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: t("settingsV2.error.invalid") };
  const input = parsed.data;
  const privateByDefault = formData.get("privateByDefault") === "on";
  const fromRank =
    input.rule === "never" ? null : input.rule === "always" ? -1 : Number(input.rule);
  if (fromRank !== null && !Number.isInteger(fromRank))
    return { ok: false, error: t("settingsV2.error.invalid") };
  const out = await withTenant(current.tenant.id, async (tx) => {
    const types = await tx
      .select()
      .from(incidentTypes)
      .where(eq(incidentTypes.tenantId, current.tenant.id));
    const row = types.find((x) => x.id === input.typeId);
    if (!row) return "invalid" as const;
    if (types.some((x) => x.id !== row.id && x.name.toLowerCase() === input.name.toLowerCase()))
      return "duplicate" as const;
    // The default type is everyone's: it cannot be narrowed to a team.
    const restricted = row.isDefault || !input.teamId ? null : [input.teamId];
    await tx
      .update(incidentTypes)
      .set({
        name: input.name,
        restrictedToTeamIds: restricted,
        privateByDefault,
        postIncidentFromRank: fromRank,
      })
      .where(eq(incidentTypes.id, row.id));
    await recordAudit(tx, current, "config", "incident_type.updated", {
      from: row.name,
      to: input.name,
      team: restricted?.[0] ?? null,
      privateByDefault,
      rule: input.rule,
    });
    return "saved" as const;
  });
  if (out === "duplicate") return { ok: false, error: t("settingsV2.types.errorDuplicate") };
  if (out === "invalid") return { ok: false, error: t("settingsV2.error.invalid") };
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * The declaration form of a type: for each of the system fields and of the
 * custom fields of this type or of every type, required, optional or not
 * asked. The title is always asked.
 */
export async function saveDeclareForm(
  _prev: DialogResult,
  formData: FormData,
): Promise<DialogResult> {
  const current = await requireManager();
  const t = await getT();
  const typeId = z.string().uuid().safeParse(formData.get("typeId"));
  if (!typeId.success) return { ok: false, error: t("settingsV2.error.invalid") };
  const asks = new Map<string, "required" | "optional" | "off">();
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("ask.")) continue;
    const choice = String(v);
    if (choice === "required" || choice === "optional" || choice === "off")
      asks.set(k.slice(4), choice);
  }
  const ok = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(incidentTypes)
      .where(and(eq(incidentTypes.tenantId, current.tenant.id), eq(incidentTypes.id, typeId.data)));
    if (!row) return false;
    const fields = await tx
      .select({ key: incidentFields.key, typeId: incidentFields.incidentTypeId })
      .from(incidentFields)
      .where(eq(incidentFields.tenantId, current.tenant.id))
      .orderBy(asc(incidentFields.position));
    // Only keys the form may carry: the system fields, and the custom fields
    // that belong to this type or to every type.
    const allowed = [
      "severity",
      "service",
      "summary",
      ...fields.filter((f) => f.typeId === null || f.typeId === row.id).map((f) => f.key),
    ];
    const declareForm = [{ key: "title", required: true }];
    for (const key of allowed) {
      const was = row.declareForm.find((f) => f.key === key);
      const ask = asks.get(key) ?? (was ? (was.required ? "required" : "optional") : "off");
      if (ask === "required") declareForm.push({ key, required: true });
      if (ask === "optional") declareForm.push({ key, required: false });
    }
    await tx.update(incidentTypes).set({ declareForm }).where(eq(incidentTypes.id, row.id));
    await recordAudit(tx, current, "config", "incident_type.form_updated", {
      name: row.name,
      fields: declareForm.map((f) => `${f.key}${f.required ? "*" : ""}`),
    });
    return true;
  });
  if (!ok) return { ok: false, error: t("settingsV2.error.invalid") };
  revalidate();
  return { ok: true, message: t("settingsV2.types.formSaved") };
}

/**
 * The post-incident flow's shared parts: the word the workspace uses, and
 * the sections a new post-mortem starts with (or the product's, on reset).
 */
export async function savePostMortem(
  _prev: DialogResult,
  formData: FormData,
): Promise<DialogResult> {
  const current = await requireManager();
  const t = await getT();
  const term = z
    .string()
    .trim()
    .max(40)
    .safeParse(formData.get("term") ?? "");
  if (!term.success) return { ok: false, error: t("settingsV2.error.invalid") };
  const reset = formData.get("resetTemplate") === "1";
  const raw = formData.get("template");
  const template = reset || raw === null ? null : parseTemplateField(String(raw));
  if (template === "invalid") return { ok: false, error: t("settingsV2.error.invalid") };
  await withTenant(current.tenant.id, async (tx) => {
    await tx
      .update(workspaces)
      .set({
        postMortemTerm: term.data || null,
        ...(reset || template !== null ? { postMortemTemplate: reset ? null : template } : {}),
        updatedAt: new Date(),
      })
      .where(eq(workspaces.tenantId, current.tenant.id));
    await recordAudit(tx, current, "config", "workspace.post_mortem_settings", {
      term: term.data || null,
      sections: reset ? null : (template?.map((x) => x.key) ?? undefined),
    });
  });
  revalidatePath("/", "layout");
  return { ok: true, message: t("settingsV2.types.pmSaved") };
}

/* ---------- The active statuses ---------- */

/** A new status at the end of the type's list. */
export async function addStatus(formData: FormData): Promise<Done> {
  const current = await requireManager();
  const t = await getT();
  const parsed = z
    .object({ typeId: z.string().uuid(), name: z.string().trim().min(1).max(60) })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: t("settingsV2.error.name") };
  const { typeId, name } = parsed.data;
  const out = await withTenant(current.tenant.id, async (tx) => {
    const [type] = await tx
      .select()
      .from(incidentTypes)
      .where(and(eq(incidentTypes.tenantId, current.tenant.id), eq(incidentTypes.id, typeId)));
    if (!type) return "invalid" as const;
    const existing = await tx
      .select({ rank: incidentStatuses.rank, name: incidentStatuses.name })
      .from(incidentStatuses)
      .where(eq(incidentStatuses.typeId, typeId));
    if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase()))
      return "invalid" as const;
    await tx.insert(incidentStatuses).values({
      tenantId: current.tenant.id,
      typeId,
      name,
      rank: Math.max(-1, ...existing.map((s) => s.rank)) + 1,
      countsInMttr: true,
    });
    await recordAudit(tx, current, "config", "incident_status.created", { type: type.name, name });
    return "saved" as const;
  });
  if (out !== "saved") return { ok: false, error: t("settingsV2.error.invalid") };
  revalidate();
  revalidatePath("/app/incidents");
  return { ok: true, message: t("settingsV2.types.statusAdded") };
}

const statusSchema = z.object({
  statusId: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).optional(),
  updateReminderMinutes: z.string().optional(),
  publicStatus: z.enum(["investigating", "identified", "monitoring"]).or(z.literal("")).optional(),
});

export async function saveStatus(formData: FormData): Promise<Done> {
  const current = await requireManager();
  const t = await getT();
  const parsed = statusSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: t("settingsV2.error.invalid") };
  const input = parsed.data;
  const minutes = input.updateReminderMinutes ? Number(input.updateReminderMinutes) : null;
  if (minutes !== null && !Number.isInteger(minutes))
    return { ok: false, error: t("settingsV2.error.invalid") };
  const countsInMttr = formData.get("countsInMttr") === "on";
  const found = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(incidentStatuses)
      .where(
        and(
          eq(incidentStatuses.tenantId, current.tenant.id),
          eq(incidentStatuses.id, input.statusId),
        ),
      );
    if (!row) return false;
    await tx
      .update(incidentStatuses)
      .set({
        name: input.name,
        description: input.description || null,
        updateReminderMinutes: minutes,
        publicStatus: input.publicStatus || null,
        countsInMttr,
      })
      .where(eq(incidentStatuses.id, row.id));
    await recordAudit(tx, current, "config", "incident_status.updated", {
      from: row.name,
      to: input.name,
    });
    return true;
  });
  if (!found) return { ok: false, error: t("settingsV2.error.invalid") };
  revalidate();
  revalidatePath("/app/incidents");
  return { ok: true, message: t("settingsV2.types.statusSaved") };
}

/** Swaps the status with its neighbour; ranks stay dense. */
export async function moveStatus(formData: FormData): Promise<Done> {
  const current = await requireManager();
  const t = await getT();
  const parsed = z
    .object({ statusId: z.string().uuid(), typeId: z.string().uuid(), dir: z.enum(["up", "down"]) })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: t("settingsV2.error.invalid") };
  const { statusId, typeId, dir } = parsed.data;
  await withTenant(current.tenant.id, async (tx) => {
    const rows = await tx
      .select()
      .from(incidentStatuses)
      .where(
        and(eq(incidentStatuses.tenantId, current.tenant.id), eq(incidentStatuses.typeId, typeId)),
      )
      .orderBy(asc(incidentStatuses.rank));
    const i = rows.findIndex((s) => s.id === statusId);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= rows.length) return;
    const order = rows.map((s) => s.id);
    [order[i], order[j]] = [order[j]!, order[i]!];
    // Park every rank above the range first: (type, rank) is unique.
    for (const [k, id] of order.entries())
      await tx
        .update(incidentStatuses)
        .set({ rank: 1000 + k })
        .where(eq(incidentStatuses.id, id));
    for (const [k, id] of order.entries())
      await tx.update(incidentStatuses).set({ rank: k }).where(eq(incidentStatuses.id, id));
    await recordAudit(tx, current, "config", "incident_status.moved", {
      name: rows[i]!.name,
      dir,
    });
  });
  revalidate();
  return { ok: true, message: t("settingsV2.types.statusMoved") };
}

/**
 * Removes a status no active incident is in. The column is `on delete set
 * null`, so deleting a status under an incident would leave it with no status
 * at all; the screen says how many are there and refuses instead.
 */
export async function deleteStatus(formData: FormData): Promise<Done> {
  const current = await requireManager();
  const t = await getT();
  const parsed = z
    .object({ statusId: z.string().uuid(), typeId: z.string().uuid() })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: t("settingsV2.error.invalid") };
  const { statusId, typeId } = parsed.data;
  const outcome = await withTenant(current.tenant.id, async (tx) => {
    const rows = await tx
      .select()
      .from(incidentStatuses)
      .where(
        and(eq(incidentStatuses.tenantId, current.tenant.id), eq(incidentStatuses.typeId, typeId)),
      );
    const row = rows.find((s) => s.id === statusId);
    if (!row) return "refused" as const;
    if (rows.length <= 1) return "last_status" as const;
    const [inIt] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(incidents)
      .where(
        and(
          eq(incidents.tenantId, current.tenant.id),
          eq(incidents.statusId, statusId),
          eq(incidents.phase, "active"),
        ),
      );
    if ((inIt?.n ?? 0) > 0) return "status_in_use" as const;
    await tx.delete(incidentStatuses).where(eq(incidentStatuses.id, row.id));
    await recordAudit(tx, current, "config", "incident_status.deleted", { name: row.name });
    return "deleted" as const;
  });
  if (outcome === "last_status") return { ok: false, error: t("settings.types.errorLastStatus") };
  if (outcome === "status_in_use")
    return { ok: false, error: t("settings.types.errorStatusInUse") };
  if (outcome === "refused") return { ok: false, error: t("settingsV2.error.invalid") };
  revalidate();
  revalidatePath("/app/incidents");
  return { ok: true, message: t("settingsV2.types.statusRemoved") };
}
