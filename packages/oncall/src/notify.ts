/**
 * Notifications to responders — the outbox and the providers.
 *
 * Every send is a row written BEFORE the attempt, with honest statuses:
 * queued → sent | failed, then delivered / handled when we learn more. The
 * channels that wake people (SMS, voice, web push) need a provider configured
 * on the instance; without one the channel is unavailable, never faked.
 */
import { createHash, randomBytes } from "node:crypto";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { and, eq } from "drizzle-orm";
import {
  escalations,
  getTenantById,
  notificationDeliveries,
  notificationMethods,
  notificationRules,
  withTenant,
  type NotificationStep,
  type Tx,
} from "@openincident/db";
import { sendTenantEmail } from "@openincident/mail";
import { dmSlackUser, dmTeamsUser, slackConfigured, teamsConfigured } from "@openincident/chat";
import { NOTIFY_QUEUE } from "./queues";

export type NotifyChannel = "email" | "sms" | "voice" | "webpush" | "slack" | "teams";
export type Urgency = "high" | "low";

export const CHANNELS: NotifyChannel[] = ["email", "sms", "voice", "webpush", "slack", "teams"];

/** The channels this instance can actually use. Email always; the others need their provider. */
export function availableChannels(): NotifyChannel[] {
  const out: NotifyChannel[] = ["email"];
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM)
    out.push("sms", "voice");
  if (process.env.WEBPUSH_VAPID_PUBLIC_KEY && process.env.WEBPUSH_VAPID_PRIVATE_KEY)
    out.push("webpush");
  if (slackConfigured()) out.push("slack");
  if (teamsConfigured()) out.push("teams");
  return out;
}

export type NotifyJob = {
  tenantId: string;
  deliveryId: string;
  channel: NotifyChannel;
  /** The address: email, E.164 phone, or the push subscription as JSON. */
  target: string;
  subject: string;
  text: string;
  url?: string;
  ackToken?: string;
  escalationId?: string | null;
  /** The public origin of the workspace, for links and voice callbacks. */
  origin: string;
};

let queue: Queue | null = null;
function getQueue(): Queue | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!queue) {
    queue = new Queue(NOTIFY_QUEUE, {
      connection: new IORedis(url, { maxRetriesPerRequest: null, enableOfflineQueue: false }),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 15_000 },
        removeOnComplete: 500,
        removeOnFail: 500,
      },
    });
  }
  return queue;
}

export async function enqueueNotification(job: NotifyJob, delayMs: number): Promise<boolean> {
  const q = getQueue();
  if (!q) return false;
  try {
    await q.add("send", job, { delay: Math.max(1_500, delayMs), jobId: `${job.deliveryId}` });
    return true;
  } catch {
    return false;
  }
}

/** The default personal rule when a member set none — restricted to what is verified and available. */
export function defaultSteps(urgency: Urgency): NotificationStep[] {
  return urgency === "high"
    ? [
        { kind: "webpush", delayMinutes: 0 },
        { kind: "slack", delayMinutes: 0 },
        { kind: "teams", delayMinutes: 0 },
        { kind: "email", delayMinutes: 0 },
        { kind: "voice", delayMinutes: 1 },
        { kind: "sms", delayMinutes: 3 },
      ]
    : [
        { kind: "webpush", delayMinutes: 0 },
        { kind: "email", delayMinutes: 0 },
      ];
}

