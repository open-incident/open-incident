"use server";

import { redirect } from "next/navigation";
import { docsTarget, testDocs } from "@openincident/docs";
import { encryptSecret } from "@openincident/crypto";
import { syncTrackerStatuses, testTracker, trackerTarget } from "@openincident/trackers";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { forgetApiKeyLookup, integrationInstalls, withTenant } from "@openincident/db";
import {
  disconnectTeams,
  getSlackInstall,
  getTeamsInstall,
  saveTeamsConfig as saveTeamsConfigRow,
  slack,
  startTeamsPairing,
  teamsConnector,
  textActivity,
} from "@openincident/chat";
import type { SlackConfig } from "@openincident/db";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";
import { requestOrigin } from "@/lib/tenant";
import { headers } from "next/headers";

const PAGE = "/app/settings/integrations";

/** Step 2 of the Slack connect flow: channel mode, prefix, announcement channel, auto-invite. */
export async function saveSlackConfig(formData: FormData) {
  const current = await requireManager();
  const parsed = z
    .object({
      channelMode: z.enum(["auto", "none"]),
      channelPrefix: z
        .string()
        .trim()
        .regex(/^[a-z0-9_-]{1,20}$/),
      announceChannelId: z.string().trim().max(40),
      announceChannelName: z.string().trim().max(80).optional(),
      autoInvite: z.string().optional(),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect(`${PAGE}?connect=slack&step=2&error=invalid`);
  const input = parsed.data;
  await withTenant(current.tenant.id, async (tx) => {
    const install = await getSlackInstall(tx, current.tenant.id);
    if (!install) return;
    const config: SlackConfig = {
      channelMode: input.channelMode,
      channelPrefix: input.channelPrefix,
      announceChannelId: input.announceChannelId || null,
      announceChannelName: input.announceChannelId
        ? String(formData.get(`channelName_${input.announceChannelId}`) ?? "") || null
        : null,
      autoInvite: input.autoInvite === "on",
    };
    await tx
      .update(integrationInstalls)
      .set({ config, updatedAt: new Date() })
      .where(eq(integrationInstalls.id, install.id));
    await recordAudit(tx, current, "config", "slack.configured", {
      channelMode: config.channelMode,
      announceChannel: config.announceChannelName,
    });
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?connect=slack&step=3`);
}

/** Step 3: a real message in the announcement channel (or to the installer when none is set). */
export async function testSlack() {
  const current = await requireManager();
  const h = await headers();
  const origin = requestOrigin({
    headers: h,
    nextUrl: new URL(`http://${h.get("host") ?? "localhost"}/`),
  });
  const outcome = await withTenant(current.tenant.id, async (tx) => {
    const install = await getSlackInstall(tx, current.tenant.id);
    if (!install) return { ok: false, where: "" };
    const api = slack(install.token);
    let channel = install.config.announceChannelId;
    if (!channel) {
      const me = await api.lookupByEmail(current.member.email);
      channel = me ? ((await api.openDm(me.id)) ?? me.id) : null;
    }
    if (!channel) return { ok: false, where: "" };
    const r = await api.postMessage(
      channel,
      `Open Incident is connected to ${current.tenant.slug} — this is the test ${current.member.name} asked for. Nothing is on fire. ${origin}/app/incidents`,
    );
    return {
      ok: r.ok,
      where: install.config.announceChannelName ? `#${install.config.announceChannelName}` : "DM",
    };
  });
  revalidatePath(PAGE);
  redirect(
    `${PAGE}?connect=slack&step=3&tested=${outcome.ok ? encodeURIComponent(outcome.where) : "fail"}`,
  );
}

/** Revokes the install: the token is gone, the team lookup too, channels stay in Slack. */
export async function disconnectSlack() {
  const current = await requireManager();
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
  revalidatePath(PAGE);
  redirect(PAGE);
}

/** A video-call integration is a link template: saved, tested by opening it, removed. */
export async function saveBridge(formData: FormData) {
  const current = await requireManager();
  const parsed = z
    .object({ kind: z.enum(["meet", "zoom"]), template: z.string().trim().url().max(300) })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success)
    redirect(`${PAGE}?connect=${String(formData.get("kind") ?? "meet")}&error=invalid`);
  const { kind, template } = parsed.data;
  await withTenant(current.tenant.id, async (tx) => {
    // One war-room provider at a time: saving Meet revokes Zoom and vice versa.
    const rows = await tx
      .select()
      .from(integrationInstalls)
      .where(and(eq(integrationInstalls.tenantId, current.tenant.id)));
    for (const r of rows) {
      if ((r.kind === "meet" || r.kind === "zoom") && r.kind !== kind && r.status === "active")
        await tx
          .update(integrationInstalls)
          .set({ status: "revoked", updatedAt: new Date() })
          .where(eq(integrationInstalls.id, r.id));
    }
    const existing = rows.find((r) => r.kind === kind);
    if (existing)
      await tx
        .update(integrationInstalls)
        .set({ config: { template }, status: "active", updatedAt: new Date() })
        .where(eq(integrationInstalls.id, existing.id));
    else
      await tx.insert(integrationInstalls).values({
        tenantId: current.tenant.id,
        kind,
        config: { template },
        status: "active",
        installedByMemberId: current.member.id,
      });
    await recordAudit(tx, current, "config", "bridge.configured", { kind, template });
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?saved=${kind}`);
}

export async function removeBridge(formData: FormData) {
  const current = await requireManager();
  const kind = z.enum(["meet", "zoom"]).parse(formData.get("kind"));
  await withTenant(current.tenant.id, async (tx) => {
    await tx
      .update(integrationInstalls)
      .set({ status: "revoked", updatedAt: new Date() })
      .where(
        and(
          eq(integrationInstalls.tenantId, current.tenant.id),
          eq(integrationInstalls.kind, kind),
        ),
      );
    await recordAudit(tx, current, "config", "bridge.removed", { kind });
  });
  revalidatePath(PAGE);
  redirect(PAGE);
}

/* ---------- Issue trackers: GitHub Issues, Jira, Linear ---------- */

const trackerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("github"),
    repo: z
      .string()
      .trim()
      .regex(/^[\w.-]+\/[\w.-]+$/),
    secret: z.string().trim().min(8).max(400),
  }),
  z.object({
    kind: z.literal("gitlab"),
    project: z
      .string()
      .trim()
      .regex(/^[\w.-]+(\/[\w.-]+)+$|^\d+$/),
    secret: z.string().trim().min(8).max(400),
  }),
  z.object({
    kind: z.literal("jira"),
    site: z
      .string()
      .trim()
      .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i),
    email: z.string().trim().email(),
    projectKey: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{1,9}$/),
    issueType: z.string().trim().max(60).optional(),
    secret: z.string().trim().min(8).max(400),
  }),
  z.object({
    kind: z.literal("linear"),
    teamKey: z
      .string()
      .trim()
      .regex(/^[A-Z0-9]{1,8}$/),
    secret: z.string().trim().min(8).max(400),
  }),
]);

/**
 * Connecting a tracker: the credentials are tested against the vendor before
 * anything is stored; the secret is encrypted at rest and never shown again.
 */
export async function saveTracker(formData: FormData) {
  const current = await requireManager();
  const raw = Object.fromEntries(formData.entries());
  const parsed = trackerSchema.safeParse({ ...raw, issueType: raw.issueType || undefined });
  const kind = String(raw.kind ?? "github");
  if (!parsed.success) redirect(`${PAGE}?connect=${kind}&error=invalid`);
  const { secret, ...config } = parsed.data;
  const test = await testTracker(config, secret);
  if (!test.ok)
    redirect(
      `${PAGE}?connect=${kind}&error=test&detail=${encodeURIComponent(test.error.slice(0, 120))}`,
    );
  await withTenant(current.tenant.id, async (tx) => {
    const [existing] = await tx
      .select({ id: integrationInstalls.id })
      .from(integrationInstalls)
      .where(
        and(
          eq(integrationInstalls.tenantId, current.tenant.id),
          eq(integrationInstalls.kind, config.kind),
        ),
      );
    const values = {
      config: config as Record<string, unknown>,
      encryptedSecrets: encryptSecret(secret),
      externalName: test.detail,
      status: "active" as const,
      installedByMemberId: current.member.id,
      updatedAt: new Date(),
    };
    if (existing)
      await tx
        .update(integrationInstalls)
        .set(values)
        .where(eq(integrationInstalls.id, existing.id));
    else
      await tx
        .insert(integrationInstalls)
        .values({ tenantId: current.tenant.id, kind: config.kind, ...values });
    await recordAudit(tx, current, "config", "tracker.connected", {
      kind: config.kind,
      target: trackerTarget(config),
    });
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?saved=${config.kind}`);
}

export async function removeTracker(formData: FormData) {
  const current = await requireManager();
  const kind = z.enum(["github", "gitlab", "jira", "linear"]).parse(formData.get("kind"));
  await withTenant(current.tenant.id, async (tx) => {
    await tx
      .update(integrationInstalls)
      .set({ status: "revoked", encryptedSecrets: null, updatedAt: new Date() })
      .where(
        and(
          eq(integrationInstalls.tenantId, current.tenant.id),
          eq(integrationInstalls.kind, kind),
        ),
      );
    await recordAudit(tx, current, "config", "tracker.disconnected", { kind });
  });
  revalidatePath(PAGE);
  redirect(PAGE);
}

/** "Sync now": the same pass the worker runs every five minutes, on demand. */
export async function syncTrackersNow() {
  const current = await requireManager();
  const r = await syncTrackerStatuses(current.tenant.id);
  revalidatePath(PAGE);
  revalidatePath("/app/incidents");
  redirect(`${PAGE}?synced=${r.checked}&completed=${r.completed}&errors=${r.errors}`);
}

/* ---------- Microsoft Teams ---------- */

/** Step 1: a pairing code the admin types in the team's channel — valid fifteen minutes. */
export async function startTeamsPairingAction() {
  const current = await requireManager();
  await withTenant(current.tenant.id, async (tx) => {
    await startTeamsPairing(tx, current.tenant.id, current.member.id);
    await recordAudit(tx, current, "config", "teams.pairing_started", {});
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?connect=teams&step=1`);
}

/** Step 2: what the bot does in the paired team. */
export async function saveTeamsConfig(formData: FormData) {
  const current = await requireManager();
  const parsed = z
    .object({
      channelMode: z.enum(["auto", "none"]),
      channelPrefix: z
        .string()
        .trim()
        .regex(/^[a-z0-9_-]{0,20}$/i),
      announceChannel: z.string().trim().max(200),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect(`${PAGE}?connect=teams&step=2&error=invalid`);
  const [announceChannelId, ...nameParts] = parsed.data.announceChannel
    ? parsed.data.announceChannel.split("|")
    : [""];
  await withTenant(current.tenant.id, async (tx) => {
    await saveTeamsConfigRow(tx, current.tenant.id, {
      channelMode: parsed.data.channelMode,
      channelPrefix: parsed.data.channelPrefix || "inc-",
      announceChannelId: announceChannelId || null,
      announceChannelName: announceChannelId ? nameParts.join("|") || null : null,
    });
    await recordAudit(tx, current, "config", "teams.configured", {
      channelMode: parsed.data.channelMode,
      announce: nameParts.join("|") || null,
    });
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?connect=teams&step=3`);
}

/** Step 3: a card in the announcement channel (or the channel the pairing came from). */
export async function testTeams() {
  const current = await requireManager();
  const install = await withTenant(current.tenant.id, (tx) =>
    getTeamsInstall(tx, current.tenant.id),
  );
  if (!install) redirect(`${PAGE}?connect=teams&step=1`);
  const channelId = install.config.announceChannelId ?? install.config.generalChannelId;
  const r = await teamsConnector.startThread(
    install.config.serviceUrl,
    channelId,
    textActivity(
      `✅ Open Incident is connected to **${current.workspace.name}**. Incident channels and announcements will appear in this team.`,
    ),
    install.config.aadTenantId,
  );
  revalidatePath(PAGE);
  redirect(`${PAGE}?connect=teams&step=3&test=${r.ok ? "ok" : "failed"}`);
}

export async function disconnectTeamsAction() {
  const current = await requireManager();
  await withTenant(current.tenant.id, async (tx) => {
    const install = await disconnectTeams(tx, current.tenant.id);
    await recordAudit(tx, current, "config", "teams.disconnected", {
      team: install?.teamName ?? null,
    });
  });
  revalidatePath(PAGE);
  redirect(PAGE);
}

/* ---------- Documentation tools: Confluence, Notion ---------- */

const docsSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("confluence"),
    site: z
      .string()
      .trim()
      .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i),
    email: z.string().trim().email(),
    spaceKey: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_~]{1,255}$/),
    parentPageId: z.string().trim().max(40).optional(),
    secret: z.string().trim().min(8).max(400),
  }),
  z.object({
    kind: z.literal("notion"),
    parentPageId: z
      .string()
      .trim()
      .regex(/^[0-9a-f-]{32,36}$/i),
    secret: z.string().trim().min(8).max(400),
  }),
]);

