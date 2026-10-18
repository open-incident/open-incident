"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant, workspaces } from "@openincident/db";
import { getT } from "@/i18n/server";
import { isLocaleCode } from "@/i18n/locales";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";
import type { FormResult } from "@/components/settings/settings-form";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  locale: z.string(),
  timezone: z.string().refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz)),
});

/** Name, language, default timezone. One audit line names what changed. */
export async function saveGeneral(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const current = await requireManager();
  const t = await getT();
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: t("settingsV2.error.invalid") };
  const input = parsed.data;
  const locale = isLocaleCode(input.locale) ? input.locale : current.workspace.locale;

  await withTenant(current.tenant.id, async (tx) => {
    await tx
      .update(workspaces)
      .set({ name: input.name, locale, timezone: input.timezone, updatedAt: new Date() })
      .where(eq(workspaces.tenantId, current.tenant.id));
    await recordAudit(tx, current, "config", "workspace.updated", {
      name: input.name !== current.workspace.name ? input.name : undefined,
      locale: locale !== current.workspace.locale ? locale : undefined,
      timezone: input.timezone !== current.workspace.timezone ? input.timezone : undefined,
    });
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