export function maskTarget(channel: NotifyChannel, value: string): string {
  if (channel === "webpush") return "web push";
  if (channel === "slack") return "Slack DM";
  if (channel === "teams") return "Teams DM";
  if (channel === "email") {
    const [u, d] = value.split("@");
    return `${(u ?? "").slice(0, 2)}…@${d ?? ""}`;
  }
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

export type NotifyMemberInput = {
  kind: "escalation" | "test" | "shift_reminder" | "cover_request";
  urgency: Urgency;
  subject: string;
  text: string;
  url?: string;
  escalationId?: string | null;
  alertId?: string | null;
  /** When true, every message carries a one-tap acknowledgement link. */
  ackable?: boolean;
  origin: string;
  now?: Date;
};

/**
 * Notifies one member following their personal rule for the urgency: one
 * delivery row per step, each queued with its delay. Returns the deliveries.
 */
export async function notifyMember(
  tx: Tx,
  tenantId: string,
  member: { id: string; name: string; email: string },
  input: NotifyMemberInput,
): Promise<Array<{ deliveryId: string; channel: NotifyChannel; delayMinutes: number }>> {
  const now = input.now ?? new Date();
  const methods = await tx
    .select()
    .from(notificationMethods)
    .where(
      and(eq(notificationMethods.memberId, member.id), eq(notificationMethods.tenantId, tenantId)),
    );
  const [rule] = await tx
    .select()
    .from(notificationRules)
    .where(
      and(eq(notificationRules.memberId, member.id), eq(notificationRules.urgency, input.urgency)),
    );
  const available = availableChannels();
  const verified = (kind: NotifyChannel) => methods.find((m) => m.kind === kind && m.verifiedAt);
  // The account email counts as a verified email method even before the member adds any.
  const targetFor = (kind: NotifyChannel): string | null => {
    const m = verified(kind);
    if (m) return m.value;
    return kind === "email" ? member.email : null;
  };
  const steps = (rule?.steps?.length ? rule.steps : defaultSteps(input.urgency)).filter(
    (s) => available.includes(s.kind) && targetFor(s.kind),
  );
  const chosen = steps.length > 0 ? steps : [{ kind: "email" as const, delayMinutes: 0 }];
  const out: Array<{ deliveryId: string; channel: NotifyChannel; delayMinutes: number }> = [];
  const jobs: Array<{ job: NotifyJob; delayMs: number }> = [];
  for (const step of chosen) {
    const target = targetFor(step.kind)!;
    const ackToken = input.ackable ? randomBytes(16).toString("hex") : null;
    const sendAfter = new Date(now.getTime() + step.delayMinutes * 60_000);
    const [row] = await tx
      .insert(notificationDeliveries)
      .values({
        tenantId,
        memberId: member.id,
        methodKind: step.kind,
        target: maskTarget(step.kind, target),
        kind: input.kind,
        urgency: input.urgency,
        escalationId: input.escalationId ?? null,
        alertId: input.alertId ?? null,
        status: "queued",
        ackToken,
        message: { subject: input.subject, text: input.text, url: input.url },
        sendAfter,
      })
      .returning({ id: notificationDeliveries.id });
    out.push({ deliveryId: row!.id, channel: step.kind, delayMinutes: step.delayMinutes });
    jobs.push({
      job: {
        tenantId,
        deliveryId: row!.id,
        channel: step.kind,
        target,
        subject: input.subject,
        text: input.text,
        url: input.url,
        ackToken: ackToken ?? undefined,
        escalationId: input.escalationId ?? null,
        origin: input.origin,
      },
      delayMs: step.delayMinutes * 60_000,
    });
  }
  // Enqueue after the rows exist. Without Redis the immediate steps go now; the
  // later ones wait for the worker's sweep, which re-reads them from the row.
  for (const { job, delayMs } of jobs) {
    const queued = await enqueueNotification(job, delayMs);
    if (!queued && delayMs === 0) setTimeout(() => void deliverNotification(job), 0);
  }
  return out;
}

/** Rebuilds a job from its row — the sweep's path when a queued job was lost. */
export async function jobFromDelivery(
  tenantId: string,
  deliveryId: string,
): Promise<NotifyJob | null> {
  return withTenant(tenantId, async (tx) => {
    const [d] = await tx
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, deliveryId));
    if (!d || d.status !== "queued") return null;
    let target: string | null = null;
    if (d.memberId) {
      const methods = await tx
        .select()
        .from(notificationMethods)
        .where(
          and(
            eq(notificationMethods.memberId, d.memberId),
            eq(notificationMethods.kind, d.methodKind),
          ),
        );
      target = methods.find((m) => m.verifiedAt)?.value ?? null;
      if (!target && d.methodKind === "email") {
        const { members } = await import("@openincident/db");
        const [m] = await tx
          .select({ email: members.email })
          .from(members)
          .where(eq(members.id, d.memberId));
        target = m?.email ?? null;
      }
    }
    if (!target) return null;
    const tenant = await getTenantById(tenantId);
    const origin = tenant ? tenantOrigin(tenant.slug, tenant.customDomain) : "";
    return {
      tenantId,
      deliveryId: d.id,
      channel: d.methodKind,
      target,
      subject: d.message.subject,
      text: d.message.text,
      url: d.message.url,
      ackToken: d.ackToken ?? undefined,
      escalationId: d.escalationId,
      origin,
    };
  });
}

/** The public origin of a workspace, from its slug and the instance's base domain. */
export function tenantOrigin(slug: string, customDomain?: string | null): string {
  if (customDomain) return `https://${customDomain}`;
  const base = process.env.BASE_DOMAIN ?? "localhost:3100";
  const proto = /^(localhost|127\.0\.0\.1)/.test(base) ? "http" : "https";
  return `${proto}://${slug}.${base}`;
}

/* ---------- Providers ---------- */

async function twilio(
  path: string,
  form: Record<string, string>,
): Promise<{ ok: boolean; ref?: string; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/${path}.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
  return res.ok
    ? { ok: true, ref: body.sid }
    : { ok: false, error: body.message ?? `HTTP ${res.status}` };
}

function escapeXml(s: string): string {
  return s.replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!,
  );
}

async function sendWebPush(
  subscription: string,
  payload: string,
): Promise<{ ok: boolean; error?: string; gone?: boolean }> {
  const webpush = await import("web-push");
  webpush.default.setVapidDetails(
    process.env.WEBPUSH_SUBJECT ?? "mailto:ops@example.com",
    process.env.WEBPUSH_VAPID_PUBLIC_KEY!,
    process.env.WEBPUSH_VAPID_PRIVATE_KEY!,
  );
  try {
    await webpush.default.sendNotification(JSON.parse(subscription), payload, {
      TTL: 300,
      urgency: "high",
    });
    return { ok: true };
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    return {
      ok: false,
      error: e.message ?? "push failed",
      gone: e.statusCode === 404 || e.statusCode === 410,
    };
  }
}

