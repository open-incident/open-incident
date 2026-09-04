/** Email subscriptions: double opt-in, one-click unsubscribe. */
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { statusPageSubscribers, statusPages, withTenant } from "@openincident/db";
import { sendTenantEmail } from "@openincident/mail";
import { refreshStatusSnapshot } from "./snapshot";

export async function subscribeToPage(
  tenantId: string,
  pageId: string,
  email: string,
  pageUrl: string,
): Promise<{ ok: boolean; alreadyConfirmed: boolean }> {
  const value = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return { ok: false, alreadyConfirmed: false };
  return withTenant(tenantId, async (tx) => {
    const [page] = await tx
      .select()
      .from(statusPages)
      .where(and(eq(statusPages.tenantId, tenantId), eq(statusPages.id, pageId)));
    if (!page) return { ok: false, alreadyConfirmed: false };
    const [existing] = await tx
      .select()
      .from(statusPageSubscribers)
      .where(and(eq(statusPageSubscribers.pageId, pageId), eq(statusPageSubscribers.email, value)));
    if (existing?.confirmedAt) return { ok: true, alreadyConfirmed: true };
    const confirmToken = existing?.confirmToken ?? randomBytes(20).toString("hex");
    const unsubscribeToken = existing?.unsubscribeToken ?? randomBytes(20).toString("hex");
    if (!existing)
      await tx
        .insert(statusPageSubscribers)
        .values({ tenantId, pageId, email: value, confirmToken, unsubscribeToken, source: "form" });
    await sendTenantEmail({
      tenantId,
      to: value,
      subject: `Confirm your subscription to ${page.name}`,
      text: `Confirm to receive the updates of ${page.name}:\n\n${pageUrl}/confirm/${confirmToken}\n\nIf you did not ask for this, ignore this email.`,
      kind: "other",
      ref: pageId,
      headers: page.replyTo ? { "reply-to": page.replyTo } : undefined,
    });
    return { ok: true, alreadyConfirmed: false };
  });
}

export async function confirmSubscriber(
  tenantId: string,
  token: string,
): Promise<{ ok: boolean; pageId: string | null }> {
  const r = await withTenant(tenantId, async (tx) => {
    const [s] = await tx
      .select()
      .from(statusPageSubscribers)
      .where(
        and(
          eq(statusPageSubscribers.tenantId, tenantId),
          eq(statusPageSubscribers.confirmToken, token),
        ),
      );
    if (!s) return { ok: false, pageId: null };
    if (!s.confirmedAt)
      await tx
        .update(statusPageSubscribers)
        .set({ confirmedAt: new Date() })
        .where(eq(statusPageSubscribers.id, s.id));
    return { ok: true, pageId: s.pageId };
  });
  if (r.pageId) await refreshStatusSnapshot(tenantId, r.pageId);
  return r;
}

export async function unsubscribe(
  tenantId: string,
  token: string,
): Promise<{ ok: boolean; pageId: string | null }> {
  const r = await withTenant(tenantId, async (tx) => {
    const [s] = await tx
      .select()
      .from(statusPageSubscribers)
      .where(
        and(
          eq(statusPageSubscribers.tenantId, tenantId),
          eq(statusPageSubscribers.unsubscribeToken, token),
        ),
      );
    if (!s) return { ok: false, pageId: null };
    await tx.delete(statusPageSubscribers).where(eq(statusPageSubscribers.id, s.id));
    return { ok: true, pageId: s.pageId };
  });
  if (r.pageId) await refreshStatusSnapshot(tenantId, r.pageId);
  return r;
}
