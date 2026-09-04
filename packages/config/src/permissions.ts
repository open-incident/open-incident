/**
 * What a member may do, as permissions. The four built-in roles are fixed
 * permission sets; a custom role (enterprise edition) is any set. Every check
 * in the product goes through `isManagerRole` / `canRespond` / `hasPermission`
 * with the current member as subject, so a custom role changes behaviour
 * everywhere at once — nothing is gated twice.
 */
import type { MemberRole } from "./index";

export const PERMISSIONS = [
  /** Declare, update, assign, resolve incidents; act on alerts. */
  "incidents.respond",
  /** Create and edit catalog entries. */
  "catalog.entries",
  /** Catalog types, imports, deletions, runbooks. */
  "catalog.manage",
  /** Schedules, rotations, overrides, escalation paths. */
  "oncall.manage",
  /** Status pages, components, maintenances. */
  "statuspages.manage",
  /** Reports: pay reports, exports. */
  "insights.manage",
  /** General settings, brand, working hours. */
  "settings.workspace",
  /** Members, roles, single sign-on, provisioning. */
  "settings.members",
  /** Incident types, fields, announcements, post-incident flow. */
  "settings.response",
  /** Alert sources, routes, priorities, heartbeats. */
  "settings.alerting",
  /** Integrations, API keys, webhooks, AI governance. */
  "settings.platform",
  /** The audit log. */
  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

/** The built-in roles, as the permissions they have always had. */
export const ROLE_PERMISSIONS: Record<MemberRole, readonly Permission[]> = {
  owner: ALL,
  admin: ALL,
  responder: ["incidents.respond", "catalog.entries"],
  viewer: [],
};

/**
 * A subject of a check: a bare role, or the current member carrying the
 * permissions resolved for this request and the permission the current
 * screen's "manage" controls stand for.
 */
export type RoleSubject =
  string | { role: string; permissions?: readonly string[]; areaPermission?: string };

export function permissionsOfRole(role: string): readonly Permission[] {
  return ROLE_PERMISSIONS[role as MemberRole] ?? [];
}

function permissionsOf(subject: RoleSubject): readonly string[] {
  if (typeof subject === "string") return permissionsOfRole(subject);
  return subject.permissions ?? permissionsOfRole(subject.role);
}

export function hasPermission(subject: RoleSubject, permission: Permission): boolean {
  return permissionsOf(subject).includes(permission);
}

/** Any settings screen at all — what the Settings entry in the navigation stands for. */
export function canOpenSettings(subject: RoleSubject): boolean {
  return permissionsOf(subject).some((p) => p.startsWith("settings.") || p === "audit.view");
}

/**
 * The "manage" permission a path stands for: what an admin does on that
 * screen. A custom role holding it gets the screen's controls; one without
 * reads only.
 */
export function managePermissionForPath(pathname: string): Permission {
  const p = pathname.replace(/\/+$/, "");
  const settings = p.match(/^\/app\/settings\/([^/]+)/)?.[1];
  if (settings) {
    if (["general", "working-hours", "brand"].includes(settings)) return "settings.workspace";
    if (["members", "roles", "sso", "scim"].includes(settings)) return "settings.members";
    if (["types", "fields", "announcements", "post-incident"].includes(settings))
      return "settings.response";
    if (["alert-sources", "alert-routes", "alert-priorities", "heartbeats"].includes(settings))
      return "settings.alerting";
    if (["integrations", "api", "ai", "qa"].includes(settings)) return "settings.platform";
    if (settings === "audit") return "audit.view";
    return "settings.workspace";
  }
  if (p.startsWith("/app/on-call")) return "oncall.manage";
  if (p.startsWith("/app/status-pages")) return "statuspages.manage";
  if (p.startsWith("/app/catalog")) return "catalog.manage";
  if (p.startsWith("/app/insights") || p.startsWith("/api/insights")) return "insights.manage";
  if (p.startsWith("/api/slack") || p.startsWith("/api/teams")) return "settings.platform";
  return "settings.workspace";
}
