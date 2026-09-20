"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import {
  forgetRumApp,
  registerRumApp,
  rumApplications,
  telemetrySettings,
  withTenant,
} from "@openincident/db";
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
  dailySoftCapGb: z.coerce.number().int().min(1).max(10_000).optional(),
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
    dailySoftCapGb: form.get("dailySoftCapGb") || undefined,
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
    dailySoftCapGb: v.dailySoftCapGb ?? null,
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
      dailySoftCapGb: values.dailySoftCapGb,
      exceptionRegressions: values.exceptionRegressions,
      scrubRules: rules.length,
    });
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?saved=1`);
}

/**
 * Creating a RUM application.
 *
 * The origins are the whole of the security here, so they are required and
 * validated: an application with none accepts nothing, and one with a typo
 * accepts nothing either — which is the right way round, because the failure
 * is visible on the first page load rather than being a table quietly filling
 * with somebody else's traffic.
 */
const rumSchema = z.object({
  name: z.string().trim().min(1).max(120),
  origins: z.string().trim().min(1).max(2_000),
  sampleRate: z.coerce.number().min(0.01).max(1).default(1),
});

export async function createRumApplication(form: FormData): Promise<void> {
  const current = await requireManager();
  const parsed = rumSchema.safeParse({
    name: form.get("name"),
    origins: form.get("origins"),
    sampleRate: form.get("sampleRate") ?? 1,
  });
  if (!parsed.success) redirect(`${PAGE}?error=invalid`);
  const v = parsed.data;

  const origins: string[] = [];
  for (const line of v.origins.split(/[\n,]/)) {
    const text = line.trim().replace(/\/$/, "");
    if (!text) continue;
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      redirect(`${PAGE}?error=origin&rule=${encodeURIComponent(text.slice(0, 80))}`);
    }
    // An origin is a scheme and a host and nothing else. A path here would
    // never match what a browser sends, and the workspace would be left
    // wondering why nothing arrives.
    if (url!.pathname !== "/" || url!.search || url!.hash) {
      redirect(`${PAGE}?error=origin&rule=${encodeURIComponent(text.slice(0, 80))}`);
    }
    origins.push(url!.origin);
  }
  if (origins.length === 0) redirect(`${PAGE}?error=origin&rule=`);

  const id = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .insert(rumApplications)
      .values({
        tenantId: current.tenant.id,
        name: v.name,
        allowedOrigins: origins,
        sampleRate: v.sampleRate,
        createdByMemberId: current.member.id,
      })
      .returning({ id: rumApplications.id });
    await recordAudit(tx, current, "config", "rum.application.created", {
      name: v.name,
      origins: origins.length,
    });
    return row!.id;
  });
  // The lookup is written outside the tenant transaction, like every other
  // pre-tenant projection: the row it points at exists by now.
  await registerRumApp({
    appId: id,
    tenantId: current.tenant.id,
    allowedOrigins: origins,
    sampleRate: v.sampleRate,
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?created=${id}`);
}

export async function deleteRumApplication(form: FormData): Promise<void> {
  const current = await requireManager();
  const id = z.string().uuid().parse(form.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .delete(rumApplications)
      .where(and(eq(rumApplications.tenantId, current.tenant.id), eq(rumApplications.id, id)))
      .returning({ name: rumApplications.name });
    if (row)
      await recordAudit(tx, current, "config", "rum.application.deleted", { name: row.name });
  });
  // The lookup goes last: a page still holding the id stops being accepted the
  // moment the row is gone, and an orphan lookup would keep accepting it.
  await forgetRumApp(id);
  revalidatePath(PAGE);
  redirect(PAGE);
}
