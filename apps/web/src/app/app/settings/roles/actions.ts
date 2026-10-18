"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ROLE_PERMISSIONS } from "@openincident/config";
import { createRole, deleteRole, updateRole, type RoleInput } from "@openincident/ee-web/roles";
import { customRoles, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { recordAudit } from "@/lib/audit";
import { entitlementsFor } from "@/lib/entitlements";
import { requireManager } from "@/lib/session";
import type { DialogResult } from "@/components/settings/dialog";
import type { FormResult } from "@/components/settings/settings-form";

/* The licence seam: each action hands the work to ee/web; the app keeps the audit. */

const PATH = "/app/settings/roles";
const baseSchema = z.enum(["admin", "responder", "viewer"]).catch("responder");

export type CreateRoleResult = (DialogResult & { id?: string }) | null;

async function current() {
  const c = await requireManager();
  if (!entitlementsFor(c.tenant).customRoles) throw new Error("forbidden: customRoles");
  return c;
}

async function readRole(tenantId: string, id: string) {
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(customRoles)
      .where(and(eq(customRoles.tenantId, tenantId), eq(customRoles.id, id))),
  );
  return row ?? null;
}

/** "+ New role": a name, a description, a base — its permissions start as the base's. */
export async function createRoleAction(
  _prev: CreateRoleResult,
  formData: FormData,
): Promise<CreateRoleResult> {
  const c = await current();
  const t = await getT();
  const base = baseSchema.parse(formData.get("base"));
  const input: RoleInput = {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    base,
    permissions: [...ROLE_PERMISSIONS[base]],
  };
  const result = await createRole(c.tenant.id, input);
  if (!result.ok)
    return {
      ok: false,
      error:
        result.code === "duplicate"
          ? t("settingsV2.roles.error.duplicate")
          : t("settingsV2.roles.error.name"),
    };
  await withTenant(c.tenant.id, (tx) =>
    recordAudit(tx, c, "members", "role.created", {
      name: input.name.trim(),
      base,
      permissions: input.permissions,
    }),
  );
  revalidatePath(PATH);
  return { ok: true, message: t("settingsV2.roles.flash.created"), id: result.id };
}

/** "Edit": name, description and base; the permissions stay as the matrix has them. */
export async function editRoleAction(
  _prev: DialogResult,
  formData: FormData,
): Promise<DialogResult> {
  const c = await current();
  const t = await getT();
  const id = z.string().uuid().parse(formData.get("id"));
  const role = await readRole(c.tenant.id, id);
  if (!role) return { ok: false, error: t("settingsV2.error.invalid") };
  const input: RoleInput = {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    base: baseSchema.parse(formData.get("base")),
    permissions: role.permissions,
  };
  const result = await updateRole(c.tenant.id, id, input);
  if (!result.ok) return { ok: false, error: t("settingsV2.roles.error.name") };
  await withTenant(c.tenant.id, (tx) =>
    recordAudit(tx, c, "members", "role.updated", {
      name: input.name.trim(),
      base: input.base,
      permissions: input.permissions,
    }),
  );
  revalidatePath(PATH);
  return { ok: true, message: t("settingsV2.roles.flash.saved") };
}

/** The matrix's save bar: the selected role's permissions, box by box. */
export async function saveRolePermissions(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const c = await current();
  const t = await getT();
  const id = z.string().uuid().parse(formData.get("id"));
  const role = await readRole(c.tenant.id, id);
  if (!role) return { ok: false, error: t("settingsV2.error.invalid") };
  const input: RoleInput = {
    name: role.name,
    description: role.description ?? "",
    base: role.base === "owner" ? "admin" : role.base,
    permissions: formData.getAll("permissions").map(String),
  };
  const result = await updateRole(c.tenant.id, id, input);
  if (!result.ok) return { ok: false, error: t("settingsV2.error.invalid") };
  await withTenant(c.tenant.id, (tx) =>
    recordAudit(tx, c, "members", "role.updated", {
      name: role.name,
      base: input.base,
      permissions: input.permissions,
    }),
  );
  revalidatePath(PATH);
  return { ok: true };
}

/** Refused while a member holds the role: the answer names who. */
export async function removeRoleAction(
  formData: FormData,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const c = await current();
  const t = await getT();
  const id = z.string().uuid().parse(formData.get("id"));
  const role = await readRole(c.tenant.id, id);
  if (!role) return { ok: false, error: t("settingsV2.error.invalid") };
  const result = await deleteRole(c.tenant.id, id);
  if (!result.ok)
    return {
      ok: false,
      error: t("settingsV2.roles.error.inUse", { name: role.name, members: result.detail ?? "" }),
    };
  await withTenant(c.tenant.id, (tx) =>
    recordAudit(tx, c, "members", "role.deleted", { id, name: role.name }),
  );
  revalidatePath(PATH);
  return { ok: true, message: t("settingsV2.roles.flash.deleted", { name: role.name }) };
}
