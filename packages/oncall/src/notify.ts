/**
 * Notifications to responders — the outbox.
 *
 * Every send is a row written BEFORE the attempt, with honest statuses:
 * queued → sent | failed, then delivered / handled when we learn more. The
 * channels that wake people (SMS, voice, web push) need a provider configured
 * on the instance; without one the channel is unavailable, never faked.
 *
 * The operators themselves live in `@openincident/notify`: this file decides
 * who is paged, in which order, and what is written down — not which company
 * carries the message. Which is why SMS and voice are asked about separately
 * below: an instance can very well be able to text and not to call.
 */
import { createHash, randomBytes } from "node:crypto";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { and, eq, lte, sql } from "drizzle-orm";
import {
  escalations,
  getTenantById,
  members,
  notificationDeliveries,
  notificationMethods,
  notificationRules,
  withTenant,
  workspaces,
  type NotificationStep,
  type Tx,
} from "@openincident/db";
import { sendTenantEmail } from "@openincident/mail";
import { smsConfigured, smsTransport, voiceConfigured, voiceTransport } from "@openincident/notify";
import { dmSlackUser, dmTeamsUser, slackConfigured, teamsConfigured } from "@openincident/chat";
import { NOTIFY_QUEUE } from "./queues";
import { recordInbox } from "./inbox";
import { addDays, localParts, zonedTime } from "./time";
import { originFor } from "@openincident/config";

export type NotifyChannel = "email" | "sms" | "voice" | "webpush" | "slack" | "teams";
export type Urgency = "high" | "low";

export const CHANNELS: NotifyChannel[] = ["email", "sms", "voice", "webpush", "slack", "teams"];

/** The channels this instance can actually use. Email always; the others need their provider. */
export function availableChannels(): NotifyChannel[] {
  const out: NotifyChannel[] = ["email"];
  if (smsConfigured()) out.push("sms");
  if (voiceConfigured()) out.push("voice");
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
  /** Low urgency: the push is silent — it lands without ringing. */
  urgency?: Urgency;
  /** An email digest step: one message for every digest waiting for this member. */
  digest?: boolean;
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

/**
 * The default personal rule when a member set none — at send time it is
 * restricted to what is available here and verified for them, and falls back
 * to the account email when nothing else is left.
 *
 * High urgency: the chat message and the push at once, a call after a minute
 * without acknowledgement, a second call at four. Low urgency: the chat
 * message and a silent push at once, and the 09:00 email digest.
 */
export function defaultSteps(urgency: Urgency): NotificationStep[] {
  return urgency === "high"
    ? [
        { kind: "slack", delayMinutes: 0 },
        { kind: "teams", delayMinutes: 0 },
        { kind: "webpush", delayMinutes: 0 },
        { kind: "voice", delayMinutes: 1 },
        { kind: "sms", delayMinutes: 1 },
        { kind: "voice", delayMinutes: 4 },
      ]
    : [
        { kind: "slack", delayMinutes: 0 },
        { kind: "teams", delayMinutes: 0 },
        { kind: "webpush", delayMinutes: 0 },
        { kind: "email", delayMinutes: 0, at: DIGEST_AT },
      ];
}

/** When the low-urgency email digest goes out, in the member's zone. */
export const DIGEST_AT = "09:00";

/** The next time a wall-clock "HH:MM" comes round in a zone, strictly after `now`. */
export function nextLocalTime(now: Date, hhmm: string, timeZone: string): Date {
  const p = localParts(now, timeZone);
  for (let i = 0; i < 3; i++) {
    const [y, m, d] = addDays(p.year, p.month, p.day, i);
    const at = zonedTime(y, m, d, hhmm, timeZone);
    if (at.getTime() > now.getTime()) return at;
  }
  return new Date(now.getTime() + 86_400_000);
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
  const chosen: NotificationStep[] =
    steps.length > 0 ? steps : [{ kind: "email" as const, delayMinutes: 0 }];
  const out: Array<{ deliveryId: string; channel: NotifyChannel; delayMinutes: number }> = [];
  const jobs: Array<{ job: NotifyJob; delayMs: number }> = [];
  // A digest waits for its hour in the member's own zone (else the workspace's).
  const zone =
    input.kind === "escalation" && chosen.some((s) => s.at)
      ? await memberZone(tx, tenantId, member.id)
      : "UTC";
  for (const step of chosen) {
    const target = targetFor(step.kind)!;
    // Only a page waits for the digest: a cover request or a shift reminder
    // is about the next hours and goes out at once.
    const digest = step.kind === "email" && Boolean(step.at) && input.kind === "escalation";
    const ackToken = input.ackable && !digest ? randomBytes(16).toString("hex") : null;
    const sendAfter = digest
      ? nextLocalTime(now, step.at!, zone)
      : new Date(now.getTime() + step.delayMinutes * 60_000);
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
        message: {
          subject: input.subject,
          text: input.text,
          url: input.url,
          ...(digest ? { digest: true } : {}),
        },
        sendAfter,
      })
      .returning({ id: notificationDeliveries.id });
    const delayMs = Math.max(0, sendAfter.getTime() - now.getTime());
    out.push({
      deliveryId: row!.id,
      channel: step.kind,
      delayMinutes: Math.round(delayMs / 60_000),
    });
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
        urgency: input.urgency,
        ...(digest ? { digest: true } : {}),
      },
      delayMs,
    });
  }
  // Enqueue after the rows exist. Without Redis the immediate steps go now; the
  // later ones wait for the worker's sweep, which re-reads them from the row.
  for (const { job, delayMs } of jobs) {
    const queued = await enqueueNotification(job, delayMs);
    if (!queued && delayMs === 0) deliverDirectly(job);
  }
  // A page is also something to find again in the app afterwards. Only a page:
  // a shift reminder and a cover request reach the person by their own
  // channels and do not belong in the bell, which is about what happened to
  // the things they are on.
  if (input.kind === "escalation" || input.kind === "test") {
    await recordInbox(tx, tenantId, member.id, {
      kind: "paged",
      title: input.subject,
      body: input.text.slice(0, 400),
      url: input.url ? relativeUrl(input.url) : null,
      alertId: input.alertId ?? null,
      groupKey: `paged:${input.alertId ?? input.escalationId ?? input.subject}`,
    });
  }
  return out;
}

