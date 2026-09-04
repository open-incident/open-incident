"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { alertPriorities, withTenant } from "@openincident/db";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";

const PAGE = "/app/settings/alert-priorities";
const schema = z.object({
  id: z.string().uuid().or(z.literal("")).optional(),
  name: z.string().trim().min(1).max(12),
  description: z.string().trim().max(160).optional(),
  urgency: z.enum(["high", "low"]),
  color: z.enum([
    "var(--dang)",
    "var(--wait)",
    "var(--open)",
    "var(--viol)",
    "var(--ok)",
    "var(--ink-3)",
  ]),
});

export async function savePriority(formData: FormData) {
  const current = await requireManager();
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect(`${PAGE}?error=invalid`);
  const input = parsed.data;
  await withTenant(current.tenant.id, async (tx) => {
    if (input.id) {
      await tx
        .update(alertPriorities)
        .set({
          name: input.name,
          description: input.description || null,
          urgency: input.urgency,
          color: input.color,
        })
        .where(
          and(eq(alertPriorities.tenantId, current.tenant.id), eq(alertPriorities.id, input.id)),
        );
    } else {
      const [max] = await tx
        .select({ max: sql<number>`coalesce(max(${alertPriorities.rank}), -1)`.mapWith(Number) })
        .from(alertPriorities)
        .where(eq(alertPriorities.tenantId, current.tenant.id));
      const rank = (max?.max ?? -1) + 1;
      await tx.insert(alertPriorities).values({
        tenantId: current.tenant.id,
        name: input.name,
        description: input.description || null,
        urgency: input.urgency,
        color: input.color,
        rank,
        position: rank,
      });
    }
    await recordAudit(
      tx,
      current,
      "config",
      input.id ? "alert_priority.updated" : "alert_priority.created",
      { name: input.name },
    );
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?saved=1`);
}

/** Moves a priority one step up or down; ranks are renumbered so 0 stays the most important. */
export async function movePriority(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  const dir = z.enum(["up", "down"]).parse(formData.get("dir"));
  await withTenant(current.tenant.id, async (tx) => {
    const rows = await tx
      .select()
      .from(alertPriorities)
      .where(eq(alertPriorities.tenantId, current.tenant.id))
      .orderBy(alertPriorities.rank);
    const i = rows.findIndex((r) => r.id === id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j]!, rows[i]!];
    for (const [rank, r] of rows.entries())
      await tx
        .update(alertPriorities)
        .set({ rank, position: rank })
        .where(eq(alertPriorities.id, r.id));
  });
  revalidatePath(PAGE);
}

export async function deletePriority(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [p] = await tx
      .select()
      .from(alertPriorities)
      .where(and(eq(alertPriorities.tenantId, current.tenant.id), eq(alertPriorities.id, id)));
    if (!p) return;
    await tx.delete(alertPriorities).where(eq(alertPriorities.id, id));
    await recordAudit(tx, current, "config", "alert_priority.deleted", { name: p.name });
  });
  revalidatePath(PAGE);
}
