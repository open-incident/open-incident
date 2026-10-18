"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { statusPages, withTenant, workspaces } from "@openincident/db";
import { refreshStatusSnapshot } from "@openincident/statuspages";
import { deleteObject, putObject, storageConfigured, tenantPrefix } from "@openincident/storage";
import { getT } from "@/i18n/server";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";
import { currentOrigin } from "@/lib/tenant";
import type { FormResult } from "@/components/settings/settings-form";

const TYPES: Record<string, string> = { "image/svg+xml": "svg", "image/png": "png" };
const MAX_BYTES = 512 * 1024;

function accept(file: unknown): file is File {
  return typeof File !== "undefined" && file instanceof File && file.size > 0;
}

/** The accent colour — the status page, emails and avatars follow at once. */
export async function saveBrand(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const current = await requireManager();
  const t = await getT();
  const accent = z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .or(z.literal(""))
    .safeParse(formData.get("accentColor") ?? "");
  if (!accent.success) return { ok: false, error: t("settingsV2.error.invalid") };
  const value = accent.data ? accent.data.toUpperCase() : undefined;
  if (value === current.workspace.branding.accentColor?.toUpperCase()) return { ok: true };
  await saveBranding(
    current,
    { ...current.workspace.branding, accentColor: value },
    {
      accentColor: value ?? null,
    },
  );
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Logo upload — the light variant, or the dark one (`variant=dark`). SVG or
 * PNG, 512 KB at most; the previous file goes when the new one is in place;
 * the status page snapshot follows.
 */
export async function uploadLogo(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const current = await requireManager();
  const t = await getT();
  if (!storageConfigured()) return { ok: false, error: t("settingsV2.brand.errorStorage") };
  const file = formData.get("logo");
  const field = formData.get("variant") === "dark" ? "logoDarkKey" : "logoKey";
  if (!accept(file) || !TYPES[file.type] || file.size > MAX_BYTES)
    return { ok: false, error: t("settingsV2.brand.errorType") };
  const tenantId = current.tenant.id;
  const branding = { ...current.workspace.branding };
  const stamp = Date.now().toString(36);
  const key = `${tenantPrefix(tenantId)}brand/${field === "logoKey" ? "logo-light" : "logo-dark"}-${stamp}.${TYPES[file.type]}`;
  await putObject(key, new Uint8Array(await file.arrayBuffer()), file.type);
  const previous = branding[field];
  const other = branding[field === "logoKey" ? "logoDarkKey" : "logoKey"];
  branding[field] = key;
  if (previous && previous !== key && previous !== other)
    await deleteObject(previous).catch(() => {});
  // A dark variant alone still needs the light one to exist: it is what every
  // light screen shows. Without it, the dark file serves both.
  if (field === "logoDarkKey" && !branding.logoKey) branding.logoKey = key;
  branding.logoUrl = `${await currentOrigin()}/brand/logo?v=${stamp}`;
  await saveBranding(current, branding, { logo: [field] });
  revalidatePath("/", "layout");
  return { ok: true, message: t("settingsV2.brand.uploaded") };
}

/** Back to the initial on the accent — the files go too. */
export async function removeLogo(_prev: FormResult, _formData: FormData): Promise<FormResult> {
  const current = await requireManager();
  const t = await getT();
  const branding = { ...current.workspace.branding };
  for (const key of new Set([branding.logoKey, branding.logoDarkKey])) {
    if (key && storageConfigured()) await deleteObject(key).catch(() => {});
  }
  delete branding.logoKey;
  delete branding.logoDarkKey;
  delete branding.logoUrl;
  await saveBranding(current, branding, { logo: null });
  revalidatePath("/", "layout");
  return { ok: true, message: t("settingsV2.brand.removed") };
}

async function saveBranding(
  current: Awaited<ReturnType<typeof requireManager>>,
  branding: (typeof workspaces.$inferSelect)["branding"],
  audit: Record<string, unknown>,
) {
  const tenantId = current.tenant.id;
  const pages = await withTenant(tenantId, async (tx) => {
    await tx
      .update(workspaces)
      .set({ branding, updatedAt: new Date() })
      .where(eq(workspaces.tenantId, tenantId));
    await recordAudit(
      tx,
      current,
      "config",
      "logo" in audit ? "workspace.logo" : "workspace.updated",
      audit,
    );
    return tx
      .select({ id: statusPages.id })
      .from(statusPages)
      .where(eq(statusPages.tenantId, tenantId));
  });
  for (const p of pages) await refreshStatusSnapshot(tenantId, p.id).catch(() => {});
}
