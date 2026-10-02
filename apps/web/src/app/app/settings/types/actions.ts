"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  incidentFields,
  incidentStatuses,
  incidentTypes,
  incidents,
  severities,
  withTenant,
} from "@openincident/db";
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
  redirect(`/app/settings/types?type=${input.typeId}&saved=1`);
}

const typeSchema = z.object({
  name: z.string().trim().min(2).max(60),
  baseTypeId: z.string().uuid(),
  teamId: z.string().uuid().or(z.literal("")),
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
        restrictedToTeamIds: input.teamId ? [input.teamId] : null,
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
      team: input.teamId || null,
    });
    return type!.id;
  });
  revalidatePath("/app/settings/types");
  revalidatePath("/app/incidents/new");
  redirect(`/app/settings/types?type=${created}&saved=1`);
}

/** Removes a type nobody has used. A type with incidents stays: they point at it. */
export async function deleteType(formData: FormData) {
  const current = await requireManager();
  const typeId = z.string().uuid().parse(formData.get("typeId"));
  const outcome = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(incidentTypes)
      .where(and(eq(incidentTypes.tenantId, current.tenant.id), eq(incidentTypes.id, typeId)));
    if (!row || row.isDefault) return "refused";
    const [used] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(incidents)
      .where(and(eq(incidents.tenantId, current.tenant.id), eq(incidents.typeId, typeId)));
    if ((used?.n ?? 0) > 0) return "in_use";
    await tx.delete(incidentStatuses).where(eq(incidentStatuses.typeId, row.id));
    await tx.delete(incidentTypes).where(eq(incidentTypes.id, row.id));
    await recordAudit(tx, current, "config", "incident_type.deleted", { name: row.name });
    return "deleted";
  });
  revalidatePath("/app/settings/types");
  revalidatePath("/app/incidents/new");
  if (outcome === "deleted") redirect("/app/settings/types?saved=1");
  redirect(`/app/settings/types?type=${typeId}&error=${outcome}`);
}

/* ---------- The active statuses ---------- */

/** A new status at the end of the type's list. */
export async function addStatus(formData: FormData) {
  const current = await requireManager();
  const parsed = z
    .object({ typeId: z.string().uuid(), name: z.string().trim().min(1).max(60) })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect("/app/settings/types?error=invalid");
  const { typeId, name } = parsed.data;
  await withTenant(current.tenant.id, async (tx) => {
    const [type] = await tx
      .select()
      .from(incidentTypes)
      .where(and(eq(incidentTypes.tenantId, current.tenant.id), eq(incidentTypes.id, typeId)));
    if (!type) return;
    const existing = await tx
      .select({ rank: incidentStatuses.rank })
      .from(incidentStatuses)
      .where(eq(incidentStatuses.typeId, typeId));
    await tx.insert(incidentStatuses).values({
      tenantId: current.tenant.id,
      typeId,
      name,
      rank: Math.max(-1, ...existing.map((s) => s.rank)) + 1,
      countsInMttr: true,
    });
    await recordAudit(tx, current, "config", "incident_status.created", {
      type: type.name,
      name,
    });
  });
  revalidatePath("/app/settings/types");
  revalidatePath("/app/incidents");
  redirect(`/app/settings/types?type=${typeId}&saved=1`);
}

/** Swaps the status with its neighbour; ranks stay dense. */
export async function moveStatus(formData: FormData) {
  const current = await requireManager();
  const parsed = z
    .object({ statusId: z.string().uuid(), typeId: z.string().uuid(), dir: z.enum(["up", "down"]) })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect("/app/settings/types?error=invalid");
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
  revalidatePath("/app/settings/types");
  redirect(`/app/settings/types?type=${typeId}&saved=1`);
}

/**
 * Removes a status no active incident is in. The column is `on delete set
 * null`, so deleting a status under an incident would leave it with no status
 * at all; the screen says how many are there and refuses instead.
 */
