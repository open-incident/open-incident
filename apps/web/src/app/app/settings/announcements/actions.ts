"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  announcementRules,
  announcementTemplates,
  incidentTypes,
  severities,
  withTenant,
} from "@openincident/db";
import { getT } from "@/i18n/server";
import { TEMPLATE_VARIABLES } from "@/lib/announcements";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";
import type { DialogResult } from "@/components/settings/dialog";
import { ruleSentence } from "./sentence";

const PAGE = "/app/settings/announcements";

const ruleSchema = z.object({
  id: z.string().uuid().or(z.literal("")).optional(),
  typeId: z.string().uuid().or(z.literal("")).default(""),
  minSeverityRank: z.string().default(""),
  templateId: z.string().uuid(),
});

/**
 * "+ Rule" and a rule's edit dialog: of which type, from which severity, with
 * which template. Where it posts is not the rule's to say: the announcement
 * engine posts every living post in the announcement channels chosen in
 * Slack & Teams. A new rule is named after its sentence, in the words of the
 * person who wrote it; the timeline quotes that name.
 *
 * The same dialog pauses (`active` off) and deletes (`intent=delete`) it.
 */
export async function saveRule(_prev: DialogResult, formData: FormData): Promise<DialogResult> {
  const current = await requireManager();
  const t = await getT();
  if (formData.get("intent") === "delete") return removeRule(formData);
  const parsed = ruleSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: t("settingsV2.ann.needTemplate") };
  const input = parsed.data;
  const rank = input.minSeverityRank === "" ? null : Number(input.minSeverityRank);
  if (rank !== null && (!Number.isInteger(rank) || rank < 0))
    return { ok: false, error: t("settingsV2.error.invalid") };

  const out = await withTenant(current.tenant.id, async (tx) => {
    const [tpl] = await tx
      .select({ id: announcementTemplates.id })
      .from(announcementTemplates)
      .where(
        and(
          eq(announcementTemplates.tenantId, current.tenant.id),
          eq(announcementTemplates.id, input.templateId),
        ),
      );
    if (!tpl) return "invalid" as const;
    const [type] = input.typeId
      ? await tx
          .select({ id: incidentTypes.id, name: incidentTypes.name })
          .from(incidentTypes)
          .where(
            and(eq(incidentTypes.tenantId, current.tenant.id), eq(incidentTypes.id, input.typeId)),
          )
      : [];
    if (input.typeId && !type) return "invalid" as const;
    if (input.id) {
      const [row] = await tx
        .select()
        .from(announcementRules)
        .where(
          and(
            eq(announcementRules.tenantId, current.tenant.id),
            eq(announcementRules.id, input.id),
          ),
        );
      if (!row) return "invalid" as const;
      const active = formData.get("active") === "on";
      await tx
        .update(announcementRules)
        .set({
          typeId: type?.id ?? null,
          minSeverityRank: rank,
          templateId: tpl.id,
          active,
          updatedAt: new Date(),
        })
        .where(eq(announcementRules.id, row.id));
      await recordAudit(tx, current, "config", "announcement_rule.updated", {
        name: row.name,
        active,
      });
      return "saved" as const;
    }
    const sevs = await tx
      .select({ rank: severities.rank, name: severities.name })
      .from(severities)
      .where(eq(severities.tenantId, current.tenant.id))
      .orderBy(asc(severities.rank));
    const name = ruleSentence(t, sevs, {
      minSeverityRank: rank,
      typeName: type?.name ?? null,
    }).slice(0, 120);
    await tx.insert(announcementRules).values({
      tenantId: current.tenant.id,
      name,
      active: true,
      minSeverityRank: rank,
      typeId: type?.id ?? null,
      templateId: tpl.id,
      audience: "workspace",
    });
    await recordAudit(tx, current, "config", "announcement_rule.created", { name });
    return "created" as const;
  });
  if (out === "invalid") return { ok: false, error: t("settingsV2.error.invalid") };
  revalidatePath(PAGE);
  return {
    ok: true,
    message: out === "created" ? t("settingsV2.ann.ruleAdded") : t("settingsV2.ann.ruleSaved"),
  };
}

async function removeRule(formData: FormData): Promise<DialogResult> {
  const current = await requireManager();
  const t = await getT();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: t("settingsV2.error.invalid") };
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(announcementRules)
      .where(
        and(eq(announcementRules.tenantId, current.tenant.id), eq(announcementRules.id, id.data)),
      );
    if (!row) return;
    await tx.delete(announcementRules).where(eq(announcementRules.id, row.id));
    await recordAudit(tx, current, "config", "announcement_rule.deleted", { name: row.name });
  });
  revalidatePath(PAGE);
  return { ok: true, message: t("settingsV2.ann.ruleDeleted") };
}

