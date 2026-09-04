"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@openincident/db";
import { recordAudit } from "@/lib/audit";
import { generatePayDraft, publishPayReport, savePayRules } from "@/lib/pay";
import { requireManager } from "@/lib/session";

const PAGE = "/app/insights?tab=pay";
const money = z.coerce.number().min(0).max(10_000);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** The workspace's rules — euros in the form, cents in the row. */
export async function savePayRulesAction(formData: FormData) {
  const current = await requireManager();
  const parsed = z
    .object({
      currency: z
        .string()
        .trim()
        .regex(/^[A-Z]{3}$/),
      standby: money,
      night: money,
      weekend: money,
      holiday: money,
      nightStart: hhmm,
      nightEnd: hhmm,
      holidays: z.string().max(5000).default(""),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect(`${PAGE}&error=rules`);
  const d = parsed.data;
  const holidays = [
    ...new Set(
      d.holidays
        .split(/[\s,;]+/)
        .map((x) => x.trim())
        .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)),
    ),
  ].sort();
  await withTenant(current.tenant.id, async (tx) => {
    await savePayRules(tx, current.tenant.id, {
      currency: d.currency,
      standbyCents: Math.round(d.standby * 100),
      nightCents: Math.round(d.night * 100),
      weekendCents: Math.round(d.weekend * 100),
      holidayCents: Math.round(d.holiday * 100),
      nightStart: d.nightStart,
      nightEnd: d.nightEnd,
      holidays,
    });
    await recordAudit(tx, current, "config", "pay.rules_saved", {
      currency: d.currency,
      holidays: holidays.length,
    });
  });
  revalidatePath("/app/insights");
  redirect(`${PAGE}&saved=rules`);
}

export async function generatePayReportAction(formData: FormData) {
  const current = await requireManager();
  const period = z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .parse(formData.get("period"));
  const report = await generatePayDraft(current.tenant.id, period);
  if (!report) redirect(`${PAGE}&period=${period}&error=published`);
  await withTenant(current.tenant.id, (tx) =>
    recordAudit(tx, current, "config", "pay.report_generated", {
      period,
      rows: report.rows.length,
      totalCents: report.totalCents,
    }),
  );
  revalidatePath("/app/insights");
  redirect(`${PAGE}&period=${period}&saved=draft`);
}

export async function publishPayReportAction(formData: FormData) {
  const current = await requireManager();
  const period = z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .parse(formData.get("period"));
  const ok = await publishPayReport(current.tenant.id, period, current.member.id);
  if (ok)
    await withTenant(current.tenant.id, (tx) =>
      recordAudit(tx, current, "config", "pay.report_published", { period }),
    );
  revalidatePath("/app/insights");
  redirect(`${PAGE}&period=${period}${ok ? "&saved=published" : "&error=publish"}`);
}
