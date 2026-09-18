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
import { withTenant } from "@openincident/db";
import { availableChannels, notifyMember } from "@openincident/oncall";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { requestOrigin } from "@/lib/tenant";
import { markInboxRead } from "@/lib/inbox";

export async function pageMeFromShell(): Promise<{ ok: boolean; message: string }> {
  const current = await requireMember();
  const t = await getT();
  const h = await headers();
  const base = requestOrigin({
    headers: h,
    nextUrl: new URL(`http://${h.get("host") ?? "localhost"}/`),
  });

  // Said rather than attempted: an instance with no voice operator cannot ring
  // a phone, and pretending otherwise is the one thing this button must not do.
  const channels = availableChannels();
  if (channels.length === 0) return { ok: false, message: t("shell.pageMeUnavailable") };

  await withTenant(current.tenant.id, (tx) =>
    notifyMember(
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
    ),
  );
  return { ok: true, message: t("shell.pageMeSent") };
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
