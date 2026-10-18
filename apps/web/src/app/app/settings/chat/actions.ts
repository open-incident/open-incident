"use server";

/**
 * Settings › Slack & Teams — every control of the page does the real thing
 * here: the switches patch the install's config (never replace it), the
 * wizard steps save and test for real, a member is linked by email or by
 * hand, a tool is disconnected. Managers only; every change has its audit
 * line.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  chatIdentities,
  forgetApiKeyLookup,
  integrationInstalls,
  members,
  notificationMethods,
  notificationRules,
  withTenant,
  type ChatProvider,
  type Tx,
} from "@openincident/db";
import {
  disconnectTeams,
  getSlackInstall,
  getTeamsInstall,
  getTeamsPairing,
  linkSlackIdentity,
  linkTeamsIdentity,
  patchChatConfig,
  recordChatEvent,
  sendSlackTest,
  sendTeamsTest,
  slack,
  startTeamsPairing,
  teamRoster,
} from "@openincident/chat";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";
import { requestOrigin } from "@/lib/tenant";

const PAGE = "/app/settings/chat";
const providerSchema = z.enum(["slack", "teams"]);

export type ActionResult = { ok: true; detail?: string } | { ok: false; error: string };

async function origin(): Promise<string> {
  const h = await headers();
  return requestOrigin({
    headers: h,
    nextUrl: new URL(`http://${h.get("host") ?? "localhost"}/`),
  });
}

/* ---------- The switches of the sections ---------- */

const settingSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("channelMode"), value: z.enum(["auto", "none"]) }),
  z.object({
    key: z.literal("channelPrefix"),
    value: z
      .string()
      .trim()
      .regex(/^[a-z0-9_-]{1,20}$/),
  }),
  z.object({ key: z.literal("autoInvite"), value: z.boolean() }),
  z.object({ key: z.literal("inviteOnCall"), value: z.boolean() }),
  z.object({ key: z.literal("dmPages"), value: z.boolean() }),
  z.object({ key: z.literal("postRca"), value: z.boolean() }),
  z.object({ key: z.literal("atlasDrafts"), value: z.boolean() }),
  /** "id|name", or "" for none. */
  z.object({ key: z.literal("announce"), value: z.string().max(300) }),
]);

