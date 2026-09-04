"use server";

import { redirect } from "next/navigation";
import { indexRunbook, refreshRunbook } from "@openincident/ai";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  atlasDocuments,
  catalogEntries,
  catalogTypes,
  runbooks,
  withTenant,
  type Tx,
} from "@openincident/db";
import {
  CORE_TYPE_KEYS,
  entriesFromCsv,
  entryUsages,
  parseAttributes,
  parseEntrySpec,
  parseTypeSpec,
  typeUsages,
  upsertEntries,
  upsertType,
  type EntrySpec,
  type Usage,
} from "@openincident/catalog";
import { getT } from "@/i18n/server";
import { recordAudit } from "@/lib/audit";
import { requireManager, requireResponder, type CurrentMember } from "@/lib/session";

type T = Awaited<ReturnType<typeof getT>>;
type ActionError = { error: string; details?: string[] };

/* ---------- Entries ---------- */

type TypeRow = typeof catalogTypes.$inferSelect;

async function loadType(tx: Tx, tenantId: string, id: string): Promise<TypeRow | undefined> {
  const [type] = await tx
    .select()
    .from(catalogTypes)
    .where(and(eq(catalogTypes.tenantId, tenantId), eq(catalogTypes.id, id)));
  return type;
}

/** The dialog's fields → one entry of the exchange format; attributes arrive as `attr.<key>`. */
function entryFromForm(formData: FormData, type: TypeRow, t: T): EntrySpec | ActionError {
  const attributes: Record<string, unknown> = {};
  for (const def of type.attributes) {
    const raw = formData.get(`attr.${def.key}`);
    attributes[def.key] = raw === null ? "" : String(raw);
  }
  const errors: string[] = [];
  const spec = parseEntrySpec(
    {
      type: type.key,
      id: formData.get("id") ? String(formData.get("id")) : undefined,
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      external_id: String(formData.get("externalId") ?? ""),
      attributes,
    },
    "entry",
    errors,
  );
  if (!spec) return { error: t("catalog.invalid"), details: errors };
  return spec;
}

/** "3 incidents (INC-217, INC-220), 1 status component (Checkout)" — the reasons a deletion is refused. */
function describeUsages(t: T, usages: Array<{ kind: string; count: number; sample: string[] }>) {
  return usages
    .map((u) => {
      const label = t(`catalog.usage.${u.kind as Usage["kind"] | "types"}`, { count: u.count });
      return u.sample.length ? `${label} (${u.sample.join(", ")})` : label;
    })
    .join(" · ");
}

async function writeEntry(
  current: CurrentMember,
  formData: FormData,
  mode: "create" | "update",
): Promise<ActionError | { typeKey: string; name: string }> {
  const t = await getT();
  const typeId = String(formData.get("typeId") ?? "");
  if (!z.string().uuid().safeParse(typeId).success) return { error: t("catalog.invalid") };
  return withTenant<ActionError | { typeKey: string; name: string }>(
    current.tenant.id,
    async (tx) => {
      const type = await loadType(tx, current.tenant.id, typeId);
      if (!type) return { error: t("catalog.invalid") };
      if (type.locked) return { error: t("catalog.lockedError") };
      const spec = entryFromForm(formData, type, t);
      if ("error" in spec) return spec;
      if (mode === "create") {
        const [existing] = await tx
          .select({ id: catalogEntries.id })
          .from(catalogEntries)
          .where(and(eq(catalogEntries.typeId, type.id), eq(catalogEntries.name, spec.name)));
        if (existing) return { error: t("catalog.duplicate", { name: spec.name }) };
        delete spec.id;
      } else if (!spec.id) return { error: t("catalog.invalid") };
      const r = await upsertEntries(tx, current.tenant.id, type.key, [spec]);
      if (r.errors.length) return { error: t("catalog.entryInvalid"), details: r.errors };
      await recordAudit(
        tx,
        current,
        "config",
        mode === "create" ? "catalog.entry_created" : "catalog.entry_updated",
        { type: type.key, name: spec.name, id: r.ids[0] },
      );
      return { typeKey: type.key, name: spec.name };
    },
  );
}