/** Connecting a documentation tool: tested against the vendor first, secret encrypted at rest. */
export async function saveDocs(formData: FormData) {
  const current = await requireManager();
  const raw = Object.fromEntries(formData.entries());
  const parsed = docsSchema.safeParse({ ...raw, parentPageId: raw.parentPageId || undefined });
  const kind = String(raw.kind ?? "confluence");
  if (!parsed.success) redirect(`${PAGE}?connect=${kind}&error=invalid`);
  const { secret, ...config } = parsed.data;
  const test = await testDocs(config, secret);
  if (!test.ok)
    redirect(
      `${PAGE}?connect=${kind}&error=test&detail=${encodeURIComponent(test.error.slice(0, 120))}`,
    );
  await withTenant(current.tenant.id, async (tx) => {
    const [existing] = await tx
      .select({ id: integrationInstalls.id })
      .from(integrationInstalls)
      .where(
        and(
          eq(integrationInstalls.tenantId, current.tenant.id),
          eq(integrationInstalls.kind, config.kind),
        ),
      );
    const values = {
      config: config as Record<string, unknown>,
      encryptedSecrets: encryptSecret(secret),
      externalName: test.detail,
      status: "active" as const,
      installedByMemberId: current.member.id,
      updatedAt: new Date(),
    };
    if (existing)
      await tx
        .update(integrationInstalls)
        .set(values)
        .where(eq(integrationInstalls.id, existing.id));
    else
      await tx
        .insert(integrationInstalls)
        .values({ tenantId: current.tenant.id, kind: config.kind, ...values });
    await recordAudit(tx, current, "config", "docs.connected", {
      kind: config.kind,
      target: docsTarget(config),
    });
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?saved=${config.kind}`);
}

export async function removeDocs(formData: FormData) {
  const current = await requireManager();
  const kind = z.enum(["confluence", "notion"]).parse(formData.get("kind"));
  await withTenant(current.tenant.id, async (tx) => {
    await tx
      .update(integrationInstalls)
      .set({ status: "revoked", encryptedSecrets: null, updatedAt: new Date() })
      .where(
        and(
          eq(integrationInstalls.tenantId, current.tenant.id),
          eq(integrationInstalls.kind, kind),
        ),
      );
    await recordAudit(tx, current, "config", "docs.disconnected", { kind });
  });
  revalidatePath(PAGE);
  redirect(PAGE);
}
