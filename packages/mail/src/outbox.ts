/**
 * Outbox: every workspace email goes through here.
 *
 * Each send is logged in `app.mail_deliveries` BEFORE the attempt, then queued
 * on BullMQ (`mail-send`) so it can be retried on failure. If Redis is
 * unavailable, the send is attempted immediately rather than lost.
 *
 * Statuses are honest: `queued` → `sent` (the transport accepted it) or
 * `failed`. A delivery refused because the workspace is suspended is `handled`
 * — processed, deliberately not sent — never "sent". The predecessor of this
 * module reported "sent" for both, and an idempotence lock ended up sitting on
 * an email nobody had received.
 */
import { eq } from "drizzle-orm";
import { getTenantById, mailDeliveries, withTenant } from "@openincident/db";
import { resolveMailConfig } from "./settings";
import type { MailKind } from "./types";

export const MAIL_SEND_QUEUE = "mail-send";
export const MAIL_BULK_QUEUE = "mail-bulk";

/**
 * Two deadlines, so two queues.
 *
 * A reset link, an invitation and a verification are read by someone who is
 * waiting in front of a screen; the 128th message of a status page fan-out is
 * read tomorrow morning. Measured on a relay 50 ms away, four publications of
 * 128 subscribers left an invitation queued for a median of twenty seconds and
 * a worst case of thirty — and 98 % of that was spent waiting, not sending.
 * One queue cannot tell the two apart, so there are two.
 *
 * `transactional` is the default on purpose: a caller who has not thought about
 * it is far more often sending someone a link than fanning out to a mailing
 * list, and the cost of getting it wrong that way round is only that a bulk
 * send keeps its old urgency.
 */
export type MailClass = "transactional" | "bulk";

export function mailQueueForClass(cls: MailClass): string {
  return cls === "bulk" ? MAIL_BULK_QUEUE : MAIL_SEND_QUEUE;
}

export type SendTenantEmailInput = {
  tenantId: string;
  to: string;
  subject: string;
  text: string;
  /** Rich part. The text above stays mandatory — see OutgoingEmail. */
  html?: string;
  kind?: MailKind;
  headers?: Record<string, string>;
  /** Object the email is about — an incident, an escalation — for the log. */
  ref?: string;
  /** Which deadline this send has. See MailClass — transactional by default. */
  class?: MailClass;
  /** Bypasses the queue and sends right away (configuration test, invitation). */
  immediate?: boolean;
};

export type SendTenantEmailResult = {
  deliveryId: string;
  queued: boolean;
  delivered: boolean;
  messageId?: string;
  error?: string;
};

/**
 * Queue job. The body travels IN the job: the worker is a different process
 * from the web application, it shares no memory with it. The body is never
 * written to the database — it only lives for the duration of the job.
 */
export type MailSendJob = {
  tenantId: string;
  deliveryId: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
};

/**
 * One Redis connection for the process, opened on the first send and kept —
 * the same thing the escalation engine and the notifier do.
 *
 * It used to be one connection per email, closed straight after. A fan-out of
 * 128 subscribers therefore opened and closed 128 TCP connections from inside
 * the publishing request, which on a local Redis cost 4–5 ms a message and on a
 * managed Redis costs a full handshake each time. The promise, not the queue,
 * is what is cached: two sends racing on the first message would otherwise
 * open two connections and leak one.
 */
const queues = new Map<string, Promise<import("bullmq").Queue | null>>();

function queueFor(name: string): Promise<import("bullmq").Queue | null> {
  const existing = queues.get(name);
  if (existing) return existing;
  const opening = (async () => {
    const url = process.env.REDIS_URL;
    if (!url) return null;
    // Lazy import: nothing that never sends an email pays for bullmq.
    const [{ Queue }, { default: IORedis }] = await Promise.all([
      import("bullmq"),
      import("ioredis"),
    ]);
    return new Queue(name, {
      connection: new IORedis(url, { maxRetriesPerRequest: null }),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 15_000 },
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    });
  })().catch((err) => {
    console.error("[mail] could not reach Redis:", err);
    queues.delete(name);
    return null;
  });
  queues.set(name, opening);
  return opening;
}

