/**
 * SCIM Groups ↔ catalog teams. A group is a `team` entry; its members are the
 * entry's `members` attribute (member ids). Deleting a team the routing still
 * leans on is refused with the usages, exactly as the catalog screen does.
 */
import { and, asc, eq } from "drizzle-orm";
import { entryUsages, upsertEntries } from "@openincident/catalog";
import { auditEvents, catalogEntries, catalogTypes, members, type Tx } from "@openincident/db";
import { SCHEMA_GROUP, ScimError, type EqFilter, type PatchOp } from "./protocol";

type EntryRow = typeof catalogEntries.$inferSelect;

async function teamType(tx: Tx, tenantId: string) {
  const [type] = await tx
    .select()
    .from(catalogTypes)
    .where(and(eq(catalogTypes.tenantId, tenantId), eq(catalogTypes.key, "team")));
  if (!type) throw new ScimError(500, "The workspace has no team type");
  return type;
}

function memberIds(e: EntryRow): string[] {
  const raw = e.attributes.members;
  return Array.isArray(raw) ? raw.map(String) : [];
}

export async function toScimGroup(tx: Tx, tenantId: string, e: EntryRow, base: string) {
  const ids = memberIds(e);
  const rows = ids.length
    ? await tx
        .select({ id: members.id, name: members.name })
        .from(members)
        .where(eq(members.tenantId, tenantId))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r.name]));
  return {
    schemas: [SCHEMA_GROUP],
    id: e.id,
    externalId: e.externalId ?? undefined,
    displayName: e.name,
    members: ids.map((id) => ({
      value: id,
      display: byId.get(id) ?? id,
      $ref: `${base}/Users/${id}`,
    })),
    meta: {
      resourceType: "Group",
      created: e.createdAt.toISOString(),
      lastModified: e.updatedAt.toISOString(),
      location: `${base}/Groups/${e.id}`,
    },
  };
}

export async function listGroups(
  tx: Tx,
  tenantId: string,
  filter: EqFilter | null,
  startIndex: number,
  count: number,
): Promise<{ rows: EntryRow[]; total: number }> {
  const type = await teamType(tx, tenantId);
  const all = await tx
    .select()
    .from(catalogEntries)
    .where(and(eq(catalogEntries.tenantId, tenantId), eq(catalogEntries.typeId, type.id)))
    .orderBy(asc(catalogEntries.name));
  let rows = all;
  if (filter) {
    if (filter.attribute === "displayname")
      rows = all.filter((e) => e.name.toLowerCase() === filter.value.toLowerCase());
    else if (filter.attribute === "externalid")
      rows = all.filter((e) => e.externalId === filter.value);
    else if (filter.attribute === "id") rows = all.filter((e) => e.id === filter.value);
    else
      throw new ScimError(
        400,
        `Unsupported filter attribute: ${filter.attribute}`,
        "invalidFilter",
      );
  }
  return { rows: rows.slice(startIndex - 1, startIndex - 1 + count), total: rows.length };
}

export async function getGroup(tx: Tx, tenantId: string, id: string): Promise<EntryRow> {
  const type = await teamType(tx, tenantId);
  const [row] = await tx
    .select()
    .from(catalogEntries)
    .where(
      and(
        eq(catalogEntries.tenantId, tenantId),
        eq(catalogEntries.typeId, type.id),
        eq(catalogEntries.id, id),
      ),
    );
  if (!row) throw new ScimError(404, `No group ${id}`);
  return row;
}

function readGroup(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const displayName = typeof b.displayName === "string" ? b.displayName.trim() : "";
  const externalId = typeof b.externalId === "string" ? b.externalId.trim() : undefined;
  const list = Array.isArray(b.members) ? (b.members as Array<Record<string, unknown>>) : undefined;
  const memberIds = list?.map((m) => String(m.value ?? "")).filter(Boolean);
  return { displayName, externalId, memberIds };
}

async function validMemberIds(tx: Tx, tenantId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: members.id })
    .from(members)
    .where(eq(members.tenantId, tenantId));
  const known = new Set(rows.map((r) => r.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length)
    throw new ScimError(400, `Unknown members: ${unknown.join(", ")}`, "invalidValue");
  return [...new Set(ids)];
}

async function recordScim(
  tx: Tx,
  tenantId: string,
  action: string,
  target: Record<string, unknown>,
) {
  await tx.insert(auditEvents).values({
    tenantId,
    actorMemberId: null,
    actorName: "SCIM provisioning",
    category: "config",
    action,
    target,
  });
}

