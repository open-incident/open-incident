"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant, workingHoursSets } from "@openincident/db";
import { getT } from "@/i18n/server";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";
import type { DialogResult } from "@/components/settings/dialog";
import { setsUsage } from "./usage";

const PAGE = "/app/settings/working-hours";

/** The day presets of the dialog, as ISO weekdays (1 = Monday). */
const PRESETS: Record<string, number[]> = {
  "mon-fri": [1, 2, 3, 4, 5],
  "mon-sat": [1, 2, 3, 4, 5, 6],
  "every-day": [1, 2, 3, 4, 5, 6, 7],
  "sat-sun": [6, 7],
};

const schema = z.object({
  id: z.string().uuid().or(z.literal("")).optional(),
  name: z.string().trim().min(2).max(60),
  days: z.string(),
  timezone: z.string().refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz)),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

/**
 * Creates or edits a set. The days come from a preset, or — `keep:1,2,3` —
 * stay what an existing set already had when it matches no preset.
 */
export async function saveWorkingHours(
  _prev: DialogResult,
  formData: FormData,
): Promise<DialogResult> {
  const current = await requireManager();
  const t = await getT();
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: t("settingsV2.error.invalid") };
  const input = parsed.data;
  const days = input.days.startsWith("keep:")
    ? input.days
        .slice(5)
        .split(",")
        .map(Number)
        .filter((d) => d >= 1 && d <= 7)
    : PRESETS[input.days];
  if (!days?.length) return { ok: false, error: t("settingsV2.error.invalid") };
  // An end before the start wraps past midnight; 00:00 as an end is midnight. Only an empty range is refused.
  if (input.startTime === input.endTime) return { ok: false, error: t("settingsV2.error.invalid") };
  const duplicate = await withTenant(current.tenant.id, async (tx) => {
    const [other] = await tx
      .select({ id: workingHoursSets.id })
      .from(workingHoursSets)
      .where(
        and(
          eq(workingHoursSets.tenantId, current.tenant.id),
          eq(workingHoursSets.name, input.name),
        ),
      );
    return Boolean(other && other.id !== input.id);
  });
  if (duplicate) return { ok: false, error: t("settingsV2.error.invalid") };
  await withTenant(current.tenant.id, async (tx) => {
    const values = {
      name: input.name,
      timezone: input.timezone,
      days,
      startTime: input.startTime,
      endTime: input.endTime,
    };
    if (input.id)
      await tx
        .update(workingHoursSets)
        .set({ ...values, updatedAt: new Date() })
        .where(
          and(eq(workingHoursSets.tenantId, current.tenant.id), eq(workingHoursSets.id, input.id)),
        );
    else await tx.insert(workingHoursSets).values({ tenantId: current.tenant.id, ...values });
    await recordAudit(
      tx,
      current,
      "config",
      input.id ? "working_hours.updated" : "working_hours.created",
      { name: input.name },
    );
  });
  revalidatePath(PAGE);
  return {
    ok: true,
    message: input.id
      ? t("settingsV2.hours.savedNamed", { name: input.name })
      : t("settingsV2.hours.created"),
  };
}

/** A set nobody reads can go; one a policy reads cannot — the policy would lose its branch. */
export async function deleteWorkingHours(
  _prev: DialogResult,
  formData: FormData,
): Promise<DialogResult> {
  const current = await requireManager();
  const t = await getT();
  const id = z.string().uuid().parse(formData.get("id"));
  const usedBy = (await setsUsage(current.tenant.id)).get(id) ?? [];
  if (usedBy.length)
    return { ok: false, error: t("settingsV2.hours.inUse", { names: usedBy.join(", ") }) };
  await withTenant(current.tenant.id, async (tx) => {
    const [w] = await tx
      .select()
      .from(workingHoursSets)
      .where(and(eq(workingHoursSets.tenantId, current.tenant.id), eq(workingHoursSets.id, id)));
    if (!w) return;
    await tx.delete(workingHoursSets).where(eq(workingHoursSets.id, id));
    await recordAudit(tx, current, "config", "working_hours.deleted", { name: w.name });
  });
  revalidatePath(PAGE);
  return { ok: true, message: t("settingsV2.hours.deleted") };
}
