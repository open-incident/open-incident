"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import {
  forgetRumApp,
  registerRumApp,
  rumApplications,
  telemetrySettings,
  withTenant,
} from "@openincident/db";
import { getT } from "@/i18n/server";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";
import { currentOrigin } from "@/lib/tenant";
import type { FormResult } from "@/components/settings/settings-form";
import type { DialogResult } from "@/components/settings/dialog";
import { REDACTIONS, rumSnippet, withRedactions } from "./redaction";

const PAGE = "/app/settings/observability";

export type RowResult = { ok: boolean; message: string };

/**
 * Retention is in days and bounded, because the two ends are both a promise
 * the instance cannot keep: zero would mean "delete on arrival", and more
 * than thirteen months on a single-node column store is a disk that fills up
 * quietly. A change applies to what arrives next — each row carries the
 * expiry it was written with.
 */
const schema = z.object({
  retentionLogsDays: z.coerce.number().int().min(1).max(400),
  retentionTracesDays: z.coerce.number().int().min(1).max(400),
  retentionMetricsDays: z.coerce.number().int().min(1).max(400),
  exceptionRegressionSeverity: z.enum(["P1", "P2", "P3", "P4"]),
});

/**
 * The screen's one save: retention, redaction, the exception rule.
 *
 * The redaction switches are named sets of patterns kept in the workspace's
 * scrub rules — the list the ingestion service already applies to every log
 * line, span attribute and exception before anything is written. A rule the
 * workspace added by hand is kept as it is.
 */
export async function saveTelemetry(_prev: FormResult, form: FormData): Promise<FormResult> {
  const current = await requireManager();
  const t = await getT();
  const parsed = schema.safeParse({
    retentionLogsDays: form.get("retentionLogsDays"),
    retentionTracesDays: form.get("retentionTracesDays"),
    retentionMetricsDays: form.get("retentionMetricsDays"),
    exceptionRegressionSeverity: form.get("exceptionRegressionSeverity") ?? "P3",
  });
  if (!parsed.success) return { ok: false, error: t("settingsV2.error.invalid") };
  const v = parsed.data;
  const on = new Set(
    REDACTIONS.filter((r) => r.fixed || form.get(`redact.${r.key}`) === "on").map((r) => r.key),
  );

  const values = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select({ scrubRules: telemetrySettings.scrubRules })
      .from(telemetrySettings)
      .where(eq(telemetrySettings.tenantId, current.tenant.id));
    const scrubRules = withRedactions(row?.scrubRules ?? [], on);
    const set = {
      retentionLogsDays: v.retentionLogsDays,
      retentionTracesDays: v.retentionTracesDays,
      retentionMetricsDays: v.retentionMetricsDays,
      exceptionRegressions: form.get("exceptionRegressions") === "on",
      exceptionRegressionSeverity: v.exceptionRegressionSeverity,
      scrubRules,
      updatedAt: new Date(),
    };
    await tx
      .insert(telemetrySettings)
      .values({ tenantId: current.tenant.id, ...set })
      .onConflictDoUpdate({ target: telemetrySettings.tenantId, set });
    await recordAudit(tx, current, "config", "telemetry.settings.saved", {
      retentionLogsDays: set.retentionLogsDays,
      retentionTracesDays: set.retentionTracesDays,
      retentionMetricsDays: set.retentionMetricsDays,
      exceptionRegressions: set.exceptionRegressions,
      exceptionRegressionSeverity: set.exceptionRegressionSeverity,
      redaction: [...on],
      scrubRules: scrubRules.length,
    });
    return set;
  });
  void values;
  revalidatePath(PAGE);
  return { ok: true };
}

/* ---------- Real user monitoring ---------- */

function parseOrigins(raw: string): string[] | null {
  const origins: string[] = [];
  for (const line of raw.split(/[\n,]/)) {
    const text = line.trim().replace(/\/$/, "");
    if (!text) continue;
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    // An origin is a scheme and a host and nothing else: a path would never
    // match what a browser sends.
    if (url.pathname !== "/" || url.search || url.hash) return null;
    origins.push(url.origin);
  }
  return origins.length ? origins : null;
}

/**
 * "+ Application": a browser application allowed to report. Its id is the
 * public key the page carries; only the origins listed may send with it.
 * The answer is the snippet to paste, shown in the dialog.
 */
