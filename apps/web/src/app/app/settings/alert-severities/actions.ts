"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { alertPriorities, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";
import type { DialogResult } from "@/components/settings/dialog";
import { COLOURS } from "./colours";

const PAGE = "/app/settings/alert-severities";

const schema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(12),
  description: z.string().trim().max(160).optional(),
  urgency: z.enum(["high", "low"]),
  color: z.enum(COLOURS),
  /** What the tools call it — comma-separated, matched case-insensitively. */
  aliases: z.string().trim().max(400).optional(),
  isDefault: z.string().optional(),
});

const aliasList = (raw: string | undefined) => [
  ...new Set(
    (raw ?? "")
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean),
  ),
];

/**
 * "Edit P1": the level's name, label, what it does on its own (its urgency),
 * the names the tools give it, its colour, and whether it is the level of an
 * alert that names none. Alerts already received keep what they were given.
 */
export async function saveSeverity(_prev: DialogResult, formData: FormData): Promise<DialogResult> {
  const current = await requireManager();
  const t = await getT();
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues.some((i) => i.path[0] === "name")
        ? t("settingsV2.asev.err.name")
        : t("settingsV2.error.invalid"),
    };
  const input = parsed.data;
  const outcome = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(alertPriorities)
      .where(
        and(eq(alertPriorities.tenantId, current.tenant.id), eq(alertPriorities.id, input.id)),
      );
    if (!row) return "missing" as const;
    const [clash] = await tx
      .select({ id: alertPriorities.id })
      .from(alertPriorities)
      .where(
        and(eq(alertPriorities.tenantId, current.tenant.id), eq(alertPriorities.name, input.name)),
      );
    if (clash && clash.id !== row.id) return "clash" as const;
    const makeDefault = input.isDefault === "on";
    if (makeDefault && !row.isDefault)
      await tx
        .update(alertPriorities)
        .set({ isDefault: false })
        .where(eq(alertPriorities.tenantId, current.tenant.id));
    await tx
      .update(alertPriorities)
      .set({
        name: input.name,
        description: input.description || null,
        urgency: input.urgency,
        color: input.color,
        aliases: aliasList(input.aliases),
        isDefault: makeDefault,
      })
      .where(eq(alertPriorities.id, row.id));
    await recordAudit(tx, current, "config", "alert_priority.updated", {
      id: row.id,
      name: input.name,
      ...(row.name !== input.name ? { from: row.name } : {}),
    });
    return "ok" as const;
  });
  if (outcome !== "ok") return { ok: false, error: t("settingsV2.error.invalid") };
  revalidatePath(PAGE);
  return { ok: true, message: t("settingsV2.asev.saved", { name: input.name }) };
}
