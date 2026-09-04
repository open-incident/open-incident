"use server";

import { randomInt } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  members,
  notificationMethods,
  notificationRules,
  withTenant,
  type Tx,
} from "@openincident/db";
import {
  availableChannels,
  deliverNotification,
  hashCode,
  notifyMember,
  type NotifyChannel,
} from "@openincident/oncall";
import {
  getSlackInstall,
  getTeamsInstall,
  linkSlackIdentity,
  linkTeamsIdentity,
  slack,
} from "@openincident/chat";
import { headers } from "next/headers";
import { requireMember } from "@/lib/session";
import { requestOrigin } from "@/lib/tenant";

const PAGE = "/app/on-call/notifications";

async function origin(): Promise<string> {
  const h = await headers();
  return requestOrigin({ headers: h, nextUrl: new URL(`http://${h.get("host") ?? "localhost"}/`) });
}

/** "Send a test": a real notification through every step of the high-urgency rule. */
export async function sendTest() {
  const current = await requireMember();
  const base = await origin();
  await withTenant(current.tenant.id, (tx) =>
    notifyMember(
      tx,
      current.tenant.id,
      { id: current.member.id, name: current.member.name, email: current.member.email },
      {
        kind: "test",
        urgency: "high",
        subject: "Open Incident — test notification",
        text: `${current.member.name}, this is the test you asked for. Nothing is on fire.`,
        url: `${base}${PAGE}`,
        origin: base,
      },
    ),
  );
  revalidatePath(PAGE);
  redirect(`${PAGE}?test=1`);
}

