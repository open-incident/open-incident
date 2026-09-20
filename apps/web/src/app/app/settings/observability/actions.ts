"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { telemetrySettings, withTenant } from "@openincident/db";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";

const PAGE = "/app/settings/observability";

/**
 * Retention is in days and bounded, because the two ends are both a promise
 * the instance cannot keep. Zero would mean "delete on arrival", and a year of
 * spans on a single-node ClickHouse is a disk that fills up quietly and then
 * stops accepting anything — which is worse than a shorter window somebody
 * chose on purpose.
 */
const schema = z.object({
  retentionLogsDays: z.coerce.number().int().min(1).max(365),
  retentionTracesDays: z.coerce.number().int().min(1).max(365),
  retentionMetricsDays: z.coerce.number().int().min(1).max(365),
  cardinalityBudget: z.coerce.number().int().min(1_000).max(10_000_000).optional(),
  exceptionRegressions: z.enum(["on", "off"]).default("off"),
  exceptionRegressionSeverity: z.enum(["P1", "P2", "P3", "P4"]).default("P3"),
  scrubRules: z.string().max(4_000).optional(),
});

export async function saveObservabilitySettings(form: FormData): Promise<void> {
  const current = await requireManager();
  const parsed = schema.safeParse({
    retentionLogsDays: form.get("retentionLogsDays"),
    retentionTracesDays: form.get("retentionTracesDays"),
    retentionMetricsDays: form.get("retentionMetricsDays"),
    cardinalityBudget: form.get("cardinalityBudget") || undefined,
    exceptionRegressions: form.get("exceptionRegressions") === "on" ? "on" : "off",
    exceptionRegressionSeverity: form.get("exceptionRegressionSeverity") ?? "P3",
    scrubRules: form.get("scrubRules") ?? "",
  });
  if (!parsed.success) redirect(`${PAGE}?error=invalid`);
  const v = parsed.data;

  /*
   * A scrub rule that does not compile is refused here rather than dropped at
   * ingestion. The ingestion path does drop it — a bad rule must not stop a
   * workspace's telemetry — but that means a typo would silently protect
   * nothing, and somebody would believe their card numbers were being
   * redacted. The place to say so is the form that accepted it.
   */
  const rules = (v.scrubRules ?? "")
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean)
    .slice(0, 50);
  for (const rule of rules) {
    try {
      new RegExp(rule);
    } catch {
      redirect(`${PAGE}?error=regex&rule=${encodeURIComponent(rule.slice(0, 80))}`);
    }
  }

  const values = {
    retentionLogsDays: v.retentionLogsDays,
    retentionTracesDays: v.retentionTracesDays,
    retentionMetricsDays: v.retentionMetricsDays,
    cardinalityBudget: v.cardinalityBudget ?? null,
    exceptionRegressions: v.exceptionRegressions === "on",
    exceptionRegressionSeverity: v.exceptionRegressionSeverity,
    scrubRules: rules,
    updatedAt: new Date(),
  };

  await withTenant(current.tenant.id, async (tx) => {
    await tx
      .insert(telemetrySettings)
      .values({ tenantId: current.tenant.id, ...values })
      .onConflictDoUpdate({ target: telemetrySettings.tenantId, set: values });
    await recordAudit(tx, current, "config", "telemetry.settings.saved", {
      retentionLogsDays: values.retentionLogsDays,
      retentionTracesDays: values.retentionTracesDays,
      retentionMetricsDays: values.retentionMetricsDays,
      exceptionRegressions: values.exceptionRegressions,
      scrubRules: rules.length,
    });
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?saved=1`);
}
