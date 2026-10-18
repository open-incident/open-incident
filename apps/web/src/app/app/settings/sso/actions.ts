"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSsoConnection, removeSsoConnection } from "@openincident/ee-web/sso";
import { withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { recordAudit } from "@/lib/audit";
import { entitlementsFor } from "@/lib/entitlements";
import { requireManager } from "@/lib/session";
import { currentOrigin } from "@/lib/tenant";
import type { DialogResult } from "@/components/settings/dialog";
import { removalLockout } from "./guard";

/* The licence seam: each action hands the work to ee/web; the app keeps the audit. */

const PATH = "/app/settings/sso";

async function current() {
  const c = await requireManager();
  if (!entitlementsFor(c.tenant).sso) throw new Error("forbidden: sso");
  return c;
}

/** "+ Add a connection": discovery for OpenID Connect, a certificate source for SAML. */
export async function createSso(_prev: DialogResult, formData: FormData): Promise<DialogResult> {
  const c = await current();
  const t = await getT();
  const kind = formData.get("kind") === "saml" ? "saml" : "oidc";
  const role = z
    .enum(["admin", "responder", "viewer"])
    .catch("responder")
    .parse(formData.get("defaultRole"));
  const str = (k: string) => String(formData.get(k) ?? "");
  const enforce = formData.get("enforce") === "on";
  const result = await createSsoConnection(
    c.tenant.id,
    await currentOrigin(),
    {
      kind,
      label: str("label"),
      allowedDomains: str("domains").split(/[\s,;]+/),
      defaultRole: role,
      jitProvisioning: formData.get("jit") === "on",
      enforce,
      oidc: { issuer: str("issuer"), clientId: str("clientId"), clientSecret: str("clientSecret") },
      saml: {
        entryPoint: str("entryPoint"),
        entityId: str("entityId"),
        cert: str("cert"),
        metadata: str("metadata"),
      },
    },
    c.member.id,
  );
  if (!result.ok) {
    const error =
      result.code === "lockout"
        ? t("settingsV2.sso.error.lockout")
        : result.code === "duplicate"
          ? t("settingsV2.sso.error.duplicate")
          : result.code === "discovery"
            ? t("settingsV2.sso.error.discovery", { detail: (result.detail ?? "").slice(0, 200) })
            : result.detail === "label"
              ? t("settingsV2.sso.error.label")
              : result.detail === "saml"
                ? t("settingsV2.sso.error.saml")
                : t("settingsV2.sso.error.oidc");
    return { ok: false, error };
  }
  await withTenant(c.tenant.id, (tx) =>
    recordAudit(tx, c, "security", "sso.connection_created", {
      kind,
      label: str("label"),
      providerId: result.providerId,
      enforce,
    }),
  );
  revalidatePath(PATH);
  return { ok: true, message: t("settingsV2.sso.flash.created") };
}

/**
 * "Remove": refused while the connection is the only way in for an owner and
 * no other owner could still sign in — the design's guard.
 */
export async function removeSso(
  formData: FormData,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const c = await current();
  const t = await getT();
  const id = z.string().uuid().parse(formData.get("id"));
  const guard = await removalLockout(c.tenant.id, id);
  if (guard.refused)
    return { ok: false, error: t("settingsV2.sso.error.onlyWayIn", { count: guard.onlyWayIn }) };
  const providerId = await removeSsoConnection(c.tenant.id, id);
  if (providerId)
    await withTenant(c.tenant.id, (tx) =>
      recordAudit(tx, c, "security", "sso.connection_removed", { providerId }),
    );
  revalidatePath(PATH);
  return { ok: true, message: t("settingsV2.sso.flash.removed") };
}