/** Creates a catalog entry with the attributes its type declares; audited, since the catalog drives real paging. */
export async function createEntry(formData: FormData): Promise<ActionError | void> {
  const current = await requireResponder();
  const result = await writeEntry(current, formData, "create");
  if ("error" in result) return result;
  revalidatePath("/app/catalog");
  redirect(`/app/catalog?type=${result.typeKey}&entry=${encodeURIComponent(result.name)}`);
}

export async function updateEntry(formData: FormData): Promise<ActionError | void> {
  const current = await requireResponder();
  const result = await writeEntry(current, formData, "update");
  if ("error" in result) return result;
  revalidatePath("/app/catalog");
  redirect(`/app/catalog?type=${result.typeKey}&entry=${encodeURIComponent(result.name)}`);
}

/** Refused while anything references the entry — the usages are the answer, not a cascade. */
export async function deleteEntry(formData: FormData): Promise<ActionError | void> {
  const current = await requireManager();
  const t = await getT();
  const id = String(formData.get("id") ?? "");
  if (!z.string().uuid().safeParse(id).success) return { error: t("catalog.invalid") };
  const result = await withTenant<ActionError | { typeKey: string }>(
    current.tenant.id,
    async (tx) => {
      const [row] = await tx
        .select({ e: catalogEntries, type: catalogTypes })
        .from(catalogEntries)
        .innerJoin(catalogTypes, eq(catalogTypes.id, catalogEntries.typeId))
        .where(and(eq(catalogEntries.tenantId, current.tenant.id), eq(catalogEntries.id, id)));
      if (!row) return { error: t("catalog.invalid") };
      if (row.type.locked) return { error: t("catalog.lockedError") };
      const usages = await entryUsages(tx, current.tenant.id, id);
      if (usages.length)
        return { error: t("catalog.deleteBlocked", { usages: describeUsages(t, usages) }) };
      await tx.delete(catalogEntries).where(eq(catalogEntries.id, id));
      await recordAudit(tx, current, "config", "catalog.entry_deleted", {
        type: row.type.key,
        name: row.e.name,
        id,
      });
      return { typeKey: row.type.key };
    },
  );
  if ("error" in result) return result;
  revalidatePath("/app/catalog");
  redirect(`/app/catalog?type=${result.typeKey}`);
}

/* ---------- Types ---------- */

type AttrRow = { key: string; label: string; type: string; refTypeKey: string; options: string };

/** The dialog's attribute rows (a JSON field) → validated definitions. */
function attributesFromForm(formData: FormData, errors: string[]) {
  let rows: AttrRow[] = [];
  try {
    const parsed: unknown = JSON.parse(String(formData.get("attributes") ?? "[]"));
    if (Array.isArray(parsed)) rows = parsed as AttrRow[];
  } catch {
    errors.push("attributes: invalid");
  }
  return parseAttributes(
    rows.map((r) => ({
      key: r.key || undefined,
      label: r.label,
      type: r.type,
      refTypeKey: r.type === "entry" ? r.refTypeKey : undefined,
      options: r.type === "select" ? r.options : undefined,
    })),
    "attributes",
    errors,
  );
}

