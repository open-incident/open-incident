/**
 * SCIM Users ↔ app.members. The provider owns the lifecycle it sends: create,
 * rename, deactivate, reactivate. A DELETE deactivates — a member is referenced
 * by incidents, follow-ups and audit lines, and none of that may vanish because
 * a directory entry did.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { MEMBER_ROLES, type MemberRole } from "@openincident/config";
import { auditEvents, members, type Tx } from "@openincident/db";
import { SCHEMA_USER, ScimError, assignments, type EqFilter, type PatchOp } from "./protocol";

export type MemberRow = typeof members.$inferSelect;

export function toScimUser(m: MemberRow, base: string) {
  const [givenName, ...rest] = m.name.split(" ");
  return {
    schemas: [SCHEMA_USER],
    id: m.id,
    externalId: m.externalId ?? undefined,
    userName: m.email,
    displayName: m.name,
    name: { formatted: m.name, givenName: givenName ?? "", familyName: rest.join(" ") },
    emails: [{ value: m.email, type: "work", primary: true }],
    active: m.status !== "disabled",
    roles: [{ value: m.role, display: m.role, primary: true }],
    meta: {
      resourceType: "User",
      created: m.createdAt.toISOString(),
      lastModified: (m.lastSeenAt ?? m.createdAt).toISOString(),
      location: `${base}/Users/${m.id}`,
    },
  };
}

type UserInput = {
  email?: string;
  externalId?: string | null;
  givenName?: string;
  familyName?: string;
  displayName?: string;
  active?: boolean;
  role?: MemberRole;
};

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** A SCIM User resource (POST/PUT body) → the fields the member keeps. */
export function readUser(body: unknown): UserInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = (b.name ?? {}) as Record<string, unknown>;
  const emails = Array.isArray(b.emails) ? (b.emails as Array<Record<string, unknown>>) : [];
  const primary = emails.find((e) => e.primary === true) ?? emails[0];
  const email = (str(b.userName) ?? str(primary?.value))?.toLowerCase();
  const roles = Array.isArray(b.roles) ? (b.roles as Array<Record<string, unknown>>) : [];
  const role = str(roles.find((r) => r.primary === true)?.value ?? roles[0]?.value);
  return {
    email,
    externalId: b.externalId === null ? null : str(b.externalId),
    givenName: str(name.givenName),
    familyName: str(name.familyName),
    displayName: str(b.displayName) ?? str(name.formatted),
    active: typeof b.active === "boolean" ? b.active : undefined,
    role:
      role && (MEMBER_ROLES as readonly string[]).includes(role) ? (role as MemberRole) : undefined,
  };
}

function nameOf(input: UserInput, fallback: string): string {
  const full = [input.givenName, input.familyName].filter(Boolean).join(" ").trim();
  return input.displayName ?? (full || fallback);
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
    category: "members",
    action,
    target,
  });
}

export async function listMembers(
  tx: Tx,
  tenantId: string,
  filter: EqFilter | null,
  startIndex: number,
  count: number,
): Promise<{ rows: MemberRow[]; total: number }> {
  let where = eq(members.tenantId, tenantId);
  if (filter) {
    const attr = filter.attribute;
    if (attr === "username" || attr.startsWith("emails"))
      where = and(where, eq(members.email, filter.value.toLowerCase()))!;
    else if (attr === "externalid") where = and(where, eq(members.externalId, filter.value))!;
    else if (attr === "id") where = and(where, eq(members.id, filter.value))!;
    else if (attr === "displayname") where = and(where, eq(members.name, filter.value))!;
    else
      throw new ScimError(
        400,
        `Unsupported filter attribute: ${filter.attribute}`,
        "invalidFilter",
      );
  }
  const [countRow] = await tx
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(members)
    .where(where);
  const rows = await tx
    .select()
    .from(members)
    .where(where)
    .orderBy(asc(members.createdAt))
    .limit(count)
    .offset(startIndex - 1);
  return { rows, total: countRow?.n ?? 0 };
}

export async function getMember(tx: Tx, tenantId: string, id: string): Promise<MemberRow> {
  const [row] = await tx
    .select()
    .from(members)
    .where(and(eq(members.tenantId, tenantId), eq(members.id, id)));
  if (!row) throw new ScimError(404, `No user ${id}`);
  return row;
}

export async function createMember(
  tx: Tx,
  tenantId: string,
  input: UserInput,
  defaults: { role: MemberRole; status: "active" | "invited" },
): Promise<MemberRow> {
  if (!input.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email))
    throw new ScimError(400, "userName must be an email address", "invalidValue");
  const [dup] = await tx
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.tenantId, tenantId), eq(members.email, input.email)));
  if (dup)
    throw new ScimError(409, `A user with userName ${input.email} already exists`, "uniqueness");
  const role = input.role && input.role !== "owner" ? input.role : defaults.role;
  const [row] = await tx
    .insert(members)
    .values({
      tenantId,
      email: input.email,
      name: nameOf(input, input.email),
      role,
      status: input.active === false ? "disabled" : defaults.status,
      externalId: input.externalId ?? null,
      source: "scim",
    })
    .returning();
  await recordScim(tx, tenantId, "member.provisioned", { email: input.email, role });
  return row!;
}