/** Adds a phone (SMS or voice) and sends a 6-digit code through that very channel — the proof it works. */
export async function addPhoneMethod(formData: FormData) {
  const current = await requireMember();
  const kind = z.enum(["sms", "voice"]).parse(formData.get("kind"));
  const value = z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/)
    .safeParse(formData.get("value"));
  if (!value.success) redirect(`${PAGE}?error=phone`);
  if (!availableChannels().includes(kind)) redirect(`${PAGE}?error=unavailable`);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const base = await origin();
  const id = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
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
    return row!.id;
  });
  await deliverNotification({
    tenantId: current.tenant.id,
    deliveryId: await logVerification(current.tenant.id, current.member.id, kind, value.data),
    channel: kind,
    target: value.data,
    subject: "Open Incident verification",
    text: `Your code is ${code}`,
    origin: base,
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?verify=${id}`);
}

async function logVerification(
  tenantId: string,
  memberId: string,
  kind: NotifyChannel,
  target: string,
): Promise<string> {
  const { notificationDeliveries } = await import("@openincident/db");
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .insert(notificationDeliveries)
      .values({
        tenantId,
        memberId,
        methodKind: kind,
        target: `${target.slice(0, 4)}…${target.slice(-2)}`,
        kind: "verification",
        status: "queued",
        message: { subject: "verification", text: "" },
      })
      .returning({ id: notificationDeliveries.id });
    return row!.id;
  });
}

export async function verifyMethod(formData: FormData) {
  const current = await requireMember();
  const id = z.string().uuid().parse(formData.get("id"));
  const code = z
    .string()
    .trim()
    .regex(/^\d{6}$/)
    .safeParse(formData.get("code"));
  if (!code.success) redirect(`${PAGE}?verify=${id}&error=code`);
  const ok = await withTenant(current.tenant.id, async (tx) => {
    const [m] = await tx
      .select()
      .from(notificationMethods)
      .where(
        and(eq(notificationMethods.memberId, current.member.id), eq(notificationMethods.id, id)),
      );
    if (
      !m ||
      !m.verifyCodeHash ||
      !m.verifyExpiresAt ||
      m.verifyExpiresAt < new Date() ||
      m.verifyCodeHash !== hashCode(code.data)
    )
      return false;
    await tx
      .update(notificationMethods)
      .set({ verifiedAt: new Date(), verifyCodeHash: null, verifyExpiresAt: null })
      .where(eq(notificationMethods.id, id));
    return true;
  });
  revalidatePath(PAGE);
  redirect(ok ? `${PAGE}?verified=1` : `${PAGE}?verify=${id}&error=code`);
}

export async function removeMethod(formData: FormData) {
  const current = await requireMember();
  const id = z.string().uuid().parse(formData.get("id"));
  await withTenant(current.tenant.id, (tx) =>
    tx
      .delete(notificationMethods)
      .where(
        and(eq(notificationMethods.memberId, current.member.id), eq(notificationMethods.id, id)),
      ),
  );
  revalidatePath(PAGE);
}

/** The browser's push subscription becomes a verified method: the browser proved itself by subscribing. */
export async function addWebPushMethod(
  subscription: string,
  label: string,
): Promise<{ ok: boolean }> {
  const current = await requireMember();
  let parsed: { endpoint?: string };
  try {
    parsed = JSON.parse(subscription) as { endpoint?: string };
  } catch {
    return { ok: false };
  }
  if (!parsed.endpoint) return { ok: false };
  await withTenant(current.tenant.id, async (tx) => {
    const existing = await tx
      .select()
      .from(notificationMethods)
      .where(
        and(
          eq(notificationMethods.memberId, current.member.id),
          eq(notificationMethods.kind, "webpush"),
        ),
      );
    for (const m of existing)
      if ((JSON.parse(m.value) as { endpoint?: string }).endpoint === parsed.endpoint)
        await tx.delete(notificationMethods).where(eq(notificationMethods.id, m.id));
    await tx.insert(notificationMethods).values({
      tenantId: current.tenant.id,
      memberId: current.member.id,
      kind: "webpush",
      value: subscription,
      label: label.slice(0, 80),
      verifiedAt: new Date(),
    });
  });
  revalidatePath(PAGE);
  return { ok: true };
}

export async function saveShiftReminders(formData: FormData) {
  const current = await requireMember();
  await withTenant(current.tenant.id, (tx) =>
    tx
      .update(members)
      .set({
        shiftReminders: {
          beforeStart: formData.get("beforeStart") === "on",
          atEnd: formData.get("atEnd") === "on",
        },
      })
      .where(eq(members.id, current.member.id)),
  );
  revalidatePath(PAGE);
  redirect(`${PAGE}?saved=1`);
}

/** Adds a step to a rule (10 at most) or removes one. */
export async function updateRule(formData: FormData) {
  const current = await requireMember();
  const urgency = z.enum(["high", "low"]).parse(formData.get("urgency"));
  const op = z.enum(["add", "remove"]).parse(formData.get("op"));
  await withTenant(current.tenant.id, async (tx) => {
    const [rule] = await tx
      .select()
      .from(notificationRules)
      .where(
        and(
          eq(notificationRules.memberId, current.member.id),
          eq(notificationRules.urgency, urgency),
        ),
      );
    const { defaultSteps } = await import("@openincident/oncall");
    const steps = [...(rule?.steps ?? defaultSteps(urgency))];
    if (op === "add") {
      const kind = z.enum(["email", "sms", "voice", "webpush"]).parse(formData.get("kind"));
      const delay = z.coerce.number().int().min(0).max(120).parse(formData.get("delayMinutes"));
      if (steps.length < 10) steps.push({ kind, delayMinutes: delay });
      steps.sort((a, b) => a.delayMinutes - b.delayMinutes);
    } else {
      const index = z.coerce.number().int().min(0).parse(formData.get("index"));
      steps.splice(index, 1);
    }
    if (rule)
      await tx
        .update(notificationRules)
        .set({ steps, updatedAt: new Date() })
        .where(eq(notificationRules.id, rule.id));
    else
      await tx
        .insert(notificationRules)
        .values({ tenantId: current.tenant.id, memberId: current.member.id, urgency, steps });
  });
  revalidatePath(PAGE);
}

/** Links the member's Slack user (by email, through the workspace's Slack app) as a verified DM method. */

/**
 * A chat account just linked pages its owner: the high-urgency rule gains the
 * channel at delay 0 when it has one and lacks it. Members without a rule
 * already get it through the default steps; the step can be removed like any other.
 */
async function ensureHighUrgencyStep(tx: Tx, memberId: string, kind: "slack" | "teams") {
  const [rule] = await tx
    .select()
    .from(notificationRules)
    .where(and(eq(notificationRules.memberId, memberId), eq(notificationRules.urgency, "high")));
  if (!rule || rule.steps.some((s) => s.kind === kind) || rule.steps.length >= 10) return;
  await tx
    .update(notificationRules)
    .set({ steps: [{ kind, delayMinutes: 0 }, ...rule.steps], updatedAt: new Date() })
    .where(eq(notificationRules.id, rule.id));
}

export async function linkSlackMethod() {
  const current = await requireMember();
  const ok = await withTenant(current.tenant.id, async (tx) => {
    const install = await getSlackInstall(tx, current.tenant.id);
    if (!install) return false;
    const userId = await linkSlackIdentity(tx, current.tenant.id, slack(install.token), {
      id: current.member.id,
      email: current.member.email,
    });
    if (!userId) return false;
    const existing = await tx
      .select({ id: notificationMethods.id })
      .from(notificationMethods)
      .where(
        and(
          eq(notificationMethods.memberId, current.member.id),
          eq(notificationMethods.kind, "slack"),
        ),
      );
    if (existing.length === 0)
      await tx.insert(notificationMethods).values({
        tenantId: current.tenant.id,
        memberId: current.member.id,
        kind: "slack",
        value: userId,
        label: install.teamName,
        verifiedAt: new Date(),
      });
    await ensureHighUrgencyStep(tx, current.member.id, "slack");
    return true;
  });
  revalidatePath(PAGE);
  redirect(ok ? `${PAGE}?verified=1` : `${PAGE}?error=slack`);
}

/** Teams DM as a notification method: the member's Azure AD user, found by email through Graph. */
export async function linkTeamsMethod() {
  const current = await requireMember();
  const ok = await withTenant(current.tenant.id, async (tx) => {
    const install = await getTeamsInstall(tx, current.tenant.id);
    if (!install) return false;
    const userId = await linkTeamsIdentity(tx, current.tenant.id, install, {
      id: current.member.id,
      email: current.member.email,
    });
    if (!userId) return false;
    const existing = await tx
      .select({ id: notificationMethods.id })
      .from(notificationMethods)
      .where(
        and(
          eq(notificationMethods.memberId, current.member.id),
          eq(notificationMethods.kind, "teams"),
        ),
      );
    if (existing.length === 0)
      await tx.insert(notificationMethods).values({
        tenantId: current.tenant.id,
        memberId: current.member.id,
        kind: "teams",
        value: userId,
        label: install.teamName,
        verifiedAt: new Date(),
      });
    await ensureHighUrgencyStep(tx, current.member.id, "teams");
    return true;
  });
  revalidatePath(PAGE);
  redirect(ok ? `${PAGE}?verified=1` : `${PAGE}?error=teams`);
}