/** The zone a member's day is counted in: their own, else the workspace's. */
async function memberZone(tx: Tx, tenantId: string, memberId: string): Promise<string> {
  const [m] = await tx
    .select({ timezone: members.timezone })
    .from(members)
    .where(eq(members.id, memberId));
  if (m?.timezone) return m.timezone;
  const [w] = await tx
    .select({ timezone: workspaces.timezone })
    .from(workspaces)
    .where(eq(workspaces.tenantId, tenantId));
  return w?.timezone ?? "Europe/Paris";
}

/** The bell links inside the app, so an absolute origin is dropped. */
function relativeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/**
 * The no-queue path: deliver from this very process, once the row's transaction
 * is visible. deliverNotification throws "not committed yet" on purpose so that
 * BullMQ retries; here nothing retries for us, so this does — and it never
 * lets a rejection escape: an unhandled one ends the process, and the worker
 * died exactly that way on a runner without Redis, taking every sweep with it.
 */
function deliverDirectly(job: NotifyJob, attempt = 0): void {
  setTimeout(
    async () => {
      try {
        await deliverNotification(job);
      } catch (err) {
        const notYet = err instanceof Error && /not committed yet/.test(err.message);
        if (notYet && attempt < 20) return deliverDirectly(job, attempt + 1);
        console.error(`[notify] direct delivery ${job.deliveryId} failed:`, err);
      }
    },
    attempt === 0 ? 0 : 500,
  );
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
      urgency: d.urgency ?? undefined,
      ...(d.message.digest ? { digest: true } : {}),
    };
  });
}

/** The public origin of a workspace, from its slug and the instance's base domain. */
export function tenantOrigin(slug: string, customDomain?: string | null): string {
  if (customDomain) return `https://${customDomain}`;
  const base = process.env.BASE_DOMAIN ?? "localhost:3100";
  return originFor(`${slug}.${base}`);
}

/* ---------- Web push, the one operator that is us ---------- */