/** PUT: the resource as sent replaces what the member had, owner role excepted. */
export async function replaceMember(tx: Tx, tenantId: string, id: string, input: UserInput) {
  const current = await getMember(tx, tenantId, id);
  return applyMember(tx, tenantId, current, input);
}

async function applyMember(tx: Tx, tenantId: string, current: MemberRow, input: UserInput) {
  const patch: Partial<typeof members.$inferInsert> = {};
  if (input.email && input.email !== current.email) {
    const [dup] = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.tenantId, tenantId), eq(members.email, input.email)));
    if (dup && dup.id !== current.id)
      throw new ScimError(409, `A user with userName ${input.email} already exists`, "uniqueness");
    patch.email = input.email;
  }
  if (
    input.givenName !== undefined ||
    input.familyName !== undefined ||
    input.displayName !== undefined
  ) {
    const [curGiven, ...curRest] = current.name.split(" ");
    const merged: UserInput = {
      ...input,
      givenName: input.givenName ?? curGiven,
      familyName: input.familyName ?? curRest.join(" "),
    };
    patch.name = nameOf(merged, current.email);
  }
  if (input.externalId !== undefined) patch.externalId = input.externalId;
  if (input.active !== undefined) {
    if (current.role === "owner" && input.active === false)
      throw new ScimError(403, "An owner cannot be deactivated through SCIM", "mutability");
    patch.status = input.active
      ? current.status === "disabled"
        ? "active"
        : current.status
      : "disabled";
  }
  if (input.role && input.role !== current.role) {
    if (input.role === "owner" || current.role === "owner")
      throw new ScimError(403, "The owner role is not assigned through SCIM", "mutability");
    patch.role = input.role;
  }
  if (Object.keys(patch).length === 0) return current;
  const [row] = await tx.update(members).set(patch).where(eq(members.id, current.id)).returning();
  await recordScim(tx, tenantId, "member.updated_by_provider", {
    email: row!.email,
    changed: Object.keys(patch),
    ...(patch.status ? { status: patch.status } : {}),
  });
  return row!;
}

/** PATCH: Okta's path form and Entra's object form, to the same fields. */
export async function patchMember(tx: Tx, tenantId: string, id: string, ops: PatchOp[]) {
  const current = await getMember(tx, tenantId, id);
  const input: UserInput = {};
  for (const a of assignments(ops)) {
    const path = a.path.toLowerCase().replace(/^urn:ietf:params:scim:schemas:core:2\.0:user:/, "");
    const v = a.op === "remove" ? undefined : a.value;
    if (path === "active") input.active = v === true || v === "True" || v === "true";
    else if (path === "username" || /^emails(\[.*\])?(\.value)?$/.test(path))
      input.email =
        typeof v === "string"
          ? v.toLowerCase()
          : Array.isArray(v)
            ? str((v[0] as Record<string, unknown>)?.value)?.toLowerCase()
            : undefined;
    else if (path === "name.givenname") input.givenName = str(v) ?? "";
    else if (path === "name.familyname") input.familyName = str(v) ?? "";
    else if (path === "name.formatted" || path === "displayname") input.displayName = str(v);
    else if (path === "externalid") input.externalId = a.op === "remove" ? null : (str(v) ?? null);
    else if (path === "roles" || /^roles\[/.test(path)) {
      const role = Array.isArray(v) ? str((v[0] as Record<string, unknown>)?.value) : str(v);
      if (role && (MEMBER_ROLES as readonly string[]).includes(role))
        input.role = role as MemberRole;
    } else if (path === "name") {
      const n = (v ?? {}) as Record<string, unknown>;
      input.givenName = str(n.givenName);
      input.familyName = str(n.familyName);
      input.displayName = str(n.formatted);
    }
    // Attributes the member does not carry (title, locale, phone…) are accepted and ignored.
  }
  return applyMember(tx, tenantId, current, input);
}

/** DELETE deactivates: the row stays for everything that points at it. */
export async function deactivateMember(tx: Tx, tenantId: string, id: string): Promise<void> {
  const current = await getMember(tx, tenantId, id);
  if (current.role === "owner")
    throw new ScimError(403, "An owner cannot be deactivated through SCIM", "mutability");
  if (current.status !== "disabled") {
    await tx.update(members).set({ status: "disabled" }).where(eq(members.id, id));
    await recordScim(tx, tenantId, "member.deactivated_by_provider", { email: current.email });
  }
}
