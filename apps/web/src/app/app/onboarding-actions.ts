"use server";

/**
 * The three steps of the home, done where they are read.
 *
 * Every one of these already existed behind a screen of its own — a phone on
 * the notifications tab, an invitation in the members settings, a monitor in
 * Monitors, a test page in the rail. The home used to point at those screens,
 * which meant the first thing a new workspace did was leave the page that was
 * explaining itself, four times.
 *
 * So these are the same gestures, answering instead of navigating: each returns
 * the sentence the card should show, and the card stays where the reader is.
 * Nothing here is a second implementation — the phone goes through the same
 * verification, the source through the same creation, the test through the same
 * notification path a P1 takes.
 */

import { randomInt } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  members,
  monitors,
  notificationDeliveries,
  notificationMethods,
  withTenant,
} from "@openincident/db";
import {
  availableChannels,
  deliverNotification,
  hashCode,
  notifyMember,
} from "@openincident/oncall";
import { getT } from "@/i18n/server";
import { requireManager, requireMember, requireResponder } from "@/lib/session";
import { requestOrigin } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import { ensureQuickPath, pageWithPath } from "@/lib/alerting-setup";
import { sendMemberInvite } from "@/lib/member-invite";

const HOME = "/app";

async function origin(): Promise<string> {
  const h = await headers();
  return requestOrigin({ headers: h, nextUrl: new URL(`http://${h.get("host") ?? "localhost"}/`) });
}

export type StepAnswer = { ok?: true; error?: string; methodId?: string; note?: string };

/**
 * Step 1 — the phone the pager calls, and the code that proves it.
 *
 * The code travels through the very channel it is verifying: a number that
 * cannot receive the SMS cannot be confirmed, which is the whole point of
 * asking for it before the workspace depends on it.
 */
export async function startPhone(_prev: unknown, formData: FormData): Promise<StepAnswer> {
  const current = await requireMember();
  const t = await getT();
  const kind = z.enum(["sms", "voice"]).catch("sms").parse(formData.get("kind"));
  const value = z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/)
    .safeParse(formData.get("value"));
  if (!value.success) return { error: t("home.err.phone") };
  if (!availableChannels().includes(kind)) return { error: t("home.err.channel") };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const base = await origin();
  const { methodId, deliveryId } = await withTenant(current.tenant.id, async (tx) => {
    const [method] = await tx
      .insert(notificationMethods)
      .values({
        tenantId: current.tenant.id,
        memberId: current.member.id,
        kind,
        value: value.data,
        verifyCodeHash: hashCode(code),
        verifyExpiresAt: new Date(Date.now() + 15 * 60_000),
      })
      .returning({ id: notificationMethods.id });
    const [delivery] = await tx
      .insert(notificationDeliveries)
      .values({
        tenantId: current.tenant.id,
        memberId: current.member.id,
        methodKind: kind,
        target: `${value.data.slice(0, 4)}…${value.data.slice(-2)}`,
        kind: "verification",
        status: "queued",
        message: { subject: "verification", text: "" },
      })
      .returning({ id: notificationDeliveries.id });
    return { methodId: method!.id, deliveryId: delivery!.id };
  });
  await deliverNotification({
    tenantId: current.tenant.id,
    deliveryId,
    channel: kind,
    target: value.data,
    subject: t("home.codeSubject"),
    text: t("home.codeBody", { code }),
    origin: base,
  });
  revalidatePath(HOME);
  return { ok: true, methodId };
}

export async function confirmPhone(_prev: unknown, formData: FormData): Promise<StepAnswer> {
  const current = await requireMember();
  const t = await getT();
  const id = z.string().uuid().safeParse(formData.get("methodId"));
  const code = z
    .string()
    .trim()
    .regex(/^\d{6}$/)
    .safeParse(formData.get("code"));
  if (!id.success || !code.success) return { error: t("home.err.code") };
  const ok = await withTenant(current.tenant.id, async (tx) => {
    const [m] = await tx
      .select()
      .from(notificationMethods)
      .where(
        and(
          eq(notificationMethods.tenantId, current.tenant.id),
          eq(notificationMethods.id, id.data),
          eq(notificationMethods.memberId, current.member.id),
        ),
      );
    if (
      !m ||
      !m.verifyCodeHash ||
      !m.verifyExpiresAt ||
      m.verifyExpiresAt.getTime() < Date.now() ||
      m.verifyCodeHash !== hashCode(code.data)
    )
      return false;
    await tx
      .update(notificationMethods)
      .set({ verifiedAt: new Date(), verifyCodeHash: null, verifyExpiresAt: null })
      .where(eq(notificationMethods.id, m.id));
    return true;
  });
  revalidatePath(HOME);
  return ok ? { ok: true } : { error: t("home.err.code") };
}