export async function saveChatSetting(
  provider: ChatProvider,
  input: { key: string; value: unknown },
): Promise<ActionResult> {
  const current = await requireManager();
  const p = providerSchema.safeParse(provider);
  const parsed = settingSchema.safeParse(input);
  if (!p.success || !parsed.success) return { ok: false, error: "invalid" };
  const { key, value } = parsed.data;
  let patch: Record<string, unknown>;
  if (key === "announce") {
    const [id, ...name] = value ? value.split("|") : [""];
    patch = {
      announceChannelId: id || null,
      announceChannelName: id ? name.join("|").replace(/^#/, "") || null : null,
    };
  } else patch = { [key]: value };
  const done = await withTenant(current.tenant.id, async (tx) => {
    const ok = await patchChatConfig(tx, current.tenant.id, p.data, patch);
    if (ok) await recordAudit(tx, current, "config", `${p.data}.configured`, { [key]: value });
    return ok;
  });
  revalidatePath(PAGE);
  return done ? { ok: true } : { ok: false, error: "not_connected" };
}

/* ---------- The wizard ---------- */

/** Step 2 of either wizard: mode, prefix, announcement channel, invitations. */
export async function saveWizardConfig(formData: FormData) {
  const current = await requireManager();
  const parsed = z
    .object({
      provider: providerSchema,
      channelMode: z.enum(["auto", "none"]),
      channelPrefix: z
        .string()
        .trim()
        .regex(/^[a-z0-9_-]{1,20}$/),
      announce: z.string().max(300),
      autoInvite: z.string().optional(),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  const provider = String(formData.get("provider") ?? "slack");
  if (!parsed.success) redirect(`${PAGE}?connect=${provider}&step=2&error=invalid`);
  const input = parsed.data;
  const [id, ...name] = input.announce ? input.announce.split("|") : [""];
  await withTenant(current.tenant.id, async (tx) => {
    await patchChatConfig(tx, current.tenant.id, input.provider, {
      channelMode: input.channelMode,
      channelPrefix: input.channelPrefix,
      announceChannelId: id || null,
      announceChannelName: id ? name.join("|").replace(/^#/, "") || null : null,
      autoInvite: input.autoInvite === "on",
    });
    await recordAudit(tx, current, "config", `${input.provider}.configured`, {
      channelMode: input.channelMode,
      announce: id ? name.join("|") : null,
    });
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?connect=${input.provider}&step=3`);
}

async function sendTest(provider: ChatProvider) {
  const current = await requireManager();
  const url = `${await origin()}/app/incidents`;
  const by = {
    memberId: current.member.id,
    name: current.member.name,
    email: current.member.email,
  };
  return provider === "slack"
    ? sendSlackTest(current.tenant.id, by, current.tenant.slug, url)
    : sendTeamsTest(current.tenant.id, by, current.workspace.name, url);
}

/** Step 3: a real message (Slack) or card (Teams); the result is the page's to say. */
export async function testFromWizard(formData: FormData) {
  const provider = providerSchema.parse(formData.get("provider"));
  const r = await sendTest(provider);
  revalidatePath(PAGE);
  redirect(
    `${PAGE}?connect=${provider}&step=3&${
      r.ok
        ? `tested=${encodeURIComponent(r.where)}`
        : `testError=${encodeURIComponent(r.error ?? "failed")}`
    }`,
  );
}

/** Health › Send a test message / card. */
export async function testFromHealth(provider: ChatProvider): Promise<ActionResult> {
  const p = providerSchema.parse(provider);
  const r = await sendTest(p);
  revalidatePath(PAGE);
  return r.ok ? { ok: true, detail: r.where } : { ok: false, error: r.error ?? "failed" };
}

/**
 * The pairing code of the Teams wizard — "Connect Microsoft Teams" and Health
 * › "New pairing code". A code still valid is kept, so that reopening the
 * wizard does not invalidate the one already typed in Teams.
 */
export async function startPairing(formData: FormData) {
  const current = await requireManager();
  const fresh = formData.get("fresh") === "1";
  await withTenant(current.tenant.id, async (tx) => {
    const pending = fresh ? null : await getTeamsPairing(tx, current.tenant.id);
    if (pending) return;
    await startTeamsPairing(tx, current.tenant.id, current.member.id);
    await recordAudit(tx, current, "config", "teams.pairing_started", {});
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?connect=teams&step=1`);
}

/* ---------- Health › Disconnect ---------- */

export async function disconnectProvider(provider: ChatProvider): Promise<ActionResult> {
  const current = await requireManager();
  const p = providerSchema.parse(provider);
  if (p === "slack") {
    const teamId = await withTenant(current.tenant.id, async (tx) => {
      const install = await getSlackInstall(tx, current.tenant.id);
      if (!install) return null;
      await tx
        .update(integrationInstalls)
        .set({ status: "revoked", encryptedSecrets: null, updatedAt: new Date() })
        .where(eq(integrationInstalls.id, install.id));
      await recordAudit(tx, current, "config", "slack.disconnected", { team: install.teamName });
      return install.teamId;
    });
    if (teamId) await forgetApiKeyLookup(`slack:${teamId}`);
  } else {
    await withTenant(current.tenant.id, async (tx) => {
      const install = await disconnectTeams(tx, current.tenant.id);
      await recordAudit(tx, current, "config", "teams.disconnected", {
        team: install?.teamName ?? null,
      });
    });
  }
  revalidatePath(PAGE);
  revalidatePath("/app/settings/integrations");
  return { ok: true };
}

/* ---------- People ---------- */

export type LinkResult =
  | { ok: true; how: "email" | "hand" }
  | {
      ok: false;
      error: string;
      accounts?: Array<{ id: string; name: string; email: string | null }>;
    };

/**
 * "Link" — by email first, the way a member is matched when they act. When no
 * account uses that address, the accounts of the tool nobody is linked to yet
 * come back for a person to pick from.
 */
export async function linkMember(provider: ChatProvider, memberId: string): Promise<LinkResult> {
  const current = await requireManager();
  const p = providerSchema.parse(provider);
  const id = z.string().uuid().parse(memberId);
  return withTenant(current.tenant.id, async (tx) => {
    const [m] = await tx
      .select({ id: members.id, name: members.name, email: members.email })
      .from(members)
      .where(and(eq(members.tenantId, current.tenant.id), eq(members.id, id)));
    if (!m) return { ok: false, error: "unknown_member" };
    const taken = new Set(
      (
        await tx
          .select({ ext: chatIdentities.externalUserId })
          .from(chatIdentities)
          .where(and(eq(chatIdentities.tenantId, current.tenant.id), eq(chatIdentities.kind, p)))
      ).map((r) => r.ext),
    );
    if (p === "slack") {
      const install = await getSlackInstall(tx, current.tenant.id);
      if (!install) return { ok: false, error: "not_connected" };
      const api = slack(install.token);
      const found = await linkSlackIdentity(tx, current.tenant.id, api, m);
      if (found) {
        await ensureChatMethod(tx, current.tenant.id, p, m.id, found);
        await recordAudit(tx, current, "members", "slack.member_linked", {
          member: m.name,
          how: "email",
        });
        revalidatePath(PAGE);
        return { ok: true, how: "email" };
      }
      const users = await api.listUsers().catch(() => []);
      return {
        ok: false,
        error: "no_match",
        accounts: users
          .filter((u) => !taken.has(u.id))
          .map((u) => ({
            id: u.id,
            name: u.real_name ?? u.profile?.real_name ?? u.name ?? u.id,
            email: u.profile?.email ?? null,
          }))
          .slice(0, 200),
      };
    }
    const install = await getTeamsInstall(tx, current.tenant.id);
    if (!install) return { ok: false, error: "not_connected" };
    const found = await linkTeamsIdentity(tx, current.tenant.id, install, m);
    if (found) {
      await ensureChatMethod(tx, current.tenant.id, p, m.id, found);
      await recordAudit(tx, current, "members", "teams.member_linked", {
        member: m.name,
        how: "email",
      });
      revalidatePath(PAGE);
      return { ok: true, how: "email" };
    }
    const roster = await teamRoster(install).catch(() => []);
    return {
      ok: false,
      error: "no_match",
      accounts: roster
        .filter((u) => u.aadObjectId && !taken.has(u.aadObjectId))
        .map((u) => ({
          id: u.aadObjectId!,
          name: u.name ?? u.email ?? u.aadObjectId!,
          email: u.email,
        }))
        .slice(0, 200),
    };
  });
}

/** "Link by hand": the account a person picked. Remembered like an email match. */
export async function linkMemberTo(
  provider: ChatProvider,
  memberId: string,
  externalUserId: string,
): Promise<ActionResult> {
  const current = await requireManager();
  const p = providerSchema.parse(provider);
  const id = z.string().uuid().parse(memberId);
  const ext = z
    .string()
    .trim()
    .min(2)
    .max(120)
    .regex(/^[A-Za-z0-9:_.@-]+$/)
    .parse(externalUserId);
  return withTenant(current.tenant.id, async (tx) => {
    const [m] = await tx
      .select({ id: members.id, name: members.name, email: members.email })
      .from(members)
      .where(and(eq(members.tenantId, current.tenant.id), eq(members.id, id)));
    if (!m) return { ok: false, error: "unknown_member" };
    const [other] = await tx
      .select({ memberId: chatIdentities.memberId })
      .from(chatIdentities)
      .where(
        and(
          eq(chatIdentities.tenantId, current.tenant.id),
          eq(chatIdentities.kind, p),
          eq(chatIdentities.externalUserId, ext),
        ),
      );
    if (other && other.memberId !== m.id) return { ok: false, error: "already_linked" };
    await tx
      .delete(chatIdentities)
      .where(and(eq(chatIdentities.memberId, m.id), eq(chatIdentities.kind, p)));
    await tx
      .insert(chatIdentities)
      .values({ tenantId: current.tenant.id, memberId: m.id, kind: p, externalUserId: ext });
    await ensureChatMethod(tx, current.tenant.id, p, m.id, ext);
    await recordChatEvent(
      current.tenant.id,
      {
        provider: p,
        kind: "lookup",
        target: m.name,
        detail: m.email,
        memberId: m.id,
        meta: { byHand: true, by: current.member.name },
      },
      tx,
    );
    await recordAudit(tx, current, "members", `${p}.member_linked`, {
      member: m.name,
      how: "hand",
    });
    revalidatePath(PAGE);
    return { ok: true };
  });
}

/**
 * A member whose high-urgency rule already names the tool can be paged there
 * as soon as their account is known: the method the pager reads is created
 * with the link (verified — the account was matched or picked by an admin).
 */
async function ensureChatMethod(
  tx: Tx,
  tenantId: string,
  provider: ChatProvider,
  memberId: string,
  externalUserId: string,
): Promise<void> {
  const [rule] = await tx
    .select({ steps: notificationRules.steps })
    .from(notificationRules)
    .where(and(eq(notificationRules.memberId, memberId), eq(notificationRules.urgency, "high")));
  if (!rule?.steps.some((s) => s.kind === provider)) return;
  const [existing] = await tx
    .select({ id: notificationMethods.id })
    .from(notificationMethods)
    .where(and(eq(notificationMethods.memberId, memberId), eq(notificationMethods.kind, provider)));
  if (existing)
    await tx
      .update(notificationMethods)
      .set({ value: externalUserId, verifiedAt: new Date() })
      .where(eq(notificationMethods.id, existing.id));
  else
    await tx.insert(notificationMethods).values({
      tenantId,
      memberId,
      kind: provider,
      value: externalUserId,
      label: provider === "slack" ? "Slack" : "Microsoft Teams",
      verifiedAt: new Date(),
    });
}