/**
 * Sends one notification and records the outcome on its row. If the escalation
 * it belongs to was acknowledged meanwhile, the row is marked handled and
 * nothing is sent — nobody gets paged for a solved problem.
 */
export async function deliverNotification(
  job: NotifyJob,
): Promise<{ status: "sent" | "failed" | "handled"; error?: string }> {
  const skip = await withTenant(job.tenantId, async (tx) => {
    const [d] = await tx
      .select({ status: notificationDeliveries.status })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, job.deliveryId));
    // The job can outrun the transaction that wrote the row: let BullMQ retry, the row will be there.
    if (!d) throw new Error(`delivery ${job.deliveryId} not committed yet`);
    if (d.status !== "queued") return "done" as const;
    if (job.escalationId) {
      const [e] = await tx
        .select({ status: escalations.status })
        .from(escalations)
        .where(eq(escalations.id, job.escalationId));
      if (e && e.status !== "pending") {
        await tx
          .update(notificationDeliveries)
          .set({ status: "handled", handledAt: new Date(), error: `escalation ${e.status}` })
          .where(eq(notificationDeliveries.id, job.deliveryId));
        return "handled" as const;
      }
    }
    return null;
  });
  if (skip === "done") return { status: "handled" };
  if (skip === "handled") return { status: "handled" };

  const ackUrl = job.ackToken ? `${job.origin}/ack/${job.ackToken}` : null;
  let result: { ok: boolean; ref?: string; error?: string; gone?: boolean };
  try {
    switch (job.channel) {
      case "email": {
        const lines = [
          job.text,
          "",
          job.url ? `Open: ${job.url}` : "",
          ackUrl ? `Acknowledge: ${ackUrl}` : "",
        ].filter((l) => l !== undefined);
        const r = await sendTenantEmail({
          tenantId: job.tenantId,
          to: job.target,
          subject: job.subject,
          text: lines.join("\n"),
          kind: "escalation",
          ref: job.escalationId ?? undefined,
          immediate: true,
        });
        result =
          r.delivered || r.queued
            ? { ok: true, ref: r.messageId }
            : { ok: false, error: r.error ?? "mail failed" };
        break;
      }
      case "sms": {
        const body = `${job.subject}\n${job.text}${ackUrl ? `\nAck: ${ackUrl}` : ""}`.slice(
          0,
          1500,
        );
        result = await twilio("Messages", {
          To: job.target,
          From: process.env.TWILIO_FROM!,
          Body: body,
        });
        break;
      }
      case "voice": {
        const say = escapeXml(`${job.subject}. ${job.text}. Press 4 to acknowledge.`);
        const action = job.ackToken ? `${job.origin}/api/notify/voice/${job.ackToken}` : null;
        const twiml = action
          ? `<Response><Gather numDigits="1" action="${escapeXml(action)}" method="POST"><Say>${say}</Say></Gather><Say>No answer recorded. Goodbye.</Say></Response>`
          : `<Response><Say>${say}</Say></Response>`;
        result = await twilio("Calls", {
          To: job.target,
          From: process.env.TWILIO_FROM!,
          Twiml: twiml,
        });
        break;
      }
      case "webpush": {
        result = await sendWebPush(
          job.target,
          JSON.stringify({
            title: job.subject,
            body: job.text,
            url: job.url ?? job.origin,
            ackUrl,
          }),
        );
        break;
      }
      case "slack": {
        const r = await dmSlackUser(job.tenantId, job.target, {
          subject: job.subject,
          text: job.text,
          url: job.url ?? job.origin,
          ackToken: job.ackToken ?? null,
          ackUrl,
        });
        result = r.ok ? { ok: true, ref: r.ref } : { ok: false, error: r.error ?? "slack failed" };
        break;
      }
      case "teams": {
        const r = await dmTeamsUser(job.tenantId, job.target, {
          subject: job.subject,
          text: job.text,
          url: job.url ?? job.origin,
          ackToken: job.ackToken ?? null,
          ackUrl,
        });
        result = r.ok ? { ok: true, ref: r.ref } : { ok: false, error: r.error ?? "teams failed" };
        break;
      }
    }
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  await withTenant(job.tenantId, async (tx) => {
    await tx
      .update(notificationDeliveries)
      .set(
        result.ok
          ? { status: "sent", sentAt: new Date(), providerRef: result.ref ?? null }
          : { status: "failed", error: result.error ?? "failed" },
      )
      .where(eq(notificationDeliveries.id, job.deliveryId));
    if (result.gone) {
      // The browser dropped the subscription: forget the method so nobody relies on it.
      await tx
        .delete(notificationMethods)
        .where(
          and(eq(notificationMethods.kind, "webpush"), eq(notificationMethods.value, job.target)),
        );
    }
  });
  return result.ok ? { status: "sent" } : { status: "failed", error: result.error };
}

/** Hash of a verification code, stored instead of the code. */
export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}
