"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { alertAttributes, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";
import type { DialogResult } from "@/components/settings/dialog";

const PAGE = "/app/settings/labels";

const schema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]{1,60}$/),
  label: z.string().trim().min(1).max(60),
  type: z.enum(["text", "list", "priority", "service", "team"]),
  required: z.string().optional(),
  mergeStrategy: z.enum(["first", "last", "accumulate", "max"]),
});

/**
 * How the pipeline reads one label: the name screens show it under, what it
 * names (a service or a team is matched against the workspace's own), whether
 * every alert should carry it, and what a repeat of the same alert does to
 * it. A label is observed before it is described: the row is created the
 * first time somebody says something about the key.
 */
export async function saveLabel(_prev: DialogResult, formData: FormData): Promise<DialogResult> {
  const current = await requireManager();
  const t = await getT();
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: t("settingsV2.error.invalid") };
  const input = parsed.data;
  const values = {
    label: input.label,
    type: input.type,
    required: input.required === "on",
    // Only a list accumulates; "highest" reads a severity.
    mergeStrategy:
      input.type !== "list" && input.mergeStrategy === "accumulate"
        ? ("last" as const)
        : input.type !== "priority" && input.mergeStrategy === "max"
          ? ("last" as const)
          : input.mergeStrategy,
    updatedAt: new Date(),
  };
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select({ id: alertAttributes.id })
      .from(alertAttributes)
      .where(
        and(eq(alertAttributes.tenantId, current.tenant.id), eq(alertAttributes.key, input.key)),
      );
    if (row) {
      await tx.update(alertAttributes).set(values).where(eq(alertAttributes.id, row.id));
      await recordAudit(tx, current, "config", "alert_attribute.updated", { key: input.key });
      return;
    }
    const [max] = await tx
      .select({ max: sql<number>`coalesce(max(${alertAttributes.position}), -1)`.mapWith(Number) })
      .from(alertAttributes)
      .where(eq(alertAttributes.tenantId, current.tenant.id));
    await tx.insert(alertAttributes).values({
      tenantId: current.tenant.id,
      key: input.key,
      ...values,
      position: (max?.max ?? -1) + 1,
    });
    await recordAudit(tx, current, "config", "alert_attribute.created", { key: input.key });
  });
  revalidatePath(PAGE);
  return { ok: true, message: t("settingsV2.labels.saved", { key: input.key }) };
}
