"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { encryptSecret } from "@openincident/crypto";
import {
  apiKeys,
  forgetApiKeyLookup,
  registerApiKeyLookup,
  webhookEndpoints,
  withTenant,
  type ApiScope,
} from "@openincident/db";
import { isWebhookEvent, resendFailedDeliveries } from "@openincident/webhooks";
import { hashApiKey } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";

/**
 * Creates a key and returns its plaintext ONCE. The row stores the SHA-256
 * only; the directory lookup lets the key resolve its workspace on the next
 * request, whatever host it comes in on.
 */
export async function createApiKey(
  _prev: unknown,
  formData: FormData,
): Promise<{ key?: string; error?: string }> {
  const current = await requireManager();
  const name = z.string().trim().min(1).max(80).safeParse(formData.get("name"));
  if (!name.success) return { error: "name" };
  const scopes = formData
    .getAll("scopes")
    .map(String)
    .filter((s): s is ApiScope => ["read", "write", "incident:create"].includes(s));
  if (scopes.length === 0) return { error: "scopes" };
  const key = `oi_live_${randomBytes(16).toString("hex")}`;
  const keyHash = hashApiKey(key);
  await withTenant(current.tenant.id, async (tx) => {
    await tx.insert(apiKeys).values({
      tenantId: current.tenant.id,
      name: name.data,
      keyHash,
      prefix: key.slice(0, 12),
      lastFour: key.slice(-4),
      scopes,
      createdByMemberId: current.member.id,
    });
    await recordAudit(tx, current, "security", "api_key.created", {
      hint: `${key.slice(0, 12)}…${key.slice(-4)}`,
      scopes,
      name: name.data,
    });
  });
  await registerApiKeyLookup(keyHash, current.tenant.id);
  revalidatePath("/app/settings/api");
  return { key };
}

/** Revocation is immediate: the lookup row goes, so the very next request is a 401. */
export async function revokeApiKey(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  const hash = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.tenantId, current.tenant.id), eq(apiKeys.id, id)));
    if (!row || row.revokedAt) return null;
    await tx.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, row.id));
    await recordAudit(tx, current, "security", "api_key.revoked", {
      hint: `${row.prefix}…${row.lastFour}`,
      name: row.name,
    });
    return row.keyHash;
  });
  if (hash) await forgetApiKeyLookup(hash);
  revalidatePath("/app/settings/api");
}

/** Creates an endpoint and returns its signing secret ONCE; stored encrypted at rest. */
export async function createWebhook(
  _prev: unknown,
  formData: FormData,
): Promise<{ secret?: string; error?: string }> {
  const current = await requireManager();
  const url = z
    .string()
    .url()
    .max(500)
    .safeParse(String(formData.get("url") ?? "").trim());
  if (!url.success || !/^https?:\/\//.test(url.data)) return { error: "url" };
  const events = formData.getAll("events").map(String).filter(isWebhookEvent);
  if (events.length === 0) return { error: "events" };
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  await withTenant(current.tenant.id, async (tx) => {
    await tx.insert(webhookEndpoints).values({
      tenantId: current.tenant.id,
      url: url.data,
      encryptedSecret: encryptSecret(secret),
      events,
      createdByMemberId: current.member.id,
    });
    await recordAudit(tx, current, "config", "webhook.created", { url: url.data, events });
  });
  revalidatePath("/app/settings/api");
  return { secret };
}

export async function toggleWebhook(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.tenantId, current.tenant.id), eq(webhookEndpoints.id, id)));
    if (!row) return;
    const active = !(row.active && !row.disabledAt);
    await tx
      .update(webhookEndpoints)
      .set({ active, disabledAt: null, failingSince: active ? null : row.failingSince })
      .where(eq(webhookEndpoints.id, row.id));
    await recordAudit(tx, current, "config", active ? "webhook.enabled" : "webhook.disabled", {
      url: row.url,
    });
  });
  revalidatePath("/app/settings/api");
}

export async function deleteWebhook(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.tenantId, current.tenant.id), eq(webhookEndpoints.id, id)));
    if (!row) return;
    await tx.delete(webhookEndpoints).where(eq(webhookEndpoints.id, row.id));
    await recordAudit(tx, current, "config", "webhook.deleted", { url: row.url });
  });
  revalidatePath("/app/settings/api");
}

export async function resendWebhookFailures(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  await resendFailedDeliveries(current.tenant.id, id);
  revalidatePath("/app/settings/api");
}