async function sendWebPush(
  subscription: string,
  payload: string,
  urgency: Urgency = "high",
): Promise<{ ok: boolean; error?: string; gone?: boolean }> {
  const webpush = await import("web-push");
  webpush.default.setVapidDetails(
    process.env.WEBPUSH_SUBJECT ?? "mailto:ops@example.com",
    process.env.WEBPUSH_VAPID_PUBLIC_KEY!,
    process.env.WEBPUSH_VAPID_PRIVATE_KEY!,
  );
  try {
    await webpush.default.sendNotification(JSON.parse(subscription), payload, {
      TTL: urgency === "high" ? 300 : 3600,
      urgency: urgency === "high" ? "high" : "normal",
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

  if (job.digest && job.channel === "email") return deliverDigest(job);

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
        const sms = smsTransport();
        if (!sms) {
          result = { ok: false, error: "no SMS operator configured" };
          break;
        }
        const body = `${job.subject}\n${job.text}${ackUrl ? `\nAck: ${ackUrl}` : ""}`.slice(
          0,
          1500,
        );
        const r = await sms.send({ to: job.target, text: body });
        result = r.ok ? { ok: true, ref: r.ref } : { ok: false, error: r.error };
        break;
      }
      case "voice": {
        const voice = voiceTransport();
        if (!voice) {
          result = { ok: false, error: "no voice operator configured" };
          break;
        }
        // The sentence names the key, the transport wires it: the caller hears
        // "press 4" only when there is a route for the 4 to land on.
        const ack = job.ackToken ? { url: `${job.origin}/api/notify/voice/${job.ackToken}` } : null;
        const say = ack
          ? `${job.subject}. ${job.text}. Press 4 to acknowledge.`
          : `${job.subject}. ${job.text}.`;
        const r = await voice.call({ to: job.target, say, ack });
        result = r.ok ? { ok: true, ref: r.ref } : { ok: false, error: r.error };
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
            // Low urgency lands without a sound and without staying on screen.
            silent: job.urgency === "low",
          }),
          job.urgency ?? "high",
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

/**
 * The 09:00 email digest: the first digest job of the hour claims every digest
 * waiting for the same member and sends them as one message; the jobs of the
 * others find their row already sent and stop. The claim is one UPDATE, so two
 * jobs running at once never send the same line twice.
 */
async function deliverDigest(
  job: NotifyJob,
): Promise<{ status: "sent" | "failed" | "handled"; error?: string }> {
  const claimed = await withTenant(job.tenantId, async (tx) => {
    const [own] = await tx
      .select({ memberId: notificationDeliveries.memberId })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, job.deliveryId));
    if (!own?.memberId) return [];
    return tx
      .update(notificationDeliveries)
      .set({ status: "sent", sentAt: new Date() })
      .where(
        and(
          eq(notificationDeliveries.tenantId, job.tenantId),
          eq(notificationDeliveries.memberId, own.memberId),
          eq(notificationDeliveries.methodKind, "email"),
          eq(notificationDeliveries.status, "queued"),
          sql`(${notificationDeliveries.message} ->> 'digest') = 'true'`,
          lte(notificationDeliveries.sendAfter, new Date(Date.now() + 60_000)),
        ),
      )
      .returning({
        id: notificationDeliveries.id,
        message: notificationDeliveries.message,
        createdAt: notificationDeliveries.createdAt,
      });
  });
  if (!claimed.some((c) => c.id === job.deliveryId)) return { status: "handled" };
  const lines = claimed
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .flatMap((c) => [
      `• ${c.message.subject}`,
      `  ${c.message.text}`,
      ...(c.message.url ? [`  ${c.message.url}`] : []),
      "",
    ]);
  const subject =
    claimed.length === 1
      ? `Digest — ${claimed[0]!.message.subject}`
      : `Digest — ${claimed.length} low-urgency pages since yesterday`;
  let outcome: { ok: boolean; ref?: string; error?: string };
  try {
    const r = await sendTenantEmail({
      tenantId: job.tenantId,
      to: job.target,
      subject,
      text: lines.join("\n"),
      kind: "escalation",
      immediate: true,
    });
    outcome =
      r.delivered || r.queued
        ? { ok: true, ref: r.messageId }
        : { ok: false, error: r.error ?? "mail failed" };
  } catch (err) {
    outcome = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const ids = claimed.map((c) => c.id);
  await withTenant(job.tenantId, async (tx) => {
    for (const id of ids)
      await tx
        .update(notificationDeliveries)
        .set(
          outcome.ok
            ? { providerRef: outcome.ref ?? null }
            : { status: "failed", error: outcome.error ?? "failed" },
        )
        .where(eq(notificationDeliveries.id, id));
  });
  return outcome.ok ? { status: "sent" } : { status: "failed", error: outcome.error };
}

/** Hash of a verification code, stored instead of the code. */
export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}
