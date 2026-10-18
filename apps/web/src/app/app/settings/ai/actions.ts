"use server";

/**
 * Settings › Atlas — every control acts at once and says so in one line (the
 * design's toasts), except the AI governance form at the bottom, which keeps
 * its single save. Owners and admins only (or a role holding the platform
 * settings); every change is an audit line under atlas.* or ai.settings.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { aiSettings, services, withTenant, type AiCapability } from "@openincident/db";
import { AI_CAPABILITIES, DEFAULT_AI_SETTINGS, getAiSettings } from "@openincident/ai";
import { atlas } from "@openincident/investigations";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";
import { getT } from "@/i18n/server";
import {
  AtlasRefusal,
  configureAction,
  rotateExecutorSecret,
  setActionEnabled,
  setBudget,
  setGuardrail,
  setKillSwitch,
  setServiceCap,
  startBacktest,
  type AtlasActor,
} from "@/lib/atlas/control";
import type { DialogResult } from "@/components/settings/dialog";

const PAGE = "/app/settings/ai";

export type AtlasSettingsResult = { ok: boolean; message: string };

async function manager() {
  const current = await requireManager();
  const by: AtlasActor = { memberId: current.member.id, label: current.member.name };
  return { current, by, tenantId: current.tenant.id };
}

async function refused(err: unknown): Promise<AtlasSettingsResult> {
  const t = await getT();
  if (err instanceof AtlasRefusal)
    return { ok: false, message: t("atlas.set.refused", { reason: err.message }) };
  console.error("[settings/atlas]", err);
  throw err;
}

/** Stop Atlas everywhere / let it act again. */
export async function toggleKillSwitch(on: boolean): Promise<AtlasSettingsResult> {
  const { by, tenantId } = await manager();
  const t = await getT();
  await setKillSwitch(tenantId, on, by);
  revalidatePath("/app", "layout");
  return { ok: true, message: on ? t("atlas.set.ks.toastStop") : t("atlas.set.ks.toastResume") };
}

/** The cap select of a service: "none", or 0–3. */
export async function changeCap(serviceId: string, value: string): Promise<AtlasSettingsResult> {
  const { by, tenantId } = await manager();
  const t = await getT();
  const id = z.string().uuid().parse(serviceId);
  const cap =
    value === "none" ? null : (z.coerce.number().int().min(0).max(3).parse(value) as 0 | 1 | 2 | 3);
  const [svc] = await withTenant(tenantId, (tx) =>
    tx.select({ key: services.key }).from(services).where(eq(services.id, id)),
  );
  if (!svc) return { ok: false, message: t("atlas.set.refused", { reason: "not found" }) };
  await setServiceCap(tenantId, id, cap, by);
  revalidatePath(PAGE);
  return {
    ok: true,
    message: t("atlas.set.cap.toast", {
      service: svc.key,
      cap: t(cap === null ? "atlas.set.cap.none" : (`atlas.set.cap.${cap}` as "atlas.set.cap.0")),
    }),
  };
}

/** One allowed action on or off. */
export async function toggleAction(
  key: string,
  on: boolean,
  label: string,
): Promise<AtlasSettingsResult> {
  const { by, tenantId } = await manager();
  const t = await getT();
  try {
    await setActionEnabled(tenantId, z.string().min(1).max(60).parse(key), on, by);
  } catch (err) {
    if (err instanceof AtlasRefusal && err.message === "irreversible")
      return { ok: false, message: t("atlas.set.actions.irreversibleToast") };
    if (err instanceof AtlasRefusal && err.message === "unavailable")
      return { ok: false, message: t("atlas.set.actions.connectFirst", { action: label }) };
    return refused(err);
  }
  revalidatePath(PAGE);
  return {
    ok: true,
    message: on
      ? t("atlas.set.actions.added", { action: label })
      : t("atlas.set.actions.removed", { action: label }),
  };
}

const url = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === "" ? null : v))
  .refine((v) => v === null || /^https?:\/\/\S+$/i.test(v));

/** The endpoint dialog of an action. */
export async function saveActionEndpoints(
  _prev: DialogResult,
  formData: FormData,
): Promise<DialogResult> {
  const { by, tenantId } = await manager();
  const t = await getT();
  const key = String(formData.get("key") ?? "");
  const label = String(formData.get("label") ?? key);
  const parsed = z.object({ doUrl: url, undoUrl: url, verifyUrl: url }).safeParse({
    doUrl: String(formData.get("doUrl") ?? ""),
    undoUrl: String(formData.get("undoUrl") ?? ""),
    verifyUrl: String(formData.get("verifyUrl") ?? ""),
  });
  if (!parsed.success) return { ok: false, error: t("atlas.set.endpoint.invalid") };
  try {
    await configureAction(tenantId, key, parsed.data, by);
  } catch (err) {
    const r = await refused(err);
    return { ok: false, error: r.message };
  }
  revalidatePath(PAGE);
  return { ok: true, message: t("atlas.set.endpoint.saved", { action: label }) };
}

