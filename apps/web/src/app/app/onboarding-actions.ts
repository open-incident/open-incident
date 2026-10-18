"use server";

/**
 * The three steps of the home, done where they are read.
 *
 * Every one of these already existed behind a screen of its own — a phone on
 * the notifications tab, an invitation in the members settings, a monitor in
 * Monitors, a source in Alerts, a test page in the rail. The home used to
 * point at those screens, which meant the first thing a new workspace did was
 * leave the page that was explaining itself, four times.
 *
 * So these are the same gestures, answering instead of navigating: each returns
 * what the card should show, and the card stays where the reader is. Nothing
 * here is a second implementation — the phone goes through the same
 * verification, the source through the same creation, the test through the
 * same notification path a P1 takes.
 */

import { randomInt } from "node:crypto";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  alertSources,
  escalationPathVersions,
  escalationPaths,
  members,
  monitors,
  notificationDeliveries,
  notificationMethods,
  withTenant,
  type EscalationGraph,
  type Tx,
} from "@openincident/db";
import {
  availableChannels,
  defaultHttpCriteria,
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
import { SOURCE_KINDS } from "@/lib/alert-sources";
import { createSource } from "@/app/app/settings/alert-sources/actions";
import { SKIP_COOKIE } from "./home-skip";
import { maskEmail, maskPhone } from "./page-me-mask";

const HOME = "/app";

async function origin(): Promise<string> {
  const h = await headers();
  return requestOrigin({ headers: h, nextUrl: new URL(`http://${h.get("host") ?? "localhost"}/`) });
}

export type StepAnswer = { ok?: true; error?: string; methodId?: string; note?: string };

/* ---------- Step 1: who is paged ---------- */

/**
 * The phone the pager calls, and the code that proves it.
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
    .transform((v) => v.replace(/[\s.()-]/g, ""))
    .pipe(z.string().regex(/^\+[1-9]\d{6,14}$/))
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
  const verified = await withTenant(current.tenant.id, async (tx) => {
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
      return null;
    await tx
      .update(notificationMethods)
      .set({ verifiedAt: new Date(), verifyCodeHash: null, verifyExpiresAt: null })
      .where(eq(notificationMethods.id, m.id));
    return m.value;
  });
  return verified ? { ok: true, note: maskPhone(verified) } : { error: t("home.err.code") };
}

/** The path that pages this member, named on the rule that catches every alert. */
async function wireMember(
  tx: Tx,
  current: Awaited<ReturnType<typeof requireMember>>,
  target: { id: string; name: string },
  t: Awaited<ReturnType<typeof getT>>,
): Promise<string> {
  const path = await ensureQuickPath(
    tx,
    current.tenant.id,
    { memberId: current.member.id },
    { kind: "member", memberId: target.id },
    t("setup.quickPath.member", { name: target.name }),
  );
  await pageWithPath(tx, current.tenant.id, path.id, t("setup.catchAll"), t("setup.catchAllDesc"));
  await recordAudit(tx, current, "config", "alerting.page_me", { path: path.name });
  return path.id;
}

/**
 * "Continue to alerts" with « Me » picked: the click that makes the pager
 * reach you.
 *
 * A verified phone is a channel, not an answer: until a rule names a path that
 * names somebody, a workspace's alerts reach nobody through a perfectly
 * verified number. So this builds the path that pages this member and names
 * it on the rule that catches everything.
 */
export async function pageMeFirst(): Promise<StepAnswer> {
  const current = await requireResponder();
  const t = await getT();
  await withTenant(current.tenant.id, (tx) =>
    wireMember(tx, current, { id: current.member.id, name: current.member.name }, t),
  );
  revalidatePath(HOME);
  return { ok: true };
}

/** Invites somebody by email, the same invitation the members settings sends. */
async function invite(
  current: Awaited<ReturnType<typeof requireManager>>,
  email: string,
): Promise<{ id: string; email: string; name: string } | null> {
  const row = await withTenant(current.tenant.id, async (tx) => {
    const name = (email.split("@")[0] ?? email)
      .split(/[._-]+/)
      .filter(Boolean)
      .map((p) => p[0]!.toUpperCase() + p.slice(1))
      .join(" ");
    const [created] = await tx
      .insert(members)
      .values({
        tenantId: current.tenant.id,
        email,
        name: name || email,
        role: "responder",
        status: "invited",
      })
      .onConflictDoNothing()
      .returning({ id: members.id, email: members.email, name: members.name });
    if (created)
      await recordAudit(tx, current, "members", "member.invited", { email, role: "responder" });
    return created ?? null;
  });
  if (row) await sendMemberInvite(current.tenant, current.workspace.name, row, current.member.name);
  return row;
}

/**
 * Step 1b — somebody paged after you.
 *
 * The invitation, and then the part that makes the sentence true: the path
 * that pages you gets a second level naming them, five minutes after yours.
 * A workspace of one has nobody behind it, and the step says so rather than
 * letting the reader find out on the night they do not hear their phone.
 */
export async function inviteBackup(_prev: unknown, formData: FormData): Promise<StepAnswer> {
  const current = await requireManager();
  const t = await getT();
  const email = z.string().trim().toLowerCase().email().safeParse(formData.get("email"));
  if (!email.success) return { error: t("home.err.email") };
  const row = await invite(current, email.data);
  if (!row) return { error: t("home.err.emailTaken") };
  await withTenant(current.tenant.id, async (tx) => {
    const pathId = await wireMember(
      tx,
      current,
      { id: current.member.id, name: current.member.name },
      t,
    );
    await secondLevel(tx, current.tenant.id, pathId, row.id, current.member.id);
  });
  revalidatePath(HOME);
  return { ok: true, note: row.name };
}

/** Publishes a new version of the path whose second level pages `memberId`. */
async function secondLevel(
  tx: Tx,
  tenantId: string,
  pathId: string,
  memberId: string,
  actorId: string,
): Promise<void> {
  const [current] = await tx
    .select({ graph: escalationPathVersions.graph, version: escalationPathVersions.version })
    .from(escalationPaths)
    .innerJoin(
      escalationPathVersions,
      eq(escalationPathVersions.id, escalationPaths.currentVersionId),
    )
    .where(and(eq(escalationPaths.tenantId, tenantId), eq(escalationPaths.id, pathId)));
  if (!current) return;
  const [latest] = await tx
    .select({ version: escalationPathVersions.version })
    .from(escalationPathVersions)
    .where(eq(escalationPathVersions.pathId, pathId))
    .orderBy(desc(escalationPathVersions.version))
    .limit(1);
  const nodes = current.graph.nodes.filter((n) => n.id !== "backup");
  const first = nodes.find((n) => n.id === current.graph.start);
  if (!first || first.kind !== "level") return;
  const graph: EscalationGraph = {
    start: current.graph.start,
    nodes: [
      ...nodes.map((n) => (n.id === first.id ? { ...first, next: "backup" } : n)),
      {
        id: "backup",
        kind: "level",
        targets: [{ kind: "member", memberId }],
        urgency: "high",
        ackTimeoutMinutes: 5,
        retries: 2,
        retryIntervalMinutes: 3,
        next: null,
      },
    ],
  };
  const [version] = await tx
    .insert(escalationPathVersions)
    .values({
      tenantId,
      pathId,
      version: (latest?.version ?? current.version) + 1,
      graph,
      publishedByMemberId: actorId,
    })
    .returning({ id: escalationPathVersions.id });
  await tx
    .update(escalationPaths)
    .set({ currentVersionId: version!.id, updatedAt: new Date() })
    .where(eq(escalationPaths.id, pathId));
}

/**
 * « A teammate »: they are invited, verify their own phone from the
 * invitation, and the rule that catches every alert pages them.
 */
export async function inviteMate(_prev: unknown, formData: FormData): Promise<StepAnswer> {
  const current = await requireManager();
  const t = await getT();
  const email = z.string().trim().toLowerCase().email().safeParse(formData.get("email"));
  if (!email.success) return { error: t("home.err.email") };
  const row = await invite(current, email.data);
  if (!row) return { error: t("home.err.emailTaken") };
  await withTenant(current.tenant.id, (tx) =>
    wireMember(tx, current, { id: row.id, name: row.name }, t),
  );
  revalidatePath(HOME);
  return { ok: true, note: row.name };
}

/* ---------- Step 2: where alerts come from ---------- */

export type SourceAnswer = { endpoint?: string; secret?: string; name?: string; error?: string };

/**
 * A tool picked in the grid becomes a source named after it — "Datadog", or
 * "Datadog 2" when one already goes by that name — that pages the reader,
 * opens an incident when the alert is urgent and resolves itself. The same
 * creation the Alerts screen does; its URL and secret come back once.
 */
export async function createToolSource(_prev: unknown, formData: FormData): Promise<SourceAnswer> {
  const current = await requireManager();
  const meta = SOURCE_KINDS.find((k) => k.kind === formData.get("kind"));
  if (!meta) return { error: "invalid" };
  const taken = new Set(
    (
      await withTenant(current.tenant.id, (tx) =>
        tx
          .select({ name: alertSources.name })
          .from(alertSources)
          .where(eq(alertSources.tenantId, current.tenant.id)),
      )
    ).map((r) => r.name),
  );
  let name = meta.short;
  for (let n = 2; taken.has(name); n++) name = `${meta.short} ${n}`;
  const fd = new FormData();
  fd.set("kind", meta.kind);
  fd.set("name", name);
  fd.set("page", "me");
  fd.set("incident", "urgent");
  fd.set("autoResolve", "on");
  const created = await createSource(null, fd);
  if (!created.endpoint || !created.secret) return { error: created.error ?? "invalid" };
  revalidatePath(HOME);
  return { endpoint: created.endpoint, secret: created.secret, name };
}

/**
 * The other half — a URL we watch.
 *
 * The same monitor the Monitors screen creates, with the defaults that screen
 * would have offered: every minute, online on a 200 in under two seconds,
 * offline — and an alert — when it does not answer.
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
      criteria: defaultHttpCriteria(2000),
      // What the card promised: you are paged, an incident opens when it is
      // urgent, and it resolves itself.
      action: {
        page: { kind: "member", memberId: current.member.id },
        incident: { from: "urgent" },
        autoResolve: true,
      },
    });
    await recordAudit(tx, current, "config", "monitor.created", { name: host, type: "http" });
  });
  revalidatePath("/app/monitors");
  revalidatePath(HOME);
  return { ok: true, note: host };
}

/* ---------- Step 3: the only proof ---------- */

export type TestLine = {
  id: string;
  channel: string;
  /** Masked: "am…@skylark.dev", "+33 6 •• •• 78". */
  target: string;
  delayMinutes: number;
};
export type TestAnswer = { error?: string; startedAt?: string; lines?: TestLine[] };

/**
 * A real notification through the reader's own high-urgency rule, marked as a
 * test everywhere it lands. An instance with no channel at all says so instead
 * of pretending: a button that claims to ring and does not is worse than no
 * button on the screen whose job is to establish trust.
 *
 * It does not refresh the home: the card stays up to follow the page out, and
 * the reader says when it reached them.
 */
export async function sendFirstPage(): Promise<TestAnswer> {
  const current = await requireMember();
  const t = await getT();
  if (availableChannels().length === 0) return { error: t("shell.pageMeUnavailable") };
  const base = await origin();
  const startedAt = new Date();
  const lines = await withTenant(current.tenant.id, async (tx) => {
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
    const phones = await tx
      .select({ kind: notificationMethods.kind, value: notificationMethods.value })
      .from(notificationMethods)
      .where(
        and(
          eq(notificationMethods.tenantId, current.tenant.id),
          eq(notificationMethods.memberId, current.member.id),
          inArray(notificationMethods.kind, ["sms", "voice"]),
        ),
      );
    const phone = (kind: string) => phones.find((p) => p.kind === kind)?.value ?? null;
    return sent.map((d) => ({
      id: d.deliveryId,
      channel: d.channel,
      target:
        d.channel === "email"
          ? maskEmail(current.member.email)
          : d.channel === "sms" || d.channel === "voice"
            ? maskPhone(phone(d.channel) ?? "")
            : "",
      delayMinutes: d.delayMinutes,
    }));
  });
  return { startedAt: startedAt.toISOString(), lines };
}

export type TestStatus = { id: string; status: string; at: string | null };

/** Where each message of the test page is — read again while the card watches. */
export async function testPageStatus(ids: string[]): Promise<TestStatus[]> {
  const current = await requireMember();
  const valid = ids.filter((id) => z.string().uuid().safeParse(id).success).slice(0, 12);
  if (valid.length === 0) return [];
  const rows = await withTenant(current.tenant.id, (tx) =>
    tx
      .select({
        id: notificationDeliveries.id,
        status: notificationDeliveries.status,
        sentAt: notificationDeliveries.sentAt,
        deliveredAt: notificationDeliveries.deliveredAt,
      })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.tenantId, current.tenant.id),
          eq(notificationDeliveries.memberId, current.member.id),
          inArray(notificationDeliveries.id, valid),
        ),
      ),
  );
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    at: (r.deliveredAt ?? r.sentAt)?.toISOString() ?? null,
  }));
}

/** "I acknowledged on my phone" — the home is read again, and finds itself set. */
export async function finishSetup(): Promise<void> {
  await requireMember();
  revalidatePath(HOME);
}

/* ---------- Putting the steps aside ---------- */

/** "Skip for now → explore the workspace", for this member's browser. */
export async function skipSetup(): Promise<void> {
  await requireMember();
  (await cookies()).set(SKIP_COOKIE, "1", {
    path: "/app",
    httpOnly: true,
    sameSite: "lax",
    secure: (await origin()).startsWith("https:"),
    maxAge: 60 * 60 * 24 * 90,
  });
  revalidatePath(HOME);
}

/** Brings the steps back on Home — from Guide › Getting started. */
export async function showSetup(): Promise<void> {
  await requireMember();
  (await cookies()).delete({ name: SKIP_COOKIE, path: "/app" });
  revalidatePath(HOME);
  revalidatePath("/app/guide");
}