async function enqueue(job: MailSendJob, cls: MailClass): Promise<boolean> {
  try {
    const queue = await queueFor(mailQueueForClass(cls));
    if (!queue) return false;
    await queue.add("send", job);
    return true;
  } catch (err) {
    console.error("[mail] could not enqueue, sending directly:", err);
    return false;
  }
}

/**
 * Sends (or queues) an email for a workspace. Always returns the log
 * identifier: the caller can display the state without waiting for the send.
 */
export async function sendTenantEmail(input: SendTenantEmailInput): Promise<SendTenantEmailResult> {
  const config = resolveMailConfig();

  const delivery = await withTenant(input.tenantId, async (tx) => {
    const [row] = await tx
      .insert(mailDeliveries)
      .values({
        tenantId: input.tenantId,
        toAddress: input.to,
        subject: input.subject,
        kind: input.kind ?? "other",
        provider: config.provider,
        status: "queued",
        ref: input.ref ?? null,
      })
      .returning({ id: mailDeliveries.id });
    return row!;
  });

  const job: MailSendJob = {
    tenantId: input.tenantId,
    deliveryId: delivery.id,
    text: input.text,
    html: input.html,
    headers: input.headers,
  };
  if (!input.immediate && (await enqueue(job, input.class ?? "transactional"))) {
    return { deliveryId: delivery.id, queued: true, delivered: false };
  }

  const result = await deliverEmail(job);
  return { deliveryId: delivery.id, queued: false, ...result };
}

/**
 * Performs the send of a logged delivery. Called directly or by the worker.
 * `delivered` is what the caller (and BullMQ) act on: false with an `error`
 * means retry; `handled` means the row was closed on purpose and must not be
 * retried.
 */
export async function deliverEmail(
  job: MailSendJob,
): Promise<{ delivered: boolean; handled?: boolean; messageId?: string; error?: string }> {
  const tenant = await getTenantById(job.tenantId);
  if (!tenant) return { delivered: false, handled: true, error: "tenant_missing" };

  const delivery = await withTenant(job.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(mailDeliveries)
      .where(eq(mailDeliveries.id, job.deliveryId));
    return row ?? null;
  });
  if (!delivery) return { delivered: false, handled: true, error: "delivery_missing" };

  // Suspended workspace: outbound is cut off. `admin` is the exception, and it
  // has to be: the email that tells the owner their workspace is suspended is
  // the only way they learn it.
  if (tenant.status !== "active" && tenant.status !== "trial" && delivery.kind !== "admin") {
    await withTenant(job.tenantId, (tx) =>
      tx
        .update(mailDeliveries)
        .set({ status: "handled", error: "tenant_suspended" })
        .where(eq(mailDeliveries.id, job.deliveryId)),
    );
    return { delivered: false, handled: true, error: "tenant_suspended" };
  }

  const config = resolveMailConfig();
  try {
    const { messageId } = await config.transport.send({
      from: config.from,
      to: delivery.toAddress,
      subject: delivery.subject,
      text: job.text,
      html: job.html,
      headers: job.headers,
    });
    await withTenant(job.tenantId, (tx) =>
      tx
        .update(mailDeliveries)
        .set({
          status: "sent",
          provider: config.provider,
          providerMessageId: messageId ?? null,
          attempts: delivery.attempts + 1,
          sentAt: new Date(),
          error: null,
        })
        .where(eq(mailDeliveries.id, job.deliveryId)),
    );
    return { delivered: true, messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await withTenant(job.tenantId, (tx) =>
      tx
        .update(mailDeliveries)
        .set({
          status: "failed",
          provider: config.provider,
          attempts: delivery.attempts + 1,
          error: message.slice(0, 1000),
        })
        .where(eq(mailDeliveries.id, job.deliveryId)),
    );
    console.error(`[mail] send failed (${job.deliveryId}):`, message);
    return { delivered: false, error: message };
  }
}