export async function createType(formData: FormData): Promise<ActionError | void> {
  const current = await requireManager();
  const t = await getT();
  const errors: string[] = [];
  const attributes = attributesFromForm(formData, errors);
  const spec = parseTypeSpec(
    {
      key: String(formData.get("key") ?? ""),
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      attributes,
    },
    "type",
    errors,
  );
  if (!spec || errors.length) return { error: t("catalog.typeInvalid"), details: errors };
  const result = await withTenant<ActionError | { key: string }>(current.tenant.id, async (tx) => {
    const [dup] = await tx
      .select({ id: catalogTypes.id })
      .from(catalogTypes)
      .where(and(eq(catalogTypes.tenantId, current.tenant.id), eq(catalogTypes.key, spec.key)));
    if (dup) return { error: t("catalog.typeDuplicate", { key: spec.key }) };
    const r = await upsertType(tx, current.tenant.id, spec, { source: "ui" });
    if (!r.ok) return { error: t("catalog.typeInvalid"), details: r.errors };
    await recordAudit(tx, current, "config", "catalog.type_created", {
      key: spec.key,
      attributes: spec.attributes.map((a) => a.key),
    });
    return { key: spec.key };
  });
  if ("error" in result) return result;
  revalidatePath("/app/catalog");
  redirect(`/app/catalog?type=${result.key}`);
}

/** Name, description and attributes; the key never changes — the API and the CSV headers use it. */
export async function updateType(formData: FormData): Promise<ActionError | void> {
  const current = await requireManager();
  const t = await getT();
  const id = String(formData.get("id") ?? "");
  if (!z.string().uuid().safeParse(id).success) return { error: t("catalog.invalid") };
  const result = await withTenant<ActionError | { key: string }>(current.tenant.id, async (tx) => {
    const type = await loadType(tx, current.tenant.id, id);
    if (!type) return { error: t("catalog.invalid") };
    if (type.locked) return { error: t("catalog.lockedError") };
    const errors: string[] = [];
    const attributes = attributesFromForm(formData, errors);
    const spec = parseTypeSpec(
      {
        key: type.key,
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? ""),
        attributes,
      },
      "type",
      errors,
    );
    if (!spec || errors.length) return { error: t("catalog.typeInvalid"), details: errors };
    const r = await upsertType(tx, current.tenant.id, spec);
    if (!r.ok) return { error: t("catalog.typeInvalid"), details: r.errors };
    if (r.changed)
      await recordAudit(tx, current, "config", "catalog.type_updated", {
        key: type.key,
        attributes: spec.attributes.map((a) => a.key),
      });
    return { key: type.key };
  });
  if ("error" in result) return result;
  revalidatePath("/app/catalog");
  redirect(`/app/catalog?type=${result.key}`);
}

/** Only an empty, unreferenced, non-core type goes; the usages are listed otherwise. */
export async function deleteType(formData: FormData): Promise<ActionError | void> {
  const current = await requireManager();
  const t = await getT();
  const id = String(formData.get("id") ?? "");
  if (!z.string().uuid().safeParse(id).success) return { error: t("catalog.invalid") };
  const result = await withTenant<ActionError | { ok: true }>(current.tenant.id, async (tx) => {
    const type = await loadType(tx, current.tenant.id, id);
    if (!type) return { error: t("catalog.invalid") };
    if ((CORE_TYPE_KEYS as readonly string[]).includes(type.key))
      return { error: t("catalog.coreType") };
    if (type.locked) return { error: t("catalog.lockedError") };
    const usages = await typeUsages(tx, current.tenant.id, id);
    if (usages.length)
      return { error: t("catalog.deleteTypeBlocked", { usages: describeUsages(t, usages) }) };
    await tx.delete(catalogTypes).where(eq(catalogTypes.id, id));
    await recordAudit(tx, current, "config", "catalog.type_deleted", { key: type.key });
    return { ok: true };
  });
  if ("error" in result) return result;
  revalidatePath("/app/catalog");
  redirect("/app/catalog");
}

/* ---------- CSV import ---------- */

export type ImportOutcome = ActionError | { created: number; updated: number; unchanged: number };

