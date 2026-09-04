/**
 * Custom roles: named permission sets on a built-in base. A role in use
 * cannot be deleted — the members holding it are the reason, listed.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { PERMISSIONS, type MemberRole, type Permission } from "@openincident/config";
import { customRoles, members, withTenant } from "@openincident/db";

export type CustomRoleRow = typeof customRoles.$inferSelect;
export type RoleInput = {
  name: string;
  description: string;
  base: Exclude<MemberRole, "owner">;
  permissions: string[];
};
export type RoleResult =
  | { ok: true; id: string }
  | { ok: false; code: "invalid" | "duplicate" | "in_use"; detail?: string };

export function keyOf(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return /^[a-z]/.test(base) ? base : `r_${base}`.slice(0, 40);
}

function validate(
  input: RoleInput,
): { name: string; description: string | null; permissions: Permission[] } | null {
  const name = input.name.trim().slice(0, 60);
  if (name.length < 2) return null;
  if (!["admin", "responder", "viewer"].includes(input.base)) return null;
  const permissions = [...new Set(input.permissions)].filter((p): p is Permission =>
    (PERMISSIONS as readonly string[]).includes(p),
  );
  return { name, description: input.description.trim().slice(0, 300) || null, permissions };
}

export async function listRoles(
  tenantId: string,
): Promise<Array<CustomRoleRow & { memberCount: number }>> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(customRoles)
      .where(eq(customRoles.tenantId, tenantId))
      .orderBy(asc(customRoles.name));
    const counts = await tx
      .select({ id: members.customRoleId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(members)
      .where(eq(members.tenantId, tenantId))
      .groupBy(members.customRoleId);
    const byId = new Map(counts.map((c) => [c.id, c.n]));
    return rows.map((r) => ({ ...r, memberCount: byId.get(r.id) ?? 0 }));
  });
}

export async function createRole(tenantId: string, input: RoleInput): Promise<RoleResult> {
  const v = validate(input);
  if (!v) return { ok: false, code: "invalid" };
  return withTenant(tenantId, async (tx) => {
    const key = keyOf(v.name);
    const [dup] = await tx
      .select({ id: customRoles.id })
      .from(customRoles)
      .where(and(eq(customRoles.tenantId, tenantId), eq(customRoles.key, key)));
    if (dup) return { ok: false, code: "duplicate" as const };
    const [row] = await tx
      .insert(customRoles)
      .values({
        tenantId,
        key,
        name: v.name,
        description: v.description,
        base: input.base,
        permissions: v.permissions,
      })
      .returning({ id: customRoles.id });
    return { ok: true as const, id: row!.id };
  });
}

export async function updateRole(
  tenantId: string,
  id: string,
  input: RoleInput,
): Promise<RoleResult> {
  const v = validate(input);
  if (!v) return { ok: false, code: "invalid" };
  return withTenant(tenantId, async (tx) => {
    const [current] = await tx
      .select()
      .from(customRoles)
      .where(and(eq(customRoles.tenantId, tenantId), eq(customRoles.id, id)));
    if (!current) return { ok: false, code: "invalid" as const };
    await tx
      .update(customRoles)
      .set({
        name: v.name,
        description: v.description,
        base: input.base,
        permissions: v.permissions,
        updatedAt: new Date(),
      })
      .where(eq(customRoles.id, id));
    // Members of the role follow its base: what the rest of the product shows them as.
    if (current.base !== input.base)
      await tx
        .update(members)
        .set({ role: input.base })
        .where(and(eq(members.tenantId, tenantId), eq(members.customRoleId, id)));
    return { ok: true as const, id };
  });
}

export async function deleteRole(tenantId: string, id: string): Promise<RoleResult> {
  return withTenant(tenantId, async (tx) => {
    const holders = await tx
      .select({ name: members.name })
      .from(members)
      .where(and(eq(members.tenantId, tenantId), eq(members.customRoleId, id)));
    if (holders.length)
      return {
        ok: false,
        code: "in_use" as const,
        detail:
          holders
            .slice(0, 5)
            .map((h) => h.name)
            .join(", ") + (holders.length > 5 ? ` (+${holders.length - 5})` : ""),
      };
    await tx
      .delete(customRoles)
      .where(and(eq(customRoles.tenantId, tenantId), eq(customRoles.id, id)));
    return { ok: true as const, id };
  });
}
