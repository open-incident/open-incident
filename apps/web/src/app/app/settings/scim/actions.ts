"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { issueScimToken, setScimEnabled, updateScimOptions } from "@openincident/ee-web/scim";
import { withTenant } from "@openincident/db";
import { recordAudit } from "@/lib/audit";
import { entitlementsFor } from "@/lib/entitlements";
import { requireManager } from "@/lib/session";

/* The licence seam: each action is a line that hands the work to ee/web. */

const roleSchema = z.enum(["admin", "responder", "viewer"]).catch("responder");

export async function issueScim(
  formData: FormData,
): Promise<{ token: string } | { error: string }> {
  const current = await requireManager();
  if (!entitlementsFor(current.tenant).sso) return { error: "unavailable" };
  const { token, rotated } = await issueScimToken(current.tenant.id, {
    defaultRole: roleSchema.parse(formData.get("defaultRole")),
    sendInvites: formData.get("sendInvites") === "on",
    actorMemberId: current.member.id,
  });
  await withTenant(current.tenant.id, (tx) =>
    recordAudit(tx, current, "security", rotated ? "scim.token_rotated" : "scim.enabled", {}),
  );
  revalidatePath("/app/settings/scim");
  return { token };
}

export async function toggleScim(formData: FormData): Promise<void> {
  const current = await requireManager();
  const enabled = formData.get("enabled") === "on";
  await setScimEnabled(current.tenant.id, enabled);
  await withTenant(current.tenant.id, (tx) =>
    recordAudit(tx, current, "security", enabled ? "scim.enabled" : "scim.disabled", {}),
  );
  revalidatePath("/app/settings/scim");
  redirect("/app/settings/scim");
}

export async function saveScimOptions(formData: FormData): Promise<void> {
  const current = await requireManager();
  await updateScimOptions(current.tenant.id, {
    defaultRole: roleSchema.parse(formData.get("defaultRole")),
    sendInvites: formData.get("sendInvites") === "on",
  });
  revalidatePath("/app/settings/scim");
  redirect("/app/settings/scim?saved=1");
}
