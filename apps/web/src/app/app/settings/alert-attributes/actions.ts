"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { alertAttributes, withTenant } from "@openincident/db";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";

const PAGE = "/app/settings/alert-attributes";
const schema = z.object({
  id: z.string().uuid().or(z.literal("")).optional(),
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).optional(),
  type: z.enum(["text", "list", "priority", "service", "team"]),
  required: z.string().optional(),
  mergeStrategy: z.enum(["first", "last", "accumulate", "max"]),
});

/** Creates or edits an attribute; the key is fixed once created (sources map onto it). */
export async function saveAttribute(formData: FormData) {
  const current = await requireManager();
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect(`${PAGE}?error=invalid`);
  const input = parsed.data;
  const values = {
    label: input.label,
    description: input.description || null,
    type: input.type,
    required: input.required === "on",
    mergeStrategy:
      input.type === "list" && input.mergeStrategy === "max"
        ? ("accumulate" as const)
        : input.mergeStrategy,
    updatedAt: new Date(),
  };
  const outcome = await withTenant(current.tenant.id, async (tx) => {
    if (input.id) {
      await tx
        .update(alertAttributes)
        .set(values)
        .where(
          and(eq(alertAttributes.tenantId, current.tenant.id), eq(alertAttributes.id, input.id)),
        );
      await recordAudit(tx, current, "config", "alert_attribute.updated", { key: input.key });
      return "ok";
    }
    const [dup] = await tx
      .select({ id: alertAttributes.id })
      .from(alertAttributes)
      .where(
        and(eq(alertAttributes.tenantId, current.tenant.id), eq(alertAttributes.key, input.key)),
      );
    if (dup) return "duplicate";
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
    return "ok";
  });
  revalidatePath(PAGE);
  redirect(outcome === "duplicate" ? `${PAGE}?error=duplicate` : `${PAGE}?saved=1`);
}

export async function deleteAttribute(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [a] = await tx
      .select({ key: alertAttributes.key })
      .from(alertAttributes)
      .where(and(eq(alertAttributes.tenantId, current.tenant.id), eq(alertAttributes.id, id)));
    if (!a) return;
    await tx.delete(alertAttributes).where(eq(alertAttributes.id, id));
    await recordAudit(tx, current, "config", "alert_attribute.deleted", { key: a.key });
  });
  revalidatePath(PAGE);
  redirect(PAGE);
}

export async function moveAttribute(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  const dir = z.enum(["up", "down"]).parse(formData.get("dir"));
  await withTenant(current.tenant.id, async (tx) => {
    const rows = await tx
      .select({ id: alertAttributes.id })
      .from(alertAttributes)
      .where(eq(alertAttributes.tenantId, current.tenant.id))
      .orderBy(alertAttributes.position, alertAttributes.createdAt);
    const i = rows.findIndex((r) => r.id === id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= rows.length) return;
    const order = rows.map((r) => r.id);
    [order[i], order[j]] = [order[j]!, order[i]!];
    for (const [pos, rid] of order.entries())
      await tx.update(alertAttributes).set({ position: pos }).where(eq(alertAttributes.id, rid));
  });
  revalidatePath(PAGE);
}
