"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant, workspaces } from "@openincident/db";
import { isLocaleCode } from "@/i18n/locales";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  locale: z.string(),
  timezone: z.string().refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz)),
  accentColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .or(z.literal("")),
});

/** Identity + regional settings + accent. One audit line names what changed. */
export async function saveGeneral(formData: FormData) {
  const current = await requireManager();
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect("/app/settings/general?error=invalid");
  const input = parsed.data;
  const locale = isLocaleCode(input.locale) ? input.locale : current.workspace.locale;

  await withTenant(current.tenant.id, async (tx) => {
    await tx
      .update(workspaces)
      .set({
        name: input.name,
        locale,
        timezone: input.timezone,
        branding: { ...current.workspace.branding, accentColor: input.accentColor || undefined },
        updatedAt: new Date(),
      })
      .where(eq(workspaces.tenantId, current.tenant.id));
    await recordAudit(tx, current, "config", "workspace.updated", {
      name: input.name !== current.workspace.name ? input.name : undefined,
      locale: locale !== current.workspace.locale ? locale : undefined,
      timezone: input.timezone !== current.workspace.timezone ? input.timezone : undefined,
      accentColor:
        (input.accentColor || undefined) !== current.workspace.branding.accentColor
          ? input.accentColor || null
          : undefined,
    });
  });
  revalidatePath("/", "layout");
  redirect("/app/settings/general?saved=1");
}
