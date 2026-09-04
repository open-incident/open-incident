/**
 * Outbound webhooks — emitted at the source (the transition functions, the
 * point of passage of every channel), queued on BullMQ when Redis is there so
 * a failing endpoint gets retried, delivered inline when it is not, rather than
 * dropping the event. The dispatch never throws: a broken endpoint must not
 * fail the responder's gesture.
 */
import { createHmac } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { decryptSecret } from "@openincident/crypto";
import { webhookDeliveries, webhookEndpoints, withTenant } from "@openincident/db";
import type { WebhookEvent } from "./events";

export const WEBHOOK_QUEUE = "webhook-dispatch";

/** Queue job. The payload travels IN the job: the worker shares no memory with the web app. */
export type WebhookJob = {
  tenantId: string;
  endpointId: string;
  event: WebhookEvent | string;
  payload: Record<string, unknown>;
  /** Set on a manual resend of a failed delivery. */
  attempt?: number;
};

/** After this long failing without a single success, an endpoint is switched off. */
const DISABLE_AFTER_MS = 7 * 24 * 3600 * 1000;
const TIMEOUT_MS = 5000;

/** HMAC-SHA256 of the exact body bytes — what the receiver checks. */
export function signBody(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Performs one delivery: signed POST, log row, and the endpoint's health. */
export async function deliverWebhookJob(
  job: WebhookJob,
): Promise<{ httpStatus: number | null; ok: boolean }> {
  const endpoint = await withTenant(job.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(webhookEndpoints)
      .where(
        and(eq(webhookEndpoints.tenantId, job.tenantId), eq(webhookEndpoints.id, job.endpointId)),
      );
    return row ?? null;
  });
  // Deleted or switched off between enqueue and delivery: nothing to send, nothing to retry.
  if (!endpoint || !endpoint.active || endpoint.disabledAt) return { httpStatus: null, ok: true };
  const secret = decryptSecret(endpoint.encryptedSecret);
  if (!secret) {
    // An unreadable secret (key rotated, row imported by hand) is recorded as a
    // failure so the settings screen shows it — retrying would not help.
    await withTenant(job.tenantId, async (tx) => {
      await tx.insert(webhookDeliveries).values({
        tenantId: job.tenantId,
        endpointId: endpoint.id,
        event: job.event,
        payload: job.payload,
        httpStatus: null,
        latencyMs: 0,
        error: "Signing secret unreadable — recreate the endpoint",
        attempt: job.attempt ?? 1,
      });
      if (!endpoint.failingSince) {
        await tx
          .update(webhookEndpoints)
          .set({ failingSince: new Date() })
          .where(eq(webhookEndpoints.id, endpoint.id));
      }
    });
    return { httpStatus: null, ok: true };
  }

  const body = JSON.stringify(job.payload);
  const started = Date.now();
  let httpStatus: number | null = null;
  let error: string | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "open-incident-webhooks/1",
        "x-oi-event": job.event,
        "x-oi-signature": signBody(secret, body),
        "x-oi-timestamp": String(Math.floor(started / 1000)),
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    httpStatus = res.status;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const ok = httpStatus !== null && httpStatus >= 200 && httpStatus < 300;

  await withTenant(job.tenantId, async (tx) => {
    await tx.insert(webhookDeliveries).values({
      tenantId: job.tenantId,
      endpointId: endpoint.id,
      event: job.event,
      payload: job.payload,
      httpStatus,
      latencyMs: Date.now() - started,
      attempt: job.attempt ?? 1,
      error: error ?? (ok ? null : httpStatus !== null ? `HTTP ${httpStatus}` : null),
    });
    if (ok) {
      if (endpoint.failingSince)
        await tx
          .update(webhookEndpoints)
          .set({ failingSince: null })
          .where(eq(webhookEndpoints.id, endpoint.id));
    } else {
      const since = endpoint.failingSince ?? new Date();
      const tooLong = Date.now() - since.getTime() >= DISABLE_AFTER_MS;
      await tx
        .update(webhookEndpoints)
        .set({ failingSince: since, ...(tooLong ? { active: false, disabledAt: new Date() } : {}) })
        .where(eq(webhookEndpoints.id, endpoint.id));
    }
  });
  return { httpStatus, ok };
}

async function enqueue(job: WebhookJob): Promise<boolean> {
  const url = process.env.REDIS_URL;
  if (!url) return false;
  try {
    const [{ Queue }, { default: IORedis }] = await Promise.all([
      import("bullmq"),
      import("ioredis"),
    ]);
    const connection = new IORedis(url, { maxRetriesPerRequest: null });
    const queue = new Queue(WEBHOOK_QUEUE, { connection });
    await queue.add("deliver", job, {
      attempts: 4,
      backoff: { type: "exponential", delay: 20_000 },
      removeOnComplete: 500,
      removeOnFail: 1000,
    });
    await queue.close();
    await connection.quit();
    return true;
  } catch (err) {
    console.error("[webhooks] could not enqueue, delivering inline:", err);
    return false;
  }
}

/**
 * Emits one event to every endpoint of the workspace subscribed to it. The
 * envelope is built once, so every subscriber signs identical bytes.
 */
export async function dispatchWebhookEvent(
  tenantId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<number> {
  try {
    const endpoints = await withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(webhookEndpoints)
        .where(
          and(
            eq(webhookEndpoints.tenantId, tenantId),
            eq(webhookEndpoints.active, true),
            isNull(webhookEndpoints.disabledAt),
          ),
        ),
    );
    const subscribed = endpoints.filter((e) => e.events.includes(event));
    if (subscribed.length === 0) return 0;
    const payload = { event, occurred_at: new Date().toISOString(), ...data };
    let sent = 0;
    for (const endpoint of subscribed) {
      const job: WebhookJob = { tenantId, endpointId: endpoint.id, event, payload };
      if (!(await enqueue(job))) await deliverWebhookJob(job);
      sent++;
    }
    return sent;
  } catch (err) {
    console.error(`[webhooks] dispatch of ${event} failed:`, err);
    return 0;
  }
}

/** Re-delivers the last failed deliveries of an endpoint (manual resend). */
export async function resendFailedDeliveries(
  tenantId: string,
  endpointId: string,
  limit = 20,
): Promise<number> {
  const failed = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(webhookDeliveries)
      .where(
        and(eq(webhookDeliveries.tenantId, tenantId), eq(webhookDeliveries.endpointId, endpointId)),
      )
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(limit),
  );
  const toResend = failed.filter((d) => d.httpStatus === null || d.httpStatus >= 300);
  let n = 0;
  for (const d of toResend) {
    const job: WebhookJob = {
      tenantId,
      endpointId,
      event: d.event,
      payload: d.payload,
      attempt: d.attempt + 1,
    };
    if (!(await enqueue(job))) await deliverWebhookJob(job);
    n++;
  }
  return n;
}