export async function deleteStatus(formData: FormData) {
  const current = await requireManager();
  const parsed = z
    .object({ statusId: z.string().uuid(), typeId: z.string().uuid() })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect("/app/settings/types?error=invalid");
  const { statusId, typeId } = parsed.data;
  const outcome = await withTenant(current.tenant.id, async (tx) => {
    const rows = await tx
      .select()
      .from(incidentStatuses)
      .where(
        and(eq(incidentStatuses.tenantId, current.tenant.id), eq(incidentStatuses.typeId, typeId)),
      );
    const row = rows.find((s) => s.id === statusId);
    if (!row) return "refused";
    if (rows.length <= 1) return "last_status";
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
    if ((inIt?.n ?? 0) > 0) return "status_in_use";
    await tx.delete(incidentStatuses).where(eq(incidentStatuses.id, row.id));
    await recordAudit(tx, current, "config", "incident_status.deleted", { name: row.name });
    return "deleted";
  });
  revalidatePath("/app/settings/types");
  revalidatePath("/app/incidents");
  if (outcome === "deleted") redirect(`/app/settings/types?type=${typeId}&saved=1`);
  redirect(`/app/settings/types?type=${typeId}&error=${outcome}`);
}

/* ---------- The type's sheet: one Save ---------- */

const sheetSchema = z.object({
  typeId: z.string().uuid(),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).optional(),
  teamId: z.string().uuid().or(z.literal("")).optional(),
  // "never" | "always" | "<severity rank>"
  rule: z.string(),
});

/**
 * Name, description, who may declare it, visibility, what its form asks and
 * when its incidents enter the post-incident flow — the sheet, saved as one.
 * The statuses are a list with their own gestures and stay outside.
 */
export async function saveTypeSheet(formData: FormData) {
  const current = await requireManager();
  const parsed = sheetSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect("/app/settings/types?error=invalid");
  const input = parsed.data;
  const privateByDefault = formData.get("privateByDefault") === "on";
  const fromRank =
    input.rule === "never" ? null : input.rule === "always" ? -1 : Number(input.rule);
  if (fromRank !== null && !Number.isInteger(fromRank))
    redirect(`/app/settings/types?type=${input.typeId}&error=invalid`);
  const asks = new Map<string, "required" | "optional" | "off">();
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("ask.")) continue;
    const choice = String(v);
    if (choice === "required" || choice === "optional" || choice === "off")
      asks.set(k.slice(4), choice);
  }
  await withTenant(current.tenant.id, async (tx) => {
    const types = await tx
      .select()
      .from(incidentTypes)
      .where(eq(incidentTypes.tenantId, current.tenant.id));
    const row = types.find((x) => x.id === input.typeId);
    if (!row) return;
    if (types.some((x) => x.id !== row.id && x.name.toLowerCase() === input.name.toLowerCase()))
      redirect(`/app/settings/types?type=${row.id}&error=duplicate`);
    // Only keys the form may carry: the four system fields, and the custom
    // fields that belong to this type or to every type.
    const fields = await tx
      .select({ key: incidentFields.key, typeId: incidentFields.incidentTypeId })
      .from(incidentFields)
      .where(eq(incidentFields.tenantId, current.tenant.id));
    const allowed = new Set([
      "title",
      "severity",
      "service",
      "summary",
      ...fields.filter((f) => f.typeId === null || f.typeId === row.id).map((f) => f.key),
    ]);
    const declareForm = [{ key: "title", required: true }];
    for (const key of allowed) {
      if (key === "title") continue;
      const ask = asks.get(key);
      if (ask === "required") declareForm.push({ key, required: true });
      if (ask === "optional") declareForm.push({ key, required: false });
    }
    await tx
      .update(incidentTypes)
      .set({
        name: input.name,
        description: input.description || null,
        // The default type is everyone's: it cannot be narrowed to a team.
        restrictedToTeamIds: row.isDefault || !input.teamId ? null : [input.teamId],
        privateByDefault,
        postIncidentFromRank: fromRank,
        declareForm,
      })
      .where(eq(incidentTypes.id, row.id));
    await recordAudit(tx, current, "config", "incident_type.updated", {
      from: row.name,
      to: input.name,
      team: row.isDefault ? null : input.teamId || null,
      privateByDefault,
      rule: input.rule,
      fields: declareForm.map((f) => `${f.key}${f.required ? "*" : ""}`),
    });
  });
  revalidatePath("/app/settings/types");
  revalidatePath("/app/settings/fields");
  revalidatePath("/app/settings/post-incident");
  revalidatePath("/app/incidents/new");
  redirect(`/app/settings/types?type=${input.typeId}&saved=1`);
}
