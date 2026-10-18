"use server";

/**
 * The frame's own action: "Page me".
 *
 * It sends a real notification through the reader's own high-urgency rule —
 * push, then a call, exactly as a P1 would. Nothing is simulated, which is why
 * it is worth a button: the only way to know the chain works is to feel it ring.
 *
 * It answers with the sentence to show rather than redirecting: the reader
 * pressed a button in the rail, they should stay where they were.
 */

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { notificationMethods, withTenant } from "@openincident/db";
import { availableChannels, notifyMember } from "@openincident/oncall";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { requestOrigin } from "@/lib/tenant";
import { markInboxRead } from "@/lib/inbox";
import { maskEmail, maskPhone } from "./page-me-mask";

export async function pageMeFromShell(): Promise<{ ok: boolean; message: string }> {
  const current = await requireMember();
  const t = await getT();
  const h = await headers();
  const base = requestOrigin({
    headers: h,
    nextUrl: new URL(`http://${h.get("host") ?? "localhost"}/`),
  });

  // Said rather than attempted: an instance with no channel at all cannot
  // reach anybody, and pretending otherwise is the one thing this button must
  // not do.
  const channels = availableChannels();
  if (channels.length === 0) return { ok: false, message: t("shell.pageMeUnavailable") };

  const { sent, phone } = await withTenant(current.tenant.id, async (tx) => {
    const sent = await notifyMember(
      tx,
      current.tenant.id,
      { id: current.member.id, name: current.member.name, email: current.member.email },
      {
        kind: "test",
        urgency: "high",
        subject: t("shell.pageMeSubject"),
        text: t("shell.pageMeBody", { name: current.member.name }),
        url: `${base}/app`,
        origin: base,
      },
    );
    const [method] = await tx
      .select({ value: notificationMethods.value })
      .from(notificationMethods)
      .where(
        and(
          eq(notificationMethods.tenantId, current.tenant.id),
          eq(notificationMethods.memberId, current.member.id),
          inArray(notificationMethods.kind, ["voice", "sms"]),
          isNotNull(notificationMethods.verifiedAt),
        ),
      )
      .limit(1);
    return { sent, phone: method?.value ?? null };
  });
  // No revalidation here: the frame refreshes the screen it is on once the
  // toast is up, which is what brings the bell's new line in.
  return { ok: true, message: pageMeSentence(t, sent, phone, current.member.email) };
}

/**
 * What the toast says: the call when the rule rings a phone — "calling
 * +33 6 •• •• 78" — and otherwise the channels the page really left by, with
 * their masked address. Never a channel that was not used.
 */
function pageMeSentence(
  t: Awaited<ReturnType<typeof getT>>,
  sent: Array<{ channel: string; delayMinutes: number }>,
  phone: string | null,
  email: string,
): string {
  if (phone && sent.some((d) => d.channel === "voice"))
    return t("sh.pageMeCalling", { phone: maskPhone(phone) });
  const now = sent.filter((d) => d.delayMinutes === 0);
  const names = (now.length > 0 ? now : sent).map((d) => {
    switch (d.channel) {
      case "email":
        return t("sh.ch.email", { target: maskEmail(email) });
      case "sms":
        return t("sh.ch.sms", { target: phone ? maskPhone(phone) : "" });
      case "webpush":
        return t("sh.ch.push");
      case "slack":
        return t("sh.ch.slack");
      case "teams":
        return t("sh.ch.teams");
      default:
        return d.channel;
    }
  });
  const list = new Intl.ListFormat(t.locale.tag, { type: "conjunction" }).format(names);
  return t("sh.pageMeBy", { channels: list });
}

/**
 * Marks one line of the bell as read, or every unread line when given nothing.
 *
 * Reading is not a privileged gesture: any member may clear their own bell,
 * and the tenant context makes it impossible to clear anybody else's.
 */
export async function markBellRead(id?: string): Promise<void> {
  const current = await requireMember();
  await withTenant(current.tenant.id, (tx) =>
    markInboxRead(tx, current.tenant.id, current.member.id, id),
  );
  revalidatePath("/app");
}
