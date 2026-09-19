/**
 * SCIM Groups ↔ teams. A group is a row of `app.teams`; its members are rows of
 * `app.team_members`. Deleting a team the product still leans on is refused
 * with the list of what leans on it, because a team is what an escalation
 * resolves through: losing one silently would stop a page.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  auditEvents,
  escalationPathVersions,
  escalationPaths,
  members,
  services,
  teamMembers,
  teams,
  type Tx,
} from "@openincident/db";
import { SCHEMA_GROUP, ScimError, type EqFilter, type PatchOp } from "./protocol";

export type TeamRow = typeof teams.$inferSelect;

async function memberIdsOf(tx: Tx, tenantId: string, teamId: string): Promise<string[]> {
  const rows = await tx
    .select({ memberId: teamMembers.memberId })
    .from(teamMembers)
    .where(and(eq(teamMembers.tenantId, tenantId), eq(teamMembers.teamId, teamId)));
  return rows.map((r) => r.memberId);
}

export async function toScimGroup(tx: Tx, tenantId: string, e: TeamRow, base: string) {
  const ids = await memberIdsOf(tx, tenantId, e.id);
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
): Promise<{ rows: TeamRow[]; total: number }> {
  const all = await tx
    .select()
    .from(teams)
    .where(eq(teams.tenantId, tenantId))
    .orderBy(asc(teams.name));
  let rows = all;
  if (filter) {
    if (filter.attribute === "displayname")
      rows = all.filter((e) => e.name.toLowerCase() === filter.value.toLowerCase());
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

export async function getGroup(tx: Tx, tenantId: string, id: string): Promise<TeamRow> {
  const [row] = await tx
    .select()
    .from(teams)
    .where(and(eq(teams.tenantId, tenantId), eq(teams.id, id)));
  if (!row) throw new ScimError(404, `No group ${id}`);
  return row;
}

function readGroup(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const displayName = typeof b.displayName === "string" ? b.displayName.trim() : "";
  const list = Array.isArray(b.members) ? (b.members as Array<Record<string, unknown>>) : undefined;
  const memberIds = list?.map((m) => String(m.value ?? "")).filter(Boolean);
  return { displayName, memberIds };
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

/** Writes the team row and replaces its memberships in one go. */
async function writeTeam(
  tx: Tx,
  tenantId: string,
  spec: { id?: string; name: string; memberIds?: string[] },
): Promise<TeamRow> {
  const now = new Date();
  let row: TeamRow;
  if (spec.id) {
    const [updated] = await tx
      .update(teams)
      .set({ name: spec.name, updatedAt: now })
      .where(and(eq(teams.tenantId, tenantId), eq(teams.id, spec.id)))
      .returning();
    if (!updated) throw new ScimError(404, `No group ${spec.id}`);
    row = updated;
  } else {
    const [inserted] = await tx.insert(teams).values({ tenantId, name: spec.name }).returning();
    row = inserted!;
  }
  if (spec.memberIds !== undefined) {
    const wanted = new Set(spec.memberIds);
    const current = await memberIdsOf(tx, tenantId, row.id);
    const gone = current.filter((id) => !wanted.has(id));
    if (gone.length)
      await tx
        .delete(teamMembers)
        .where(and(eq(teamMembers.teamId, row.id), inArray(teamMembers.memberId, gone)));
    for (const memberId of spec.memberIds)
      await tx
        .insert(teamMembers)
        .values({ tenantId, teamId: row.id, memberId })
        .onConflictDoNothing();
  }
  return row;
}

export async function createGroup(tx: Tx, tenantId: string, body: unknown): Promise<TeamRow> {
  const g = readGroup(body);
  if (!g.displayName) throw new ScimError(400, "displayName is required", "invalidValue");
  const [dup] = await tx
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.tenantId, tenantId), eq(teams.name, g.displayName)));
  if (dup) throw new ScimError(409, `A group named ${g.displayName} already exists`, "uniqueness");
  const ids = await validMemberIds(tx, tenantId, g.memberIds ?? []);
  const row = await writeTeam(tx, tenantId, { name: g.displayName, memberIds: ids });
  await recordScim(tx, tenantId, "team.provisioned", { name: row.name, members: ids.length });
  return row;
}

export async function replaceGroup(
  tx: Tx,
  tenantId: string,
  id: string,
  body: unknown,
): Promise<TeamRow> {
  const current = await getGroup(tx, tenantId, id);
  const g = readGroup(body);
  const ids = await validMemberIds(
    tx,
    tenantId,
    g.memberIds ?? (await memberIdsOf(tx, tenantId, id)),
  );
  const row = await writeTeam(tx, tenantId, {
    id,
    name: g.displayName || current.name,
    memberIds: ids,
  });
  await recordScim(tx, tenantId, "team.updated_by_provider", {
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
): Promise<TeamRow> {
  const current = await getGroup(tx, tenantId, id);
  let name = current.name;
  let ids = await memberIdsOf(tx, tenantId, id);
  for (const o of ops) {
    const path = (o.path ?? "").trim();
    const lower = path.toLowerCase();
    if (!path && o.value && typeof o.value === "object") {
      const v = o.value as Record<string, unknown>;
      if (typeof v.displayName === "string") name = v.displayName.trim() || name;
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
    } else if (lower === "members") {
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
  const row = await writeTeam(tx, tenantId, { id, name, memberIds: valid });
  await recordScim(tx, tenantId, "team.updated_by_provider", {
    name: row.name,
    members: valid.length,
  });
  return row;
}

/** What still leans on a team, in the words the refusal shows. */
async function teamUsages(
  tx: Tx,
  tenantId: string,
  teamId: string,
): Promise<Array<{ kind: string; count: number }>> {
  const out: Array<{ kind: string; count: number }> = [];
  const owned = await tx
    .select({ key: services.key })
    .from(services)
    .where(and(eq(services.tenantId, tenantId), eq(services.ownerTeamId, teamId)));
  if (owned.length) out.push({ kind: "services owned", count: owned.length });

  // An escalation path names a team in the graph of its published version; the
  // id appears nowhere a join could reach, so the graphs are read and scanned.
  const paths = await tx
    .select({ name: escalationPaths.name, graph: escalationPathVersions.graph })
    .from(escalationPaths)
    .innerJoin(
      escalationPathVersions,
      eq(escalationPathVersions.id, escalationPaths.currentVersionId),
    )
    .where(eq(escalationPaths.tenantId, tenantId));
  const paging = paths.filter((p) =>
    p.graph.nodes.some(
      (n) => n.kind === "level" && n.targets.some((t) => t.kind === "team" && t.teamId === teamId),
    ),
  );
  if (paging.length) out.push({ kind: "escalation paths", count: paging.length });
  return out;
}

export async function deleteGroup(tx: Tx, tenantId: string, id: string): Promise<void> {
  const current = await getGroup(tx, tenantId, id);
  const usages = await teamUsages(tx, tenantId, id);
  if (usages.length)
    throw new ScimError(
      409,
      `The team is still referenced: ${usages.map((u) => `${u.count} ${u.kind}`).join(", ")}`,
      "mutability",
    );
  await tx.delete(teams).where(and(eq(teams.tenantId, tenantId), eq(teams.id, id)));
  await recordScim(tx, tenantId, "team.deleted_by_provider", { name: current.name });
}
