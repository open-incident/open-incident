/**
 * Constants shared between the apps and the worker.
 */
import type { RoleSubject } from "./permissions";

/** Workspace roles. Owner is above admin; a viewer reads and never acts. */
export const MEMBER_ROLES = ["owner", "admin", "responder", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEMBER_STATUSES = ["active", "invited", "disabled"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/**
 * Does the subject manage the current screen? For a bare role: owner and
 * admin, never responder nor viewer. For the current member, the permission
 * the screen stands for (see permissions.ts) — the same answer for the four
 * built-in roles, a finer one for a custom role.
 */
export function isManagerRole(subject: RoleSubject): boolean {
  if (typeof subject === "string") return subject === "owner" || subject === "admin";
  if (subject.permissions && subject.areaPermission)
    return subject.permissions.includes(subject.areaPermission);
  return subject.role === "owner" || subject.role === "admin";
}

/** Can the subject act on incidents (declare, update, assign)? */
export function canRespond(subject: RoleSubject): boolean {
  if (typeof subject === "string")
    return subject === "owner" || subject === "admin" || subject === "responder";
  if (subject.permissions) return subject.permissions.includes("incidents.respond");
  return canRespond(subject.role);
}

/**
 * Lifecycle phases of an incident. Statuses are configurable per workspace,
 * phases are not: they are what the product reasons about.
 */
export const INCIDENT_PHASES = ["triage", "active", "post_incident", "closed"] as const;
export type IncidentPhase = (typeof INCIDENT_PHASES)[number];

export const INCIDENT_MODES = ["live", "retrospective", "test"] as const;
export type IncidentMode = (typeof INCIDENT_MODES)[number];

export const INCIDENT_VISIBILITIES = ["public", "private"] as const;
export type IncidentVisibility = (typeof INCIDENT_VISIBILITIES)[number];

/** System subdomains forbidden for a workspace slug. */
export const RESERVED_SUBDOMAINS = [
  // System
  "www",
  "console",
  "api",
  "status",
  "docs",
  // Product and routing
  "app",
  "admin",
  "dashboard",
  "my",
  "go",
  "get",
  "ingest",
  "hooks",
  // Auth and billing
  "auth",
  "login",
  "signup",
  "sso",
  "billing",
  "pay",
  "checkout",
  "account",
  // Email and deliverability
  "mail",
  "smtp",
  "imap",
  "mx",
  "email",
  "mta",
  "bounce",
  "bounces",
  "postmaster",
  "abuse",
  "noreply",
  "no-reply",
  "newsletter",
  "ingress",
  "webhook",
  "webhooks",
  // Infra and tooling
  "cdn",
  "assets",
  "static",
  "files",
  "s3",
  "backup",
  "monitor",
  "metrics",
  "grafana",
  "sentry",
  "ns1",
  "ns2",
  "ftp",
  "vpn",
  "git",
  "registry",
  "ci",
  // Environments
  "staging",
  "stg",
  "dev",
  "test",
  "demo",
  "sandbox",
  "preview",
  "internal",
  // Public site and communication
  "blog",
  "pricing",
  "legal",
  "security",
  "about",
  "contact",
  "careers",
  "community",
  "forum",
  "press",
  "partners",
  "shop",
  "store",
] as const;

/** Shape of a workspace slug: 3–40 lowercase letters, digits and hyphens. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !(RESERVED_SUBDOMAINS as readonly string[]).includes(slug);
}

/** Retention of a closed tenant before purge. */
export const TENANT_RETENTION_DAYS = 60;

export * from "./edition";
export * from "./entitlements";
export * from "./permissions";
