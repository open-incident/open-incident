"use server";

import { randomBytes } from "node:crypto";
import { STATUS_CODES } from "node:http";
import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { encryptSecret } from "@openincident/crypto";
import {
  apiKeys,
  forgetApiKeyLookup,
  registerApiKeyLookup,
  webhookDeliveries,
  webhookEndpoints,
  withTenant,
  type ApiResource,
  type ApiScope,
} from "@openincident/db";
import { deliverWebhookJob, resendFailedDeliveries } from "@openincident/webhooks";
import { getT } from "@/i18n/server";
import { hashApiKey } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";
import type { DialogResult } from "@/components/settings/dialog";
import { EVENT_CHOICES, isEndpointUrl } from "./shape";

const PAGE = "/app/settings/api";
const DAY = 86_400_000;

/** What a row button says back: the toast's sentence, good or bad. */
export type RowResult = { ok: boolean; message: string };

const SCOPE_RESOURCES: Record<string, ApiResource[] | null> = {
  incidents: ["incidents"],
  "incidents,monitors": ["incidents", "monitors"],
  services: ["services"],
  status_pages: ["status_pages"],
  all: null,
};

const EXPIRY_DAYS: Record<string, number | null> = { "30": 30, "90": 90, "365": 365, never: null };

/**
 * "New API key": a name, read or read & write, the part of the API it may
 * reach, and when it stops working. The plaintext is returned ONCE, into the
 * dialog's "shown once" panel; the row keeps its SHA-256 only, and the
 * directory lookup lets the key find its workspace on the next request.
 */
export async function createApiKey(_prev: DialogResult, formData: FormData): Promise<DialogResult> {
  const current = await requireManager();
  const t = await getT();
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(80),
      access: z.enum(["read", "write"]),
      scope: z.enum(["incidents", "incidents,monitors", "services", "status_pages", "all"]),
      expires: z.enum(["30", "90", "365", "never"]),
    })
    .safeParse({
      name: formData.get("name"),
      access: formData.get("access") ?? "read",
      scope: formData.get("scope") ?? "incidents",
      expires: formData.get("expires") ?? "90",
    });
  if (!parsed.success) {
    const nameMissing = !String(formData.get("name") ?? "").trim();
    return {
      ok: false,
      error: nameMissing ? t("settingsV2.error.name") : t("settingsV2.error.invalid"),
    };
  }
  const v = parsed.data;
  const scopes: ApiScope[] = v.access === "write" ? ["read", "write"] : ["read"];
  const resources = SCOPE_RESOURCES[v.scope] ?? null;
  const days = EXPIRY_DAYS[v.expires] ?? null;
  const expiresAt = days === null ? null : new Date(Date.now() + days * DAY);
  const key = `oi_live_${randomBytes(16).toString("hex")}`;
  const keyHash = hashApiKey(key);
  await withTenant(current.tenant.id, async (tx) => {
    await tx.insert(apiKeys).values({
      tenantId: current.tenant.id,
      name: v.name,
      keyHash,
      prefix: key.slice(0, 12),
      lastFour: key.slice(-4),
      scopes,
      resources,
      expiresAt,
      createdByMemberId: current.member.id,
    });
    await recordAudit(tx, current, "security", "api_key.created", {
      hint: `${key.slice(0, 12)}…${key.slice(-4)}`,
      scopes,
      name: v.name,
      resources,
      expiresAt: expiresAt?.toISOString() ?? null,
    });
  });
  await registerApiKeyLookup(keyHash, current.tenant.id);
  revalidatePath(PAGE);
  return {
    ok: true,
    secret: key,
    secretNote: t("settingsV2.api.keySecretNote"),
    secretDone: t("settingsV2.api.keySecretDone"),
  };
}

/** Revocation is immediate: the lookup row goes, so the very next request is a 401. */
export async function revokeApiKey(id: string): Promise<RowResult> {
  const current = await requireManager();
  const t = await getT();
  const keyId = z.string().uuid().parse(id);
  const row = await withTenant(current.tenant.id, async (tx) => {
    const [k] = await tx
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.tenantId, current.tenant.id), eq(apiKeys.id, keyId)));
    if (!k || k.revokedAt) return null;
    await tx.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, k.id));
    await recordAudit(tx, current, "security", "api_key.revoked", {
      hint: `${k.prefix}…${k.lastFour}`,
      name: k.name,
    });
    return k;
  });
  if (!row) return { ok: false, message: t("settingsV2.error.generic") };
  await forgetApiKeyLookup(row.keyHash);
  revalidatePath(PAGE);
  return { ok: true, message: t("settingsV2.api.revoked", { name: row.name }) };
}

/**
 * "New endpoint": an HTTPS address and the events it wants. Every payload is
 * signed; the signing secret is returned ONCE and kept encrypted at rest.
 */
export async function createWebhook(
  _prev: DialogResult,
  formData: FormData,
): Promise<DialogResult> {
  const current = await requireManager();
  const t = await getT();
  const url = String(formData.get("url") ?? "").trim();
  if (!isEndpointUrl(url, loopbackHttpAllowed()))
    return { ok: false, error: t("settingsV2.api.errorUrl") };
  const choice = EVENT_CHOICES.find((c) => c.key === String(formData.get("events") ?? ""));
  if (!choice) return { ok: false, error: t("settingsV2.error.invalid") };
  const events = [...choice.events];
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  await withTenant(current.tenant.id, async (tx) => {
    await tx.insert(webhookEndpoints).values({
      tenantId: current.tenant.id,
      url,
      encryptedSecret: encryptSecret(secret),
      events,
      createdByMemberId: current.member.id,
    });
    await recordAudit(tx, current, "config", "webhook.created", { url, events });
  });
  revalidatePath(PAGE);
  return {
    ok: true,
    secret,
    secretNote: t("settingsV2.api.hookSecretNote"),
    secretDone: t("settingsV2.api.keySecretDone"),
  };
}