/** One CSV, one type, one transaction: a single bad row and nothing is written. */
export async function importCsv(formData: FormData): Promise<ImportOutcome> {
  const current = await requireManager();
  const t = await getT();
  const typeId = String(formData.get("typeId") ?? "");
  const file = formData.get("file");
  if (!z.string().uuid().safeParse(typeId).success || !(file instanceof File) || file.size === 0)
    return { error: t("catalog.importInvalid") };
  if (file.size > 5 * 1024 * 1024) return { error: t("catalog.importInvalid") };
  const text = await file.text();
  return withTenant<ImportOutcome>(current.tenant.id, async (tx) => {
    const type = await loadType(tx, current.tenant.id, typeId);
    if (!type) return { error: t("catalog.importInvalid") };
    if (type.locked) return { error: t("catalog.lockedError") };
    const { entries, errors } = entriesFromCsv(text, type.key);
    if (errors.length)
      return { error: t("catalog.importErrors", { count: errors.length }), details: errors };
    const r = await upsertEntries(tx, current.tenant.id, type.key, entries);
    if (r.errors.length) {
      // Validation refused before any write: nothing to roll back.
      return { error: t("catalog.importErrors", { count: r.errors.length }), details: r.errors };
    }
    await recordAudit(tx, current, "config", "catalog.imported", {
      type: type.key,
      file: file.name,
      created: r.created,
      updated: r.updated,
    });
    revalidatePath("/app/catalog");
    return { created: r.created, updated: r.updated, unchanged: r.unchanged };
  });
}

/* ---------- Runbooks ---------- */

const runbookSchema = z.object({
  entryId: z.string().uuid(),
  title: z.string().trim().min(2).max(160),
  sourceUrl: z.string().trim().url().max(500).or(z.literal("")),
  content: z.string().max(60_000).default(""),
});

/** A runbook for a service: a file at a URL (fetched now, refreshed by the worker) or pasted text. */
export async function createRunbook(formData: FormData) {
  const current = await requireManager();
  const parsed = runbookSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success)
    redirect(`/app/catalog?entry=${String(formData.get("entryName") ?? "")}&error=runbook`);
  const input = parsed.data;
  if (!input.sourceUrl && !input.content.trim())
    redirect(`/app/catalog?entry=${String(formData.get("entryName") ?? "")}&error=runbook`);
  const id = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .insert(runbooks)
      .values({
        tenantId: current.tenant.id,
        serviceEntryId: input.entryId,
        title: input.title,
        sourceUrl: input.sourceUrl || null,
        content: input.sourceUrl ? "" : input.content.trim(),
        createdByMemberId: current.member.id,
      })
      .returning({ id: runbooks.id });
    await recordAudit(tx, current, "config", "runbook.created", {
      title: input.title,
      url: input.sourceUrl || null,
    });
    return row!.id;
  });
  if (input.sourceUrl) await refreshRunbook(current.tenant.id, id);
  else await indexRunbook(current.tenant.id, id);
  revalidatePath("/app/catalog");
  redirect(`/app/catalog?entry=${encodeURIComponent(String(formData.get("entryName") ?? ""))}`);
}

export async function deleteRunbook(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  const entryName = String(formData.get("entryName") ?? "");
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .delete(runbooks)
      .where(and(eq(runbooks.tenantId, current.tenant.id), eq(runbooks.id, id)))
      .returning({ title: runbooks.title });
    await tx
      .delete(atlasDocuments)
      .where(
        and(
          eq(atlasDocuments.tenantId, current.tenant.id),
          eq(atlasDocuments.source, "runbook"),
          eq(atlasDocuments.refId, id),
        ),
      );
    if (row) await recordAudit(tx, current, "config", "runbook.deleted", { title: row.title });
  });
  revalidatePath("/app/catalog");
  redirect(`/app/catalog?entry=${encodeURIComponent(entryName)}`);
}

export async function refreshRunbookAction(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  const entryName = String(formData.get("entryName") ?? "");
  await refreshRunbook(current.tenant.id, id);
  revalidatePath("/app/catalog");
  redirect(`/app/catalog?entry=${encodeURIComponent(entryName)}`);
}
