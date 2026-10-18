"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { statusPages, withTenant, workspaces } from "@openincident/db";
import { refreshStatusSnapshot } from "@openincident/statuspages";
import { deleteObject, putObject, storageConfigured, tenantPrefix } from "@openincident/storage";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";
import { currentOrigin } from "@/lib/tenant";

const PAGE = "/app/settings/general";
const TYPES: Record<string, string> = { "image/svg+xml": "svg", "image/png": "png" };
const MAX_BYTES = 512 * 1024;

function accept(file: unknown): file is File {
  return typeof File !== "undefined" && file instanceof File && file.size > 0;
}

/**
 * Logo upload — light variant, optional dark variant. SVG or PNG, 512 KB at
 * most; the previous file goes when the new one is in place; the status page
 * snapshot follows.
 */
export async function uploadLogo(formData: FormData) {
  const current = await requireManager();
  if (!storageConfigured()) redirect(`${PAGE}?error=storage`);
  const light = formData.get("logo");
  const dark = formData.get("logoDark");
  const files: Array<{ field: "logoKey" | "logoDarkKey"; file: File }> = [];
  if (accept(light)) files.push({ field: "logoKey", file: light });
  if (accept(dark)) files.push({ field: "logoDarkKey", file: dark });
  if (files.length === 0) redirect(`${PAGE}?error=nofile`);
  for (const { file } of files) {
    if (!TYPES[file.type] || file.size > MAX_BYTES) redirect(`${PAGE}?error=logotype`);
  }
  const tenantId = current.tenant.id;
  const branding = { ...current.workspace.branding };
  const stamp = Date.now().toString(36);
  for (const { field, file } of files) {
    const ext = TYPES[file.type]!;
    const key = `${tenantPrefix(tenantId)}brand/${field === "logoKey" ? "logo-light" : "logo-dark"}-${stamp}.${ext}`;
    await putObject(key, new Uint8Array(await file.arrayBuffer()), file.type);
    const previous = branding[field];
    branding[field] = key;
    if (previous && previous !== key) await deleteObject(previous).catch(() => {});
  }
  const origin = await currentOrigin();
  branding.logoUrl = `${origin}/brand/logo?v=${stamp}`;
  await saveBranding(current, branding, { logo: files.map((f) => f.field) });
  revalidatePath("/", "layout");
  redirect(`${PAGE}?saved=1`);
}

/** Back to the initial on the accent — the files go too. */
export async function removeLogo() {
  const current = await requireManager();
  const branding = { ...current.workspace.branding };
  for (const key of [branding.logoKey, branding.logoDarkKey]) {
    if (key && storageConfigured()) await deleteObject(key).catch(() => {});
  }
  delete branding.logoKey;
  delete branding.logoDarkKey;
  delete branding.logoUrl;
  await saveBranding(current, branding, { logo: null });
  revalidatePath("/", "layout");
  redirect(`${PAGE}?saved=1`);
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
    await recordAudit(tx, current, "config", "workspace.logo", audit);
    return tx
      .select({ id: statusPages.id })
      .from(statusPages)
      .where(eq(statusPages.tenantId, tenantId));
  });
  for (const p of pages) await refreshStatusSnapshot(tenantId, p.id).catch(() => {});
}