/** A new signing secret, shown once in the dialog. */
export async function rotateSecret(
  _prev: DialogResult,
  _formData: FormData,
): Promise<DialogResult> {
  const { by, tenantId } = await manager();
  const t = await getT();
  const secret = await rotateExecutorSecret(tenantId, by);
  return {
    ok: true,
    secret,
    secretNote: t("atlas.set.secret.note"),
    secretDone: t("atlas.set.secret.done"),
  };
}

/** One guardrail of "Always ask a person first". */
export async function toggleGuardrail(
  key: string,
  on: boolean,
  label: string,
): Promise<AtlasSettingsResult> {
  const { by, tenantId } = await manager();
  const t = await getT();
  const k = z
    .enum(["sev1", "securityAndPrivate", "firstUseOnService", "changeFreeze", "publicStatusPage"])
    .parse(key);
  try {
    await setGuardrail(tenantId, k, on, by);
  } catch (err) {
    return refused(err);
  }
  revalidatePath(PAGE);
  return {
    ok: true,
    message: on
      ? t("atlas.set.limit.onToast", { guardrail: label })
      : t("atlas.set.limit.offToast", { guardrail: label }),
  };
}

/** Run the 90-day backtest. */
export async function runBacktest(): Promise<AtlasSettingsResult> {
  const { by, tenantId } = await manager();
  const t = await getT();
  try {
    const candidates = await atlas.backtestCandidates(tenantId, 90);
    if (candidates.length === 0) return { ok: false, message: t("atlas.set.bt.nothing") };
    const r = await startBacktest(tenantId, by);
    revalidatePath(PAGE);
    // Two model calls per incident, about twenty seconds each on a hosted model.
    const minutes = Math.max(1, Math.round((r.incidents * 20) / 60));
    return {
      ok: true,
      message:
        r.estimateEur === null
          ? t("atlas.set.bt.startedNoEstimate", { count: r.incidents })
          : t("atlas.set.bt.started", {
              count: r.incidents,
              minutes,
              eur: `${t.fmt.decimal(r.estimateEur, r.estimateEur >= 10 ? 0 : 2)} €`,
            }),
    };
  } catch (err) {
    if (err instanceof AtlasRefusal) return { ok: false, message: t("atlas.set.bt.unavailable") };
    throw err;
  }
}

/** The monthly budget and the cap per run; empty means no limit. */
export async function saveBudget(month: string, perRun: string): Promise<AtlasSettingsResult> {
  const { by, tenantId } = await manager();
  const t = await getT();
  const amount = (v: string) => {
    const s = v.trim().replace(",", ".");
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  const m = amount(month);
  const p = amount(perRun);
  if (Number.isNaN(m) || Number.isNaN(p))
    return { ok: false, message: t("atlas.set.budget.invalid") };
  try {
    await setBudget(tenantId, { monthEur: m, perRunEur: p }, by);
  } catch (err) {
    return refused(err);
  }
  revalidatePath(PAGE);
  return { ok: true, message: t("atlas.set.budget.saved") };
}

/** The AI governance form: master switch, capabilities, sources, private opt-in, provider label. */
export async function saveAiSettings(formData: FormData) {
  const current = await requireManager();
  const capabilities: Partial<Record<AiCapability, boolean>> = {};
  for (const cap of AI_CAPABILITIES) capabilities[cap] = formData.get(`cap_${cap}`) === "on";
  const sources = {
    services: true,
    incidents: formData.get("src_incidents") === "on",
    changeEvents: formData.get("src_changeEvents") === "on",
    docs: formData.get("src_docs") === "on",
    telemetry: formData.get("src_telemetry") === "on",
  };
  const values = {
    enabled: formData.get("enabled") === "on",
    capabilities,
    sources,
    privateOptIn: formData.get("privateOptIn") === "on",
    provider: String(formData.get("provider") ?? "") || null,
    updatedAt: new Date(),
  };
  await withTenant(current.tenant.id, async (tx) => {
    await getAiSettings(tx, current.tenant.id);
    const rows = await tx
      .select({ id: aiSettings.id })
      .from(aiSettings)
      .where(eq(aiSettings.tenantId, current.tenant.id));
    if (rows[0]) await tx.update(aiSettings).set(values).where(eq(aiSettings.id, rows[0].id));
    else
      await tx
        .insert(aiSettings)
        .values({ tenantId: current.tenant.id, ...DEFAULT_AI_SETTINGS, ...values });
    await recordAudit(tx, current, "config", "ai.settings", {
      enabled: values.enabled,
      off: AI_CAPABILITIES.filter((c) => capabilities[c] === false),
      privateOptIn: values.privateOptIn,
    });
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?saved=1`);
}
