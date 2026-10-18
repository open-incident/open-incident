"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  getScimSettings,
  issueScimToken,
  setScimEnabled,
  updateScimOptions,
} from "@openincident/ee-web/scim";
import { withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { recordAudit } from "@/lib/audit";
import { entitlementsFor } from "@/lib/entitlements";
import { requireManager } from "@/lib/session";
import type { DialogResult } from "@/components/settings/dialog";
import type { FormResult } from "@/components/settings/settings-form";

/* The licence seam: each action hands the work to ee/web; the app keeps the audit. */

const PATH = "/app/settings/scim";
const roleSchema = z.enum(["admin", "responder", "viewer"]).catch("responder");

async function current() {
  const c = await requireManager();
  if (!entitlementsFor(c.tenant).sso) throw new Error("forbidden: sso");
  return c;
}

/**
 * Issues the endpoint's token — the first one, or a rotation that kills the
 * previous one at once. The plain token goes back once, to the dialog's
 * "shown once" panel, and is never stored anywhere but as its hash.
 */
export async function issueScim(_prev: DialogResult, _formData: FormData): Promise<DialogResult> {
  const c = await current();
  const t = await getT();
  const settings = await getScimSettings(c.tenant.id);
  const { token, rotated } = await issueScimToken(c.tenant.id, {
    defaultRole: settings?.defaultRole ?? "responder",
    sendInvites: settings?.sendInvites ?? true,
    actorMemberId: c.member.id,
  });
  await withTenant(c.tenant.id, (tx) =>
    recordAudit(tx, c, "security", rotated ? "scim.token_rotated" : "scim.enabled", {}),
  );
  revalidatePath(PATH);
  return {
    ok: true,
    secret: token,
    secretNote: t("settingsV2.scim.dialog.secretNote"),
    secretDone: t("settingsV2.scim.dialog.secretDone"),
  };
}

/** Disable closes the door (401 on every call); Enable opens it again. Nothing else changes. */
export async function toggleScim(
  formData: FormData,
): Promise<{ ok: true; enabled: boolean } | { ok: false; error: string }> {
  const c = await current();
  const t = await getT();
  if (!(await getScimSettings(c.tenant.id)))
    return { ok: false, error: t("settingsV2.error.invalid") };
  const enabled = formData.get("enabled") === "on";
  await setScimEnabled(c.tenant.id, enabled);
  await withTenant(c.tenant.id, (tx) =>
    recordAudit(tx, c, "security", enabled ? "scim.enabled" : "scim.disabled", {}),
  );
  revalidatePath(PATH);
  return { ok: true, enabled };
}

/** "Provisioned members": the role a provider-created member gets, and the invitation email. */
export async function saveScimOptions(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const c = await current();
  const t = await getT();
  if (!(await getScimSettings(c.tenant.id)))
    return { ok: false, error: t("settingsV2.error.invalid") };
  const input = {
    defaultRole: roleSchema.parse(formData.get("defaultRole")),
    sendInvites: formData.get("sendInvites") === "on",
  };
  await updateScimOptions(c.tenant.id, input);
  await withTenant(c.tenant.id, (tx) =>
    recordAudit(tx, c, "security", "scim.options_updated", input),
  );
  revalidatePath(PATH);
  return { ok: true };
}