const templateSchema = z.object({
  id: z.string().uuid().or(z.literal("")).optional(),
  name: z.string().trim().min(1).max(120),
  body: z.string().trim().max(2000),
});

/**
 * "+ Template" and a template's edit dialog. The engine fills `{variable}`;
 * the design writes `[variable]`, so a known variable typed in brackets is
 * saved in braces, and a variable the engine does not know is refused
 * rather than posted as is.
 */
export async function saveTemplate(_prev: DialogResult, formData: FormData): Promise<DialogResult> {
  const current = await requireManager();
  const t = await getT();
  if (formData.get("intent") === "delete") return removeTemplate(formData);
  const parsed = templateSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: t("settingsV2.ann.errorTplName") };
  const input = parsed.data;
  const known = new Set<string>(TEMPLATE_VARIABLES);
  const body = input.body.replace(/\[(\w+)\]/g, (whole, key: string) =>
    known.has(key) ? `{${key}}` : whole,
  );
  if (!body) return { ok: false, error: t("settingsV2.ann.errorBody") };
  const unknown = [...body.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).find((k) => !known.has(k));
  if (unknown)
    return {
      ok: false,
      error: t("settingsV2.ann.errorVariable", {
        name: `{${unknown}}`,
        vars: TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(", "),
      }),
    };

  const out = await withTenant(current.tenant.id, async (tx) => {
    const rows = await tx
      .select({ id: announcementTemplates.id, name: announcementTemplates.name })
      .from(announcementTemplates)
      .where(eq(announcementTemplates.tenantId, current.tenant.id));
    const row = input.id ? rows.find((r) => r.id === input.id) : undefined;
    if (input.id && !row) return "invalid" as const;
    if (rows.some((r) => r.id !== row?.id && r.name.toLowerCase() === input.name.toLowerCase()))
      return "duplicate" as const;
    if (row) {
      await tx
        .update(announcementTemplates)
        .set({ name: input.name, body, updatedAt: new Date() })
        .where(eq(announcementTemplates.id, row.id));
      await recordAudit(tx, current, "config", "announcement_template.updated", {
        name: input.name,
      });
      return "saved" as const;
    }
    const [maxRow] = await tx
      .select({
        max: sql<number>`coalesce(max(${announcementTemplates.position}), -1)`.mapWith(Number),
      })
      .from(announcementTemplates)
      .where(eq(announcementTemplates.tenantId, current.tenant.id));
    await tx.insert(announcementTemplates).values({
      tenantId: current.tenant.id,
      name: input.name,
      body,
      position: (maxRow?.max ?? -1) + 1,
    });
    await recordAudit(tx, current, "config", "announcement_template.created", {
      name: input.name,
    });
    return "created" as const;
  });
  if (out === "invalid") return { ok: false, error: t("settingsV2.error.invalid") };
  if (out === "duplicate") return { ok: false, error: t("settingsV2.ann.errorTplDuplicate") };
  revalidatePath(PAGE);
  return {
    ok: true,
    message: out === "created" ? t("settingsV2.ann.tplAdded") : t("settingsV2.ann.tplSaved"),
  };
}

/** A template a rule still posts stays: deleting it would delete the rule with it (cascade). */
async function removeTemplate(formData: FormData): Promise<DialogResult> {
  const current = await requireManager();
  const t = await getT();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: t("settingsV2.error.invalid") };
  const out = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(announcementTemplates)
      .where(
        and(
          eq(announcementTemplates.tenantId, current.tenant.id),
          eq(announcementTemplates.id, id.data),
        ),
      );
    if (!row) return { removed: false, used: 0 };
    const [used] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(announcementRules)
      .where(
        and(
          eq(announcementRules.tenantId, current.tenant.id),
          eq(announcementRules.templateId, row.id),
        ),
      );
    if ((used?.n ?? 0) > 0) return { removed: false, used: used!.n };
    await tx.delete(announcementTemplates).where(eq(announcementTemplates.id, row.id));
    await recordAudit(tx, current, "config", "announcement_template.deleted", { name: row.name });
    return { removed: true, used: 0 };
  });
  if (!out.removed)
    return {
      ok: false,
      error: out.used
        ? t("settingsV2.ann.tplInUse", { count: out.used })
        : t("settingsV2.error.invalid"),
    };
  revalidatePath(PAGE);
  return { ok: true, message: t("settingsV2.ann.tplDeleted") };
}
