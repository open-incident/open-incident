"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { aiSettings, withTenant, type AiCapability } from "@openincident/db";
import { AI_CAPABILITIES, DEFAULT_AI_SETTINGS, getAiSettings } from "@openincident/ai";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";

const PAGE = "/app/settings/ai";

/** One form for the whole screen: master switch, capabilities, sources, private opt-in, provider label. */
export async function saveAiSettings(formData: FormData) {
  const current = await requireManager();
  const capabilities: Partial<Record<AiCapability, boolean>> = {};
  for (const cap of AI_CAPABILITIES) capabilities[cap] = formData.get(`cap_${cap}`) === "on";
  const sources = {
    catalog: true,
    incidents: formData.get("src_incidents") === "on",
    changeEvents: formData.get("src_changeEvents") === "on",
    docs: formData.get("src_docs") === "on",
  };
  const values = {
    enabled: formData.get("enabled") === "on",
    capabilities,
    sources,
    privateOptIn: formData.get("privateOptIn") === "on",
    provider: String(formData.get("provider") ?? "") || null,
    updatedAt: new Date(),
  };
  await withTenant(current.tenant.id, async (tx) => {
    const existing = await getAiSettings(tx, current.tenant.id);
    void existing;
    const rows = await tx
      .select({ id: aiSettings.id })
      .from(aiSettings)
      .where(eq(aiSettings.tenantId, current.tenant.id));
    if (rows[0]) await tx.update(aiSettings).set(values).where(eq(aiSettings.id, rows[0].id));
    else
      await tx
        .insert(aiSettings)
        .values({ tenantId: current.tenant.id, ...DEFAULT_AI_SETTINGS, ...values });
    await recordAudit(tx, current, "config", "ai.settings", {
      enabled: values.enabled,
      off: AI_CAPABILITIES.filter((c) => capabilities[c] === false),
      privateOptIn: values.privateOptIn,
    });
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?saved=1`);
}