export async function createRumApp(_prev: DialogResult, form: FormData): Promise<DialogResult> {
  const current = await requireManager();
  const t = await getT();
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(120),
      origins: z.string().trim().min(1).max(2_000),
      sampleRate: z.coerce.number().min(0.01).max(1),
    })
    .safeParse({
      name: form.get("name"),
      origins: form.get("origins"),
      sampleRate: form.get("sampleRate") ?? 1,
    });
  if (!parsed.success) return { ok: false, error: t("settingsV2.error.invalid") };
  const v = parsed.data;
  const origins = parseOrigins(v.origins);
  if (!origins) return { ok: false, error: t("settingsV2.tel.badOrigin") };
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
  // A new application never records: replay is switched on later, on purpose.
  await registerRumApp({
    appId: id,
    tenantId: current.tenant.id,
    allowedOrigins: origins,
    sampleRate: v.sampleRate,
    replayEnabled: false,
    replaySampleRate: 0.1,
    replayUnmask: [],
    mobileEnabled: false,
  });
  revalidatePath(PAGE);
  return {
    ok: true,
    secret: rumSnippet(id, await currentOrigin()),
    secretNote: t("settingsV2.tel.rumSecretNote"),
    secretDone: t("settingsV2.done"),
  };
}

/** An application's own switches: replay (with its rate and what it may show) and mobile. */
export async function saveRumApp(_prev: DialogResult, form: FormData): Promise<DialogResult> {
  const current = await requireManager();
  const t = await getT();
  const parsed = z
    .object({
      id: z.string().uuid(),
      sampleRate: z.coerce.number().min(0.01).max(1),
      replaySampleRate: z.coerce.number().min(0.01).max(1),
      replayUnmask: z.string().max(2_000),
      origins: z.string().trim().min(1).max(2_000),
    })
    .safeParse({
      id: form.get("id"),
      sampleRate: form.get("sampleRate") ?? 1,
      replaySampleRate: form.get("replaySampleRate") ?? 0.1,
      replayUnmask: form.get("replayUnmask") ?? "",
      origins: form.get("origins") ?? "",
    });
  if (!parsed.success) return { ok: false, error: t("settingsV2.error.invalid") };
  const v = parsed.data;
  const origins = parseOrigins(v.origins);
  if (!origins) return { ok: false, error: t("settingsV2.tel.badOrigin") };
  const unmask: string[] = [];
  for (const line of v.replayUnmask.split(/[\n,]/)) {
    const text = line.trim();
    if (!text) continue;
    // A brace means a pasted CSS rule rather than a selector: it would un-mask nothing.
    if (text.length > 200 || /[{}]/.test(text))
      return { ok: false, error: t("settingsV2.tel.badSelector", { rule: text.slice(0, 60) }) };
    unmask.push(text);
  }
  const values = {
    allowedOrigins: origins,
    sampleRate: v.sampleRate,
    replayEnabled: form.get("replayEnabled") === "on",
    mobileEnabled: form.get("mobileEnabled") === "on",
    replaySampleRate: v.replaySampleRate,
    replayUnmask: unmask.slice(0, 50),
    updatedAt: new Date(),
  };
  const app = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .update(rumApplications)
      .set(values)
      .where(and(eq(rumApplications.tenantId, current.tenant.id), eq(rumApplications.id, v.id)))
      .returning({ id: rumApplications.id, name: rumApplications.name });
    if (row)
      await recordAudit(tx, current, "config", "rum.application.changed", {
        name: row.name,
        replay: values.replayEnabled,
        mobile: values.mobileEnabled,
        sampleRate: values.replaySampleRate,
        unmask: values.replayUnmask.length,
      });
    return row;
  });
  if (!app) return { ok: false, error: t("settingsV2.error.generic") };
  await registerRumApp({
    appId: app.id,
    tenantId: current.tenant.id,
    allowedOrigins: values.allowedOrigins,
    sampleRate: values.sampleRate,
    replayEnabled: values.replayEnabled,
    replaySampleRate: values.replaySampleRate,
    replayUnmask: values.replayUnmask,
    mobileEnabled: values.mobileEnabled,
  });
  revalidatePath(PAGE);
  return { ok: true, message: t("settingsV2.tel.rumSaved", { name: app.name }) };
}

export async function deleteRumApp(id: string): Promise<RowResult> {
  const current = await requireManager();
  const t = await getT();
  const appId = z.string().uuid().parse(id);
  const name = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .delete(rumApplications)
      .where(and(eq(rumApplications.tenantId, current.tenant.id), eq(rumApplications.id, appId)))
      .returning({ name: rumApplications.name });
    if (row)
      await recordAudit(tx, current, "config", "rum.application.deleted", { name: row.name });
    return row?.name ?? null;
  });
  // The lookup goes last: a page still holding the id stops being accepted now.
  await forgetRumApp(appId);
  revalidatePath(PAGE);
  if (!name) return { ok: false, message: t("settingsV2.error.generic") };
  return { ok: true, message: t("settingsV2.tel.rumDeleted", { name }) };
}