/**
 * Step 1 — the click that makes the pager reach you.
 *
 * A verified phone is a channel, not an answer: until a route names a path
 * that names somebody, a workspace's alerts reach nobody through a perfectly
 * verified number. So picking "Me" does what the product's whole thesis says
 * one click should do — it builds the path that pages this member and names it
 * on the rule that catches everything.
 */
export async function pageMeFirst(): Promise<StepAnswer> {
  const current = await requireResponder();
  const t = await getT();
  await withTenant(current.tenant.id, async (tx) => {
    const path = await ensureQuickPath(
      tx,
      current.tenant.id,
      { memberId: current.member.id },
      { kind: "member", memberId: current.member.id },
      t("setup.quickPath.member", { name: current.member.name }),
    );
    await pageWithPath(
      tx,
      current.tenant.id,
      path.id,
      t("setup.catchAll"),
      t("setup.catchAllDesc"),
    );
    // The same record the settings screen writes: one gesture, one name in
    // the log, wherever the reader happened to be standing.
    await recordAudit(tx, current, "config", "alerting.page_me", { path: path.name });
  });
  revalidatePath(HOME);
  revalidatePath("/app/settings/alert-routes");
  return { ok: true };
}

/**
 * Step 1b — somebody paged after you.
 *
 * An invitation, the same one the members settings sends. A workspace of one
 * has nobody behind it, and the step says so rather than letting the reader
 * find out on the night they do not hear their phone.
 */
export async function inviteBackup(_prev: unknown, formData: FormData): Promise<StepAnswer> {
  const current = await requireManager();
  const t = await getT();
  const email = z.string().trim().toLowerCase().email().safeParse(formData.get("email"));
  if (!email.success) return { error: t("home.err.email") };
  const row = await withTenant(current.tenant.id, async (tx) => {
    const name = (email.data.split("@")[0] ?? email.data)
      .split(/[._-]+/)
      .filter(Boolean)
      .map((p) => p[0]!.toUpperCase() + p.slice(1))
      .join(" ");
    const [created] = await tx
      .insert(members)
      .values({
        tenantId: current.tenant.id,
        email: email.data,
        name: name || email.data,
        role: "responder",
        status: "invited",
      })
      .onConflictDoNothing()
      .returning({ id: members.id, email: members.email });
    if (created)
      await recordAudit(tx, current, "members", "member.invited", {
        email: email.data,
        role: "responder",
      });
    return created ?? null;
  });
  if (!row) return { error: t("home.err.emailTaken") };
  await sendMemberInvite(current.tenant, current.workspace.name, row, current.member.name);
  revalidatePath(HOME);
  return { ok: true, note: email.data };
}

/**
 * Step 2, the other half — a URL we watch.
 *
 * The same monitor the Monitors screen creates, with the defaults that screen
 * would have offered: every minute, and the owner of whatever service the
 * alert names gets paged.
 */
export async function watchUrl(_prev: unknown, formData: FormData): Promise<StepAnswer> {
  const current = await requireResponder();
  const t = await getT();
  const url = z.string().trim().url().max(500).safeParse(formData.get("url"));
  if (!url.success || !/^https?:\/\//i.test(url.data)) return { error: t("home.err.url") };
  const host = new URL(url.data).host;
  await withTenant(current.tenant.id, async (tx) => {
    await tx.insert(monitors).values({
      tenantId: current.tenant.id,
      name: host,
      type: "http",
      target: url.data,
      intervalSeconds: 60,
      action: { page: { kind: "owner" }, incident: { from: "urgent" }, autoResolve: true },
    });
    await recordAudit(tx, current, "config", "monitor.created", { name: host, type: "http" });
  });
  revalidatePath(HOME);
  revalidatePath("/app/monitors");
  return { ok: true, note: host };
}

/**
 * Step 3 — the only proof.
 *
 * A real notification through the reader's own high-urgency rule, marked as a
 * test everywhere it lands. An instance with no channel at all says so instead
 * of pretending: a button that claims to ring and does not is worse than no
 * button on the screen whose job is to establish trust.
 */
export async function sendFirstPage(): Promise<StepAnswer> {
  const current = await requireMember();
  const t = await getT();
  if (availableChannels().length === 0) return { error: t("shell.pageMeUnavailable") };
  const base = await origin();
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
  revalidatePath(HOME);
  return { ok: true };
}