/**
 * "Send test": one signed delivery, now, through the same code path as a
 * real event — logged with the others, and the endpoint's health follows
 * the answer. The toast says what the endpoint answered.
 */
export async function sendWebhookTest(id: string): Promise<RowResult> {
  const current = await requireManager();
  const t = await getT();
  const endpointId = z.string().uuid().parse(id);
  const endpoint = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(webhookEndpoints)
      .where(
        and(eq(webhookEndpoints.tenantId, current.tenant.id), eq(webhookEndpoints.id, endpointId)),
      );
    return row ?? null;
  });
  if (!endpoint) return { ok: false, message: t("settingsV2.error.generic") };
  if (!endpoint.active || endpoint.disabledAt)
    return { ok: false, message: t("settingsV2.api.testDisabled") };
  const payload = {
    event: "webhook.test",
    occurred_at: new Date().toISOString(),
    workspace: current.tenant.slug,
    test: true,
    message: `A test sent from Settings › API & webhooks by ${current.member.name}.`,
  };
  const result = await deliverWebhookJob({
    tenantId: current.tenant.id,
    endpointId,
    event: "webhook.test",
    payload,
  });
  const last = await withTenant(current.tenant.id, async (tx) => {
    const [d] = await tx
      .select({ latencyMs: webhookDeliveries.latencyMs, error: webhookDeliveries.error })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.tenantId, current.tenant.id),
          eq(webhookDeliveries.endpointId, endpointId),
          eq(webhookDeliveries.event, "webhook.test"),
        ),
      )
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(1);
    await recordAudit(tx, current, "config", "webhook.tested", {
      url: endpoint.url,
      status: result.httpStatus,
    });
    return d ?? null;
  });
  revalidatePath(PAGE);
  if (result.httpStatus === null)
    return {
      ok: false,
      message: t("settingsV2.api.testNoAnswer", {
        error: (last?.error ?? "").slice(0, 120) || t("settingsV2.api.noAnswer"),
      }),
    };
  if (result.ok)
    return {
      ok: true,
      message: t("settingsV2.api.testDelivered", {
        status: String(result.httpStatus),
        ms: last?.latencyMs ?? 0,
      }),
    };
  return {
    ok: false,
    message: t("settingsV2.api.testRefused", {
      status: `${result.httpStatus}${STATUS_CODES[result.httpStatus] ? ` ${STATUS_CODES[result.httpStatus]}` : ""}`,
    }),
  };
}

/** Disable or switch back on. Switching on clears the failing streak: the next delivery decides. */
export async function toggleWebhook(id: string): Promise<RowResult> {
  const current = await requireManager();
  const t = await getT();
  const endpointId = z.string().uuid().parse(id);
  const out = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(webhookEndpoints)
      .where(
        and(eq(webhookEndpoints.tenantId, current.tenant.id), eq(webhookEndpoints.id, endpointId)),
      );
    if (!row) return null;
    const active = !(row.active && !row.disabledAt);
    await tx
      .update(webhookEndpoints)
      .set({ active, disabledAt: null, failingSince: active ? null : row.failingSince })
      .where(eq(webhookEndpoints.id, row.id));
    await recordAudit(tx, current, "config", active ? "webhook.enabled" : "webhook.disabled", {
      url: row.url,
    });
    return active;
  });
  if (out === null) return { ok: false, message: t("settingsV2.error.generic") };
  revalidatePath(PAGE);
  return {
    ok: true,
    message: out ? t("settingsV2.api.hookEnabled") : t("settingsV2.api.hookDisabled"),
  };
}

export async function deleteWebhook(id: string): Promise<RowResult> {
  const current = await requireManager();
  const t = await getT();
  const endpointId = z.string().uuid().parse(id);
  const done = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(webhookEndpoints)
      .where(
        and(eq(webhookEndpoints.tenantId, current.tenant.id), eq(webhookEndpoints.id, endpointId)),
      );
    if (!row) return false;
    await tx.delete(webhookEndpoints).where(eq(webhookEndpoints.id, row.id));
    await recordAudit(tx, current, "config", "webhook.deleted", { url: row.url });
    return true;
  });
  if (!done) return { ok: false, message: t("settingsV2.error.generic") };
  revalidatePath(PAGE);
  return { ok: true, message: t("settingsV2.api.hookDeleted") };
}

/** Re-delivers the endpoint's last failed deliveries, queued like the originals. */
export async function resendWebhookFailures(id: string): Promise<RowResult> {
  const current = await requireManager();
  const t = await getT();
  const endpointId = z.string().uuid().parse(id);
  const n = await resendFailedDeliveries(current.tenant.id, endpointId);
  revalidatePath(PAGE);
  return { ok: true, message: t("settingsV2.api.resent", { count: n }) };
}

/**
 * A webhook may point at plain http on this machine only in development, or
 * when the instance says so — the smoke suite's receiver lives on 127.0.0.1
 * and runs against a production build. Anywhere else it is an SSRF door.
 */
function loopbackHttpAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.WEBHOOK_ALLOW_LOOPBACK_HTTP === "1";
}
