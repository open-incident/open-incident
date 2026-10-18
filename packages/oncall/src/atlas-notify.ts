/**
 * Atlas's notifications to a member (spec delta §15.5, §16): "✦ Atlas
 * resolved INC-224 on its own" (Undo / Review), "✦ Atlas proposes a fix"
 * (Approve / Open), and the 09:00 summary.
 *
 * A push when the member has a verified one, carrying its one-tap actions —
 * signed links that work on a locked phone without signing in — and silent
 * when the member chose a silent push. Otherwise, for the summary only, an
 * email. Every send is a row in the outbox, written before the attempt, with
 * an honest status; and a line in the bell, which is where the review starts.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { notificationDeliveries, notificationMethods, withTenant } from "@openincident/db";
import { sendTenantEmail } from "@openincident/mail";
import { recordInbox } from "./inbox";

export type AtlasNoticeAction = { action: string; title: string; url: string };

export type AtlasNotice = {
  title: string;
  body: string;
  /** Where a tap on the notification itself goes. */
  url: string;
  actions: AtlasNoticeAction[];
  /** No sound, no vibration — "Silent push right away". */
  silent: boolean;
  /** The bell line, relative URL. */
  inbox?: { title: string; body: string; url: string; incidentId: string | null; groupKey: string };
  /** For the summary: what to send when there is no push. */
  emailFallback?: { subject: string; text: string } | null;
};

function pushConfigured(): boolean {
  return Boolean(process.env.WEBPUSH_VAPID_PUBLIC_KEY && process.env.WEBPUSH_VAPID_PRIVATE_KEY);
}

async function sendPush(
  subscription: string,
  payload: string,
  silent: boolean,
): Promise<{ ok: boolean; error?: string; gone?: boolean }> {
  const webpush = await import("web-push");
  webpush.default.setVapidDetails(
    process.env.WEBPUSH_SUBJECT ?? "mailto:ops@example.com",
    process.env.WEBPUSH_VAPID_PUBLIC_KEY!,
    process.env.WEBPUSH_VAPID_PRIVATE_KEY!,
  );
  try {
    await webpush.default.sendNotification(JSON.parse(subscription), payload, {
      TTL: 3600,
      urgency: silent ? "low" : "normal",
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
 * Sends one Atlas notice to one member. Returns how it went out — "push",
 * "email", or "none" with the reason (no verified push, push not configured on
 * this instance) — and never throws.
 */
export async function sendAtlasNotice(
  tenantId: string,
  member: { id: string; email: string },
  notice: AtlasNotice,
): Promise<{ via: "push" | "email" | "none"; error?: string }> {
  try {
    const methods = await withTenant(tenantId, async (tx) => {
      if (notice.inbox)
        await recordInbox(tx, tenantId, member.id, {
          kind: "incident",
          title: notice.inbox.title,
          body: notice.inbox.body,
          url: notice.inbox.url,
          incidentId: notice.inbox.incidentId,
          groupKey: notice.inbox.groupKey,
        });
      return tx
        .select()
        .from(notificationMethods)
        .where(
          and(
            eq(notificationMethods.tenantId, tenantId),
            eq(notificationMethods.memberId, member.id),
            eq(notificationMethods.kind, "webpush"),
            isNotNull(notificationMethods.verifiedAt),
          ),
        );
    });
    if (pushConfigured() && methods.length > 0) {
      let sent = false;
      let lastError: string | undefined;
      for (const m of methods) {
        const [row] = await withTenant(tenantId, (tx) =>
          tx
            .insert(notificationDeliveries)
            .values({
              tenantId,
              memberId: member.id,
              methodKind: "webpush",
              target: "web push",
              kind: "atlas",
              urgency: "low",
              status: "queued",
              message: { subject: notice.title, text: notice.body, url: notice.url },
            })
            .returning({ id: notificationDeliveries.id }),
        );
        const r = await sendPush(
          m.value,
          JSON.stringify({
            title: notice.title,
            body: notice.body,
            url: notice.url,
            actions: notice.actions.slice(0, 2),
            silent: notice.silent,
            tag: notice.inbox?.groupKey ?? notice.url,
          }),
          notice.silent,
        );
        await withTenant(tenantId, (tx) =>
          tx
            .update(notificationDeliveries)
            .set(
              r.ok
                ? { status: "sent", sentAt: new Date() }
                : { status: "failed", error: (r.error ?? "push failed").slice(0, 300) },
            )
            .where(eq(notificationDeliveries.id, row!.id)),
        );
        if (r.ok) sent = true;
        else lastError = r.error;
      }
      if (sent) return { via: "push" };
      if (!notice.emailFallback) return { via: "none", error: lastError };
    }
    if (notice.emailFallback) {
      const r = await sendTenantEmail({
        tenantId,
        to: member.email,
        subject: notice.emailFallback.subject,
        text: notice.emailFallback.text,
        kind: "incident",
      });
      return r.delivered || r.queued ? { via: "email" } : { via: "none", error: r.error };
    }
    return {
      via: "none",
      error: pushConfigured()
        ? "no verified push on this member"
        : "push is not configured on this instance",
    };
  } catch (err) {
    return { via: "none", error: err instanceof Error ? err.message : String(err) };
  }
}
