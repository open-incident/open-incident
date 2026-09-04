/**
 * Reconciling a bundle with a workspace. Types are upserted by key, entries by
 * external_id then by name. Every value is checked against the type's schema
 * — an unknown attribute, a select value outside the options, an owner that
 * names no team — and NOTHING is written while a single row is wrong: the
 * report lists every problem at once.
 */
import { and, eq } from "drizzle-orm";
import {
  catalogEntries,
  catalogTypes,
  members,
  type CatalogAttributeDef,
  type Tx,
} from "@openincident/db";
import { KEY_PATTERN, type AttributeSpec, type EntrySpec, type TypeSpec } from "./spec";

type TypeRow = typeof catalogTypes.$inferSelect;
type EntryRow = typeof catalogEntries.$inferSelect;

export type TypeUpsertOptions = {
  /** Sets or clears the lock; undefined leaves it as it is. */
  locked?: boolean;
  /** Recorded on creation; a UI-created type keeps "ui" when the API updates it. */
  source?: "ui" | "code" | "sync";
  /** Removing an attribute that still holds values is refused unless forced. */
  force?: boolean;
  /** Keys of types defined in the same bundle: valid `refTypeKey` targets. */
  knownTypeKeys?: string[];
};

export type TypeUpsertResult =
  { ok: true; id: string; created: boolean; changed: boolean } | { ok: false; errors: string[] };

