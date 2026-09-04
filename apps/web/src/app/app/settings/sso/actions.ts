"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSsoConnection, removeSsoConnection } from "@openincident/ee-web/sso";
import { withTenant } from "@openincident/db";
import { recordAudit } from "@/lib/audit";
import { entitlementsFor } from "@/lib/entitlements";
import { requireManager } from "@/lib/session";
import { currentOrigin } from "@/lib/tenant";

/* The licence seam: each action is a line that hands the work to ee/web. */

export async function createSso(formData: FormData): Promise<void> {
  const current = await requireManager();
  if (!entitlementsFor(current.tenant).sso) redirect("/app/settings/sso");
  const kind = formData.get("kind") === "saml" ? "saml" : "oidc";
  const role = z
    .enum(["admin", "responder", "viewer"])
    .catch("responder")
    .parse(formData.get("defaultRole"));
  const str = (k: string) => String(formData.get(k) ?? "");
  const result = await createSsoConnection(
    current.tenant.id,
    await currentOrigin(),
    {
      kind,
      label: str("label"),
      allowedDomains: str("domains").split(/[\s,;]+/),
      defaultRole: role,
      jitProvisioning: formData.get("jit") === "on",
      enforce: formData.get("enforce") === "on",
      oidc: { issuer: str("issuer"), clientId: str("clientId"), clientSecret: str("clientSecret") },
      saml: {
        entryPoint: str("entryPoint"),
        entityId: str("entityId"),
        cert: str("cert"),
        metadata: str("metadata"),
      },
    },
    current.member.id,
  );
  if (!result.ok) {
    const p = new URLSearchParams({ error: result.code });
    if (result.detail) p.set("detail", result.detail.slice(0, 200));
    redirect(`/app/settings/sso?${p.toString()}`);
  }
  await withTenant(current.tenant.id, (tx) =>
    recordAudit(tx, current, "security", "sso.connection_created", {
      kind,
      label: str("label"),
      providerId: result.providerId,
      enforce: formData.get("enforce") === "on",
    }),
  );
  revalidatePath("/app/settings/sso");
  redirect("/app/settings/sso?saved=1");
}

export async function removeSso(formData: FormData): Promise<void> {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  const providerId = await removeSsoConnection(current.tenant.id, id);
  if (providerId)
    await withTenant(current.tenant.id, (tx) =>
      recordAudit(tx, current, "security", "sso.connection_removed", { providerId }),
    );
  revalidatePath("/app/settings/sso");
  redirect("/app/settings/sso?removed=1");
}
