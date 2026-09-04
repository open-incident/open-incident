"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { members, withTenant } from "@openincident/db";
import { isLocaleCode } from "@/i18n/locales";
import { requireMember } from "@/lib/session";

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  locale: z.string(),
  timezone: z.string(),
  theme: z.enum(["light", "dark"]).or(z.literal("")).default(""),
});

/** Own profile only — no id in the form, so it cannot be pointed at a colleague. */
export async function saveProfile(formData: FormData) {
  const current = await requireMember();
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect("/app/account?error=invalid");
  const input = parsed.data;
  const timezone =
    input.timezone && Intl.supportedValuesOf("timeZone").includes(input.timezone)
      ? input.timezone
      : null;
  await withTenant(current.tenant.id, (tx) =>
    tx
      .update(members)
      .set({
        name: input.name,
        locale: isLocaleCode(input.locale) ? input.locale : null,
        timezone,
        theme: input.theme || null,
      })
      .where(eq(members.id, current.member.id)),
  );
  revalidatePath("/", "layout");
  redirect("/app/account?saved=1");
}