function sameAttributes(a: CatalogAttributeDef[], b: AttributeSpec[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function upsertType(
  tx: Tx,
  tenantId: string,
  spec: TypeSpec,
  options: TypeUpsertOptions = {},
): Promise<TypeUpsertResult> {
  const errors: string[] = [];
  const existingTypes = await tx
    .select({ id: catalogTypes.id, key: catalogTypes.key, position: catalogTypes.position })
    .from(catalogTypes)
    .where(eq(catalogTypes.tenantId, tenantId));
  const known = new Set([
    ...existingTypes.map((t) => t.key),
    ...(options.knownTypeKeys ?? []),
    spec.key,
  ]);
  for (const a of spec.attributes)
    if (a.type === "entry" && a.refTypeKey && !known.has(a.refTypeKey))
      errors.push(
        `type ${spec.key}: attribute "${a.key}" references unknown type "${a.refTypeKey}"`,
      );
  if (errors.length) return { ok: false, errors };

  const [current] = await tx
    .select()
    .from(catalogTypes)
    .where(and(eq(catalogTypes.tenantId, tenantId), eq(catalogTypes.key, spec.key)));
  if (!current) {
    const position = existingTypes.reduce((m, t) => Math.max(m, t.position), -1) + 1;
    const [row] = await tx
      .insert(catalogTypes)
      .values({
        tenantId,
        key: spec.key,
        name: spec.name,
        description: spec.description ?? null,
        attributes: spec.attributes,
        position,
        locked: options.locked ?? false,
        source: options.source ?? "ui",
      })
      .returning({ id: catalogTypes.id });
    return { ok: true, id: row!.id, created: true, changed: true };
  }

  const removed = current.attributes.filter((a) => !spec.attributes.some((b) => b.key === a.key));
  if (removed.length && !options.force) {
    const rows = await tx
      .select({ attributes: catalogEntries.attributes })
      .from(catalogEntries)
      .where(eq(catalogEntries.typeId, current.id));
    for (const a of removed) {
      const n = rows.filter(
        (r) => r.attributes[a.key] !== undefined && r.attributes[a.key] !== "",
      ).length;
      if (n > 0)
        errors.push(
          `type ${spec.key}: attribute "${a.key}" still holds a value on ${n} entr${n === 1 ? "y" : "ies"}`,
        );
    }
    if (errors.length) return { ok: false, errors };
  }
  const changed =
    current.name !== spec.name ||
    (current.description ?? null) !== (spec.description ?? null) ||
    !sameAttributes(current.attributes, spec.attributes) ||
    (options.locked !== undefined && current.locked !== options.locked);
  if (changed)
    await tx
      .update(catalogTypes)
      .set({
        name: spec.name,
        description: spec.description ?? null,
        attributes: spec.attributes,
        ...(options.locked !== undefined ? { locked: options.locked } : {}),
      })
      .where(eq(catalogTypes.id, current.id));
  return { ok: true, id: current.id, created: false, changed };
}

export type EntriesUpsertResult = {
  created: number;
  updated: number;
  unchanged: number;
  errors: string[];
  /** Ids in row order, for callers that need them (only when errors is empty). */
  ids: string[];
};

type Lookup = {
  byId: Map<string, EntryRow>;
  /** typeId → (lowercased name | external_id) → entry */
  byKey: Map<string, Map<string, EntryRow>>;
};

function register(lookup: Lookup, e: EntryRow): void {
  lookup.byId.set(e.id, e);
  let m = lookup.byKey.get(e.typeId);
  if (!m) lookup.byKey.set(e.typeId, (m = new Map()));
  m.set(`n:${e.name.toLowerCase()}`, e);
  if (e.externalId) m.set(`x:${e.externalId.toLowerCase()}`, e);
}

function index(entries: EntryRow[]): Lookup {
  const lookup: Lookup = { byId: new Map(), byKey: new Map() };
  entries.forEach((e) => register(lookup, e));
  return lookup;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function findEntry(lookup: Lookup, typeId: string, ref: string): EntryRow | undefined {
  const m = lookup.byKey.get(typeId);
  if (!m) return undefined;
  const hit = m.get(`x:${ref.toLowerCase()}`) ?? m.get(`n:${ref.toLowerCase()}`);
  if (hit) return hit;
  if (UUID.test(ref)) {
    const e = lookup.byId.get(ref);
    if (e && e.typeId === typeId) return e;
  }
  return undefined;
}

/**
 * Resolves one attribute value against its definition. Returns the stored
 * value, or a string starting with "!" that explains the refusal.
 */
function resolveValue(
  def: CatalogAttributeDef,
  raw: unknown,
  ctx: { lookup: Lookup; typesByKey: Map<string, TypeRow>; membersByEmail: Map<string, string> },
): { value: unknown } | { error: string } {
  if (raw === null || raw === undefined || raw === "") return { value: undefined };
  switch (def.type) {
    case "text": {
      const s = typeof raw === "string" ? raw : String(raw);
      return { value: s.slice(0, 500) };
    }
    case "link": {
      const s = String(raw).trim();
      if (!/^https?:\/\//i.test(s)) return { error: `"${def.key}" must be an http(s) URL` };
      return { value: s.slice(0, 500) };
    }
    case "select": {
      const s = String(raw).trim();
      const opt = (def.options ?? []).find((o) => o.toLowerCase() === s.toLowerCase());
      if (!opt)
        return {
          error: `"${def.key}" must be one of ${(def.options ?? []).join(", ")} (got "${s}")`,
        };
      return { value: opt };
    }
    case "entry": {
      const refType = def.refTypeKey ? ctx.typesByKey.get(def.refTypeKey) : undefined;
      if (!refType) return { error: `"${def.key}" references a type that does not exist` };
      const s = String(raw).trim();
      const hit = findEntry(ctx.lookup, refType.id, s);
      if (!hit) return { error: `"${def.key}": no ${refType.key} named "${s}"` };
      return { value: hit.id };
    }
    case "member_list": {
      const list = Array.isArray(raw)
        ? raw.map(String)
        : String(raw)
            .split(/[;,]/)
            .map((x) => x.trim())
            .filter(Boolean);
      const ids: string[] = [];
      for (const item of list) {
        const id = ctx.membersByEmail.get(item.toLowerCase()) ?? (UUID.test(item) ? item : null);
        if (!id) return { error: `"${def.key}": no member with email "${item}"` };
        ids.push(id);
      }
      return { value: ids };
    }
  }
}

/**
 * Upserts entries of one type. Validation first, writes second: a bundle with
 * one bad row writes nothing and reports every bad row.
 */
export async function upsertEntries(
  tx: Tx,
  tenantId: string,
  typeKey: string,
  rows: EntrySpec[],
): Promise<EntriesUpsertResult> {
  const result: EntriesUpsertResult = { created: 0, updated: 0, unchanged: 0, errors: [], ids: [] };
  const types = await tx.select().from(catalogTypes).where(eq(catalogTypes.tenantId, tenantId));
  const typesByKey = new Map(types.map((t) => [t.key, t]));
  const type = typesByKey.get(typeKey);
  if (!type) {
    result.errors.push(`no catalog type "${typeKey}"`);
    return result;
  }
  const all = await tx.select().from(catalogEntries).where(eq(catalogEntries.tenantId, tenantId));
  const lookup = index(all);
  const memberRows = await tx
    .select({ id: members.id, email: members.email })
    .from(members)
    .where(eq(members.tenantId, tenantId));
  const membersByEmail = new Map(memberRows.map((m) => [m.email.toLowerCase(), m.id]));
  const ctx = { lookup, typesByKey, membersByEmail };
  const defs = new Map(type.attributes.map((d) => [d.key, d]));

  type Planned = {
    row: EntrySpec;
    existing: EntryRow | undefined;
    attributes: Record<string, unknown>;
    label: string;
  };
  const planned: Planned[] = [];
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    const label = `${typeKey} "${row.name}" (row ${i + 1})`;
    const byIdHit = row.id ? lookup.byId.get(row.id) : undefined;
    if (row.id && (!byIdHit || byIdHit.typeId !== type.id))
      result.errors.push(`${label}: no entry with id ${row.id}`);
    const existing =
      byIdHit ??
      (row.external_id ? findEntry(lookup, type.id, row.external_id) : undefined) ??
      findEntry(lookup, type.id, row.name);
    // Renaming through external_id must not land on another entry's name.
    const byName = lookup.byKey.get(type.id)?.get(`n:${row.name.toLowerCase()}`);
    if (existing && byName && byName.id !== existing.id)
      result.errors.push(`${label}: another entry already has this name`);
    const dupKey = (row.external_id ? `x:${row.external_id}` : `n:${row.name}`).toLowerCase();
    if (seen.has(dupKey)) result.errors.push(`${label}: listed twice in the bundle`);
    seen.add(dupKey);
    const attributes: Record<string, unknown> = { ...(existing?.attributes ?? {}) };
    for (const [key, raw] of Object.entries(row.attributes ?? {})) {
      if (!KEY_PATTERN.test(key) || !defs.has(key)) {
        result.errors.push(`${label}: unknown attribute "${key}" for type ${typeKey}`);
        continue;
      }
      const r = resolveValue(defs.get(key)!, raw, ctx);
      if ("error" in r) result.errors.push(`${label}: ${r.error}`);
      else if (r.value === undefined) delete attributes[key];
      else attributes[key] = r.value;
    }
    planned.push({ row, existing, attributes, label });
    // Later rows may reference this one: register it under a provisional id.
    if (!existing)
      register(lookup, {
        id: `pending-${i}`,
        tenantId,
        typeId: type.id,
        name: row.name,
        description: null,
        externalId: row.external_id ?? null,
        attributes,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
  });
  if (result.errors.length) return result;

  const pendingIds = new Map<string, string>();
  for (const p of planned) {
    if (!p.existing) {
      const [ins] = await tx
        .insert(catalogEntries)
        .values({
          tenantId,
          typeId: type.id,
          name: p.row.name,
          description: p.row.description ?? null,
          externalId: p.row.external_id ?? null,
          attributes: p.attributes,
        })
        .returning({ id: catalogEntries.id });
      result.created++;
      result.ids.push(ins!.id);
      pendingIds.set(`pending-${planned.indexOf(p)}`, ins!.id);
      continue;
    }
    const e = p.existing;
    const description = p.row.description === undefined ? e.description : p.row.description;
    const externalId = p.row.external_id ?? e.externalId;
    const changed =
      e.name !== p.row.name ||
      (e.description ?? null) !== (description ?? null) ||
      (e.externalId ?? null) !== (externalId ?? null) ||
      JSON.stringify(e.attributes) !== JSON.stringify(p.attributes);
    if (changed) {
      await tx
        .update(catalogEntries)
        .set({
          name: p.row.name,
          description: description ?? null,
          externalId: externalId ?? null,
          attributes: p.attributes,
          updatedAt: new Date(),
        })
        .where(eq(catalogEntries.id, e.id));
      result.updated++;
    } else result.unchanged++;
    result.ids.push(e.id);
  }
  // References to rows created in this same batch were provisional: fix them now.
  if (pendingIds.size)
    for (const [i, p] of planned.entries()) {
      let patched = false;
      for (const [k, v] of Object.entries(p.attributes))
        if (typeof v === "string" && pendingIds.has(v)) {
          p.attributes[k] = pendingIds.get(v);
          patched = true;
        }
      if (patched)
        await tx
          .update(catalogEntries)
          .set({ attributes: p.attributes })
          .where(eq(catalogEntries.id, result.ids[i]!));
    }
  return result;
}
