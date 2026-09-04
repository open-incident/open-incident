"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { announcementRules, announcementTemplates, withTenant } from "@openincident/db";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";

const audience = z.enum(["workspace", "owner_team", "role_holders"]);

export async function createTemplate(formData: FormData) {
  const current = await requireManager();
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(120),
      audience,
      body: z.string().trim().min(1).max(2000),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect("/app/settings/announcements?error=invalid");
  const input = parsed.data;
  await withTenant(current.tenant.id, async (tx) => {
    const [dup] = await tx
      .select({ id: announcementTemplates.id })
      .from(announcementTemplates)
      .where(
        and(
          eq(announcementTemplates.tenantId, current.tenant.id),
          eq(announcementTemplates.name, input.name),
        ),
      );
    if (dup) redirect("/app/settings/announcements?error=duplicate");
    const [maxRow] = await tx
      .select({
        max: sql<number>`coalesce(max(${announcementTemplates.position}), -1)`.mapWith(Number),
      })
      .from(announcementTemplates)
      .where(eq(announcementTemplates.tenantId, current.tenant.id));
    await tx.insert(announcementTemplates).values({
      tenantId: current.tenant.id,
      name: input.name,
      audience: input.audience,
      body: input.body,
      position: (maxRow?.max ?? -1) + 1,
    });
    await recordAudit(tx, current, "config", "announcement_template.created", { name: input.name });
  });
  revalidatePath("/app/settings/announcements");
  redirect("/app/settings/announcements?saved=1");
}

export async function deleteTemplate(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(announcementTemplates)
      .where(
        and(
          eq(announcementTemplates.tenantId, current.tenant.id),
          eq(announcementTemplates.id, id),
        ),
      );
    if (!row) return;
    await tx.delete(announcementTemplates).where(eq(announcementTemplates.id, row.id));
    await recordAudit(tx, current, "config", "announcement_template.deleted", { name: row.name });
  });
  revalidatePath("/app/settings/announcements");
}

export async function createRule(formData: FormData) {
  const current = await requireManager();
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(120),
      minSeverityRank: z.string().optional(),
      typeId: z.string().uuid().or(z.literal("")),
      templateId: z.string().uuid(),
      audience,
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect("/app/settings/announcements?error=invalid");
  const input = parsed.data;
  await withTenant(current.tenant.id, async (tx) => {
    const [tpl] = await tx
      .select({ id: announcementTemplates.id })
      .from(announcementTemplates)
      .where(
        and(
          eq(announcementTemplates.tenantId, current.tenant.id),
          eq(announcementTemplates.id, input.templateId),
        ),
      );
    if (!tpl) redirect("/app/settings/announcements?error=invalid");
    await tx.insert(announcementRules).values({
      tenantId: current.tenant.id,
      name: input.name,
      active: true,
      minSeverityRank: input.minSeverityRank ? Number(input.minSeverityRank) : null,
      typeId: input.typeId || null,
      templateId: tpl.id,
      audience: input.audience,
    });
    await recordAudit(tx, current, "config", "announcement_rule.created", { name: input.name });
  });
  revalidatePath("/app/settings/announcements");
  redirect("/app/settings/announcements?saved=1");
}

export async function toggleRule(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(announcementRules)
      .where(and(eq(announcementRules.tenantId, current.tenant.id), eq(announcementRules.id, id)));
    if (!row) return;
    await tx
      .update(announcementRules)
      .set({ active: !row.active, updatedAt: new Date() })
      .where(eq(announcementRules.id, row.id));
    await recordAudit(
      tx,
      current,
      "config",
      row.active ? "announcement_rule.disabled" : "announcement_rule.enabled",
      { name: row.name },
    );
  });
  revalidatePath("/app/settings/announcements");
}

export async function deleteRule(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(announcementRules)
      .where(and(eq(announcementRules.tenantId, current.tenant.id), eq(announcementRules.id, id)));
    if (!row) return;
    await tx.delete(announcementRules).where(eq(announcementRules.id, row.id));
    await recordAudit(tx, current, "config", "announcement_rule.deleted", { name: row.name });
  });
  revalidatePath("/app/settings/announcements");
}
