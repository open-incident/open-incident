"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createRole, deleteRole, updateRole } from "@openincident/ee-web/roles";
import { withTenant } from "@openincident/db";
import { recordAudit } from "@/lib/audit";
import { entitlementsFor } from "@/lib/entitlements";
import { requireManager } from "@/lib/session";

/* The licence seam: each action is a line that hands the work to ee/web. */

export async function saveRole(formData: FormData): Promise<void> {
  const current = await requireManager();
  if (!entitlementsFor(current.tenant).customRoles) redirect("/app/settings/roles");
  const id = formData.get("id") ? z.string().uuid().parse(formData.get("id")) : null;
  const input = {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    base: z.enum(["admin", "responder", "viewer"]).catch("responder").parse(formData.get("base")),
    permissions: formData.getAll("permissions").map(String),
  };
  const result = id
    ? await updateRole(current.tenant.id, id, input)
    : await createRole(current.tenant.id, input);
  if (!result.ok) redirect(`/app/settings/roles?error=${result.code}`);
  await withTenant(current.tenant.id, (tx) =>
    recordAudit(tx, current, "members", id ? "role.updated" : "role.created", {
      name: input.name,
      base: input.base,
      permissions: input.permissions,
    }),
  );
  revalidatePath("/app/settings/roles");
  redirect("/app/settings/roles?saved=1");
}

export async function removeRole(formData: FormData): Promise<void> {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  const result = await deleteRole(current.tenant.id, id);
  if (!result.ok) {
    const p = new URLSearchParams({ error: result.code });
    if (result.detail) p.set("detail", result.detail);
    redirect(`/app/settings/roles?${p.toString()}`);
  }
  await withTenant(current.tenant.id, (tx) =>
    recordAudit(tx, current, "members", "role.deleted", { id }),
  );
  revalidatePath("/app/settings/roles");
  redirect("/app/settings/roles?removed=1");
}
