import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import {
  canOpenSettings,
  canRespond,
  hasPermission,
  isManagerRole,
  managePermissionForPath,
  permissionsOfRole,
  type Permission,
} from "@openincident/config";
import { customRoles, members, withTenant, type Tenant } from "@openincident/db";
import { entitlementsFor } from "@/lib/entitlements";
import { getTenantFromHeaders, getWorkspace, type Workspace } from "@/lib/tenant";

export type Member = typeof members.$inferSelect;

/**
 * The member of this request, with what they may do: the permissions of
 * their role (a custom one when the workspace is entitled and assigned one)
 * and the permission the current screen's controls stand for.
 */
export type ActingMember = Member & {
  permissions: readonly Permission[];
  areaPermission: Permission;
  /** The custom role's name, for display; null on a built-in role. */
  customRoleName: string | null;
};

export type CurrentMember = {
  tenant: Tenant;
  workspace: Workspace;
  member: ActingMember;
  sessionEmail: string;
  sessionUserId: string;
};

type Resolution =
  { status: "ok"; value: CurrentMember } | { status: "anonymous" } | { status: "not-member" };

/**
 * Session + membership, memoised per request. The session is global (one
 * identity across workspaces); membership is what the workspace says about
 * that email, read under its own RLS context.
 */
const resolveMember = cache(async (): Promise<Resolution> => {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session) return { status: "anonymous" };

  const tenant = await getTenantFromHeaders();
  const workspace = await getWorkspace();
  if (!tenant || !workspace) return { status: "anonymous" };

  const resolved = await withTenant(tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(members)
      .where(
        and(eq(members.tenantId, tenant.id), eq(members.email, session.user.email.toLowerCase())),
      );
    if (!row) return null;
    // A custom role counts only where the workspace is entitled to them.
    const custom =
      row.customRoleId && entitlementsFor(tenant).customRoles
        ? (
            await tx
              .select({ name: customRoles.name, permissions: customRoles.permissions })
              .from(customRoles)
              .where(and(eq(customRoles.tenantId, tenant.id), eq(customRoles.id, row.customRoleId)))
          )[0]
        : undefined;
    return { row, custom };
  });
  if (!resolved || resolved.row.status === "disabled") return { status: "not-member" };
  const member: ActingMember = {
    ...resolved.row,
    permissions: resolved.custom
      ? (resolved.custom.permissions as Permission[])
      : permissionsOfRole(resolved.row.role),
    areaPermission: managePermissionForPath(h.get("x-pathname") ?? ""),
    customRoleName: resolved.custom?.name ?? null,
  };

  return {
    status: "ok",
    value: {
      tenant,
      workspace,
      member,
      sessionEmail: session.user.email,
      sessionUserId: session.user.id,
    },
  };
});

/** Pages: session + workspace membership, otherwise a redirect to /login. */
export async function requireMember(): Promise<CurrentMember> {
  const res = await resolveMember();
  if (res.status === "anonymous") redirect("/login");
  if (res.status === "not-member") redirect("/login?error=not-a-member");
  return res.value;
}

/** Optional member — for the pages that render either way. */
export async function currentMember(): Promise<CurrentMember | null> {
  const res = await resolveMember();
  return res.status === "ok" ? res.value : null;
}

export { isManagerRole as isManager, canRespond, hasPermission, canOpenSettings };

/**
 * Guard for the management server actions. It THROWS rather than redirecting:
 * an action called by a role that has no right to it is an attempt, not a
 * navigation, and must fail loudly.
 */
export async function requireManager(): Promise<CurrentMember> {
  const current = await requireMember();
  if (!isManagerRole(current.member)) throw new Error("forbidden: managers only");
  return current;
}

/** Same for anything that acts on an incident: viewers read, they never act. */
export async function requireResponder(): Promise<CurrentMember> {
  const current = await requireMember();
  if (!canRespond(current.member)) throw new Error("forbidden: responders only");
  return current;
}

/** A specific permission, for the few actions a screen's area does not name. */
export async function requirePermission(permission: Permission): Promise<CurrentMember> {
  const current = await requireMember();
  if (!hasPermission(current.member, permission)) throw new Error(`forbidden: ${permission}`);
  return current;
}