async function writeTeam(
  tx: Tx,
  tenantId: string,
  spec: { id?: string; name: string; externalId?: string | null; memberIds?: string[] },
): Promise<EntryRow> {
  const r = await upsertEntries(tx, tenantId, "team", [
    {
      type: "team",
      ...(spec.id ? { id: spec.id } : {}),
      name: spec.name,
      external_id: spec.externalId ?? undefined,
      attributes: spec.memberIds !== undefined ? { members: spec.memberIds } : {},
    },
  ]);
  if (r.errors.length) throw new ScimError(409, r.errors.join("; "), "uniqueness");
  const [row] = await tx.select().from(catalogEntries).where(eq(catalogEntries.id, r.ids[0]!));
  return row!;
}

export async function createGroup(tx: Tx, tenantId: string, body: unknown): Promise<EntryRow> {
  const g = readGroup(body);
  if (!g.displayName) throw new ScimError(400, "displayName is required", "invalidValue");
  const type = await teamType(tx, tenantId);
  const [dup] = await tx
    .select({ id: catalogEntries.id })
    .from(catalogEntries)
    .where(and(eq(catalogEntries.typeId, type.id), eq(catalogEntries.name, g.displayName)));
  if (dup) throw new ScimError(409, `A group named ${g.displayName} already exists`, "uniqueness");
  const ids = await validMemberIds(tx, tenantId, g.memberIds ?? []);
  const row = await writeTeam(tx, tenantId, {
    name: g.displayName,
    externalId: g.externalId,
    memberIds: ids,
  });
  await recordScim(tx, tenantId, "catalog.team_provisioned", {
    name: row.name,
    members: ids.length,
  });
  return row;
}

export async function replaceGroup(
  tx: Tx,
  tenantId: string,
  id: string,
  body: unknown,
): Promise<EntryRow> {
  const current = await getGroup(tx, tenantId, id);
  const g = readGroup(body);
  const ids = await validMemberIds(tx, tenantId, g.memberIds ?? memberIds(current));
  const row = await writeTeam(tx, tenantId, {
    id,
    name: g.displayName || current.name,
    externalId: g.externalId ?? current.externalId,
    memberIds: ids,
  });
  await recordScim(tx, tenantId, "catalog.team_updated_by_provider", {
    name: row.name,
    members: ids.length,
  });
  return row;
}

/** PATCH: rename, add members, remove members (by path filter or by value list). */
export async function patchGroup(
  tx: Tx,
  tenantId: string,
  id: string,
  ops: PatchOp[],
): Promise<EntryRow> {
  const current = await getGroup(tx, tenantId, id);
  let name = current.name;
  let externalId = current.externalId;
  let ids = memberIds(current);
  for (const o of ops) {
    const path = (o.path ?? "").trim();
    const lower = path.toLowerCase();
    if (!path && o.value && typeof o.value === "object") {
      const v = o.value as Record<string, unknown>;
      if (typeof v.displayName === "string") name = v.displayName.trim() || name;
      if (typeof v.externalId === "string") externalId = v.externalId;
      if (Array.isArray(v.members)) {
        const list = (v.members as Array<Record<string, unknown>>).map((m) =>
          String(m.value ?? ""),
        );
        ids = o.op === "replace" ? list : [...ids, ...list];
      }
      continue;
    }
    if (lower === "displayname") {
      if (o.op === "remove")
        throw new ScimError(400, "displayName cannot be removed", "mutability");
      name = String(o.value ?? "").trim() || name;
    } else if (lower === "externalid")
      externalId = o.op === "remove" ? null : String(o.value ?? "");
    else if (lower === "members") {
      const list = Array.isArray(o.value)
        ? (o.value as Array<Record<string, unknown>>).map((m) => String(m.value ?? ""))
        : [];
      if (o.op === "add") ids = [...ids, ...list];
      else if (o.op === "replace") ids = list;
      else ids = list.length ? ids.filter((x) => !list.includes(x)) : [];
    } else {
      const m = path.match(/^members\[value\s+eq\s+"([^"]+)"\]$/i);
      if (!m) throw new ScimError(400, `Unsupported path: ${path}`, "invalidPath");
      if (o.op === "remove") ids = ids.filter((x) => x !== m[1]);
      else if (!ids.includes(m[1]!)) ids.push(m[1]!);
    }
  }
  const valid = await validMemberIds(tx, tenantId, ids);
  const row = await writeTeam(tx, tenantId, { id, name, externalId, memberIds: valid });
  await recordScim(tx, tenantId, "catalog.team_updated_by_provider", {
    name: row.name,
    members: valid.length,
  });
  return row;
}

export async function deleteGroup(tx: Tx, tenantId: string, id: string): Promise<void> {
  const current = await getGroup(tx, tenantId, id);
  const usages = await entryUsages(tx, tenantId, id);
  if (usages.length)
    throw new ScimError(
      409,
      `The team is still referenced: ${usages.map((u) => `${u.count} ${u.kind}`).join(", ")}`,
      "mutability",
    );
  await tx.delete(catalogEntries).where(eq(catalogEntries.id, id));
  await recordScim(tx, tenantId, "catalog.team_deleted_by_provider", { name: current.name });
}
