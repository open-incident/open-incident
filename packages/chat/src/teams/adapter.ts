/**
 * The Teams side of the chat adapter — the same product words as Slack
 * (a channel for an incident, an update in it, a living announcement, a DM
 * that pages someone), spoken through the Bot Connector and Graph. The
 * instance owns one bot; a workspace pairs one team with it by typing a code.
 */
import { randomInt } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  announcements,
  chatIdentities,
  forgetApiKeyLookup,
  incidentChannels,
  incidents,
  integrationInstalls,
  members,
  registerApiKeyLookup,
  withTenant,
  type TeamsConfig,
  type Tx,
} from "@openincident/db";
import { incidentCard } from "../adapter";
import { markChatPageAcknowledged, recordChatEvent } from "../events";
import { channelPeople } from "../people";
import { chatSettings, type ChatSettings } from "../settings";
import {
  acknowledgedCard,
  announcementCard,
  atlasActedCard,
  atlasDraftCard,
  escalationDmCard,
  incidentHeaderCard,
  incidentUpdateCard,
  mentionActivity,
  testCard,
} from "./cards";
import { cardActivity, teamsConnector, textActivity } from "./client";
import { teamsGraph } from "./graph";
import { teamsConfigured } from "./config";

export const DEFAULT_TEAMS_CONFIG: Omit<
  TeamsConfig,
  "aadTenantId" | "serviceUrl" | "generalChannelId"
> = {
  channelMode: "auto",
  channelPrefix: "inc-",
  announceChannelId: null,
  announceChannelName: null,
};

export type TeamsInstall = {
  id: string;
  teamId: string;
  teamName: string;
  config: TeamsConfig;
  /** The switches of Settings › Slack & Teams, defaults filled in. */
  settings: ChatSettings;
  installedByMemberId: string | null;
  createdAt: Date;
};

function toInstall(row: typeof integrationInstalls.$inferSelect): TeamsInstall {
  return {
    id: row.id,
    teamId: row.externalId ?? "",
    teamName: row.externalName ?? row.externalId ?? "Microsoft Teams",
    config: { ...DEFAULT_TEAMS_CONFIG, ...(row.config as Partial<TeamsConfig>) } as TeamsConfig,
    settings: chatSettings(row.config),
    installedByMemberId: row.installedByMemberId,
    createdAt: row.createdAt,
  };
}

/** The paired team of the workspace — null until a pairing completed. */
export async function getTeamsInstall(tx: Tx, tenantId: string): Promise<TeamsInstall | null> {
  const [row] = await tx
    .select()
    .from(integrationInstalls)
    .where(
      and(
        eq(integrationInstalls.tenantId, tenantId),
        eq(integrationInstalls.kind, "teams"),
        eq(integrationInstalls.status, "active"),
      ),
    );
  return row && row.externalId ? toInstall(row) : null;
}

/**
 * The install, when this instance can actually speak to Teams: without the
 * bot's credentials (TEAMS_APP_ID, TEAMS_APP_SECRET) no token can be had, so
 * nothing is attempted — the settings screen says why instead.
 */
async function liveTeamsInstall(tx: Tx, tenantId: string): Promise<TeamsInstall | null> {
  return teamsConfigured() ? getTeamsInstall(tx, tenantId) : null;
}

/** A pairing waiting for its code, with the code — the settings screen shows it. */
export async function getTeamsPairing(
  tx: Tx,
  tenantId: string,
): Promise<{ code: string; expiresAt: Date } | null> {
  const [row] = await tx
    .select()
    .from(integrationInstalls)
    .where(
      and(
        eq(integrationInstalls.tenantId, tenantId),
        eq(integrationInstalls.kind, "teams"),
        eq(integrationInstalls.status, "pending"),
      ),
    );
  const cfg = row?.config as Partial<TeamsConfig> | undefined;
  if (!row || !cfg?.pairingCode || !cfg.pairingExpiresAt) return null;
  const expiresAt = new Date(cfg.pairingExpiresAt);
  return expiresAt.getTime() > Date.now() ? { code: cfg.pairingCode, expiresAt } : null;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode(): string {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

/** Starts (or restarts) a pairing: a six-character code valid fifteen minutes, findable from Teams. */
export async function startTeamsPairing(
  tx: Tx,
  tenantId: string,
  memberId: string,
): Promise<{ code: string; expiresAt: Date }> {
  const code = newCode();
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  const [existing] = await tx
    .select()
    .from(integrationInstalls)
    .where(and(eq(integrationInstalls.tenantId, tenantId), eq(integrationInstalls.kind, "teams")));
  const previous = (existing?.config as Partial<TeamsConfig> | undefined)?.pairingCode;
  const config = {
    ...DEFAULT_TEAMS_CONFIG,
    pairingCode: code,
    pairingExpiresAt: expiresAt.toISOString(),
  };
  if (existing && existing.status !== "active") {
    await tx
      .update(integrationInstalls)
      .set({ config, status: "pending", installedByMemberId: memberId, updatedAt: new Date() })
      .where(eq(integrationInstalls.id, existing.id));
  } else if (!existing) {
    await tx.insert(integrationInstalls).values({
      tenantId,
      kind: "teams",
      config,
      status: "pending",
      installedByMemberId: memberId,
    });
  } else {
    // Re-pairing an active install: keep it live, but accept the new code.
    await tx
      .update(integrationInstalls)
      .set({
        config: {
          ...(existing.config as object),
          pairingCode: code,
          pairingExpiresAt: expiresAt.toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(integrationInstalls.id, existing.id));
  }
  if (previous) await forgetApiKeyLookup(`teams-pair:${previous}`);
  await registerApiKeyLookup(`teams-pair:${code}`, tenantId);
  return { code, expiresAt };
}

export type PairingActivity = {
  teamId: string;
  teamName: string;
  aadTenantId: string;
  serviceUrl: string;
  generalChannelId: string;
  /** The organisation's domain, from the address of the person who typed the code. */
  tenantDomain?: string | null;
};

/** The code typed in Teams meets the pending pairing: the team is bound to the workspace. */
export async function completeTeamsPairing(
  tenantId: string,
  code: string,
  team: PairingActivity,
): Promise<TeamsInstall | null> {
  const install = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(integrationInstalls)
      .where(
        and(eq(integrationInstalls.tenantId, tenantId), eq(integrationInstalls.kind, "teams")),
      );
    const cfg = row?.config as Partial<TeamsConfig> | undefined;
    if (!row || cfg?.pairingCode !== code.toUpperCase()) return null;
    if (!cfg.pairingExpiresAt || new Date(cfg.pairingExpiresAt).getTime() < Date.now()) return null;
    const { pairingCode: _code, pairingExpiresAt: _exp, ...rest } = cfg;
    void _code;
    void _exp;
    const config: TeamsConfig & { installedAt: string; tenantDomain: string | null } = {
      ...DEFAULT_TEAMS_CONFIG,
      ...rest,
      aadTenantId: team.aadTenantId,
      serviceUrl: team.serviceUrl,
      generalChannelId: team.generalChannelId,
      installedAt: new Date().toISOString(),
      tenantDomain: team.tenantDomain ?? null,
    };
    const [updated] = await tx
      .update(integrationInstalls)
      .set({
        status: "active",
        externalId: team.teamId,
        externalName: team.teamName,
        config,
        updatedAt: new Date(),
      })
      .where(eq(integrationInstalls.id, row.id))
      .returning();
    return updated ? toInstall(updated) : null;
  });
  if (!install) return null;
  await recordChatEvent(tenantId, {
    provider: "teams",
    kind: "install",
    direction: "in",
    target: install.teamName,
  });
  await forgetApiKeyLookup(`teams-pair:${code.toUpperCase()}`);
  await registerApiKeyLookup(`teams:${team.teamId}`, tenantId);
  await registerApiKeyLookup(`teams-aad:${team.aadTenantId}`, tenantId);
  return install;
}

export async function saveTeamsConfig(
  tx: Tx,
  tenantId: string,
  patch: Partial<TeamsConfig>,
): Promise<void> {
  const install = await getTeamsInstall(tx, tenantId);
  if (!install) return;
  await tx
    .update(integrationInstalls)
    .set({ config: { ...install.config, ...patch }, updatedAt: new Date() })
    .where(eq(integrationInstalls.id, install.id));
}

export async function disconnectTeams(tx: Tx, tenantId: string): Promise<TeamsInstall | null> {
  const install = await getTeamsInstall(tx, tenantId);
  if (!install) return null;
  await tx
    .update(integrationInstalls)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(eq(integrationInstalls.id, install.id));
  await forgetApiKeyLookup(`teams:${install.teamId}`);
  await forgetApiKeyLookup(`teams-aad:${install.config.aadTenantId}`);
  return install;
}

/** The channel messages of a Teams channel carry `;messageid=…` after the channel id. */
export function teamsChannelIdOf(conversationId: string): string {
  return conversationId.split(";")[0] ?? conversationId;
}

async function channelRow(tx: Tx, incidentId: string) {
  const [ch] = await tx
    .select()
    .from(incidentChannels)
    .where(and(eq(incidentChannels.incidentId, incidentId), eq(incidentChannels.kind, "teams")));
  return ch ?? null;
}

/** The incident's Teams channel: created in the paired team on first call, header card as the first thread. */
export async function ensureIncidentChannelTeams(
  tenantId: string,
  incidentId: string,
  origin: string,
  opts: { force?: boolean } = {},
): Promise<{ channelId: string; channelName: string; webUrl: string | null } | null> {
  return withTenant(tenantId, async (tx) => {
    const existing = await channelRow(tx, incidentId);
    if (existing)
      return {
        channelId: existing.channelId,
        channelName: existing.channelName,
        webUrl: existing.meta.webUrl ?? null,
      };
    const install = await liveTeamsInstall(tx, tenantId);
    if (!install) return null;
    if (install.config.channelMode !== "auto" && !opts.force) return null;
    // A standard channel is visible to the whole team: a private incident gets none.
    const [vis] = await tx
      .select({ visibility: incidents.visibility })
      .from(incidents)
      .where(eq(incidents.id, incidentId));
    if (vis?.visibility === "private") return null;
    const card = await incidentCard(tx, tenantId, incidentId, origin);
    if (!card) return null;
    const name = `${install.config.channelPrefix}${card.reference.replace(/^INC-/, "")}`
      .replace(/[~#%&*{}+/\\:<>?|'"]/g, "-")
      .slice(0, 50);
    let created = await teamsGraph.createChannel(
      install.config.aadTenantId,
      install.teamId,
      name,
      `${card.reference} — ${card.name} · ${card.url}`,
    );
    if (!created.ok && /409|exists|Name already/i.test(created.error))
      created = await teamsGraph.createChannel(
        install.config.aadTenantId,
        install.teamId,
        `${name}-${Date.now().toString(36).slice(-4)}`,
        `${card.reference} — ${card.name}`,
      );
    if (!created.ok) {
      console.error(`[teams] channel creation failed: ${created.error}`);
      await recordChatEvent(
        tenantId,
        {
          provider: "teams",
          kind: "channel",
          target: name,
          incidentId,
          ok: false,
          error: created.error.slice(0, 60),
        },
        tx,
      );
      return null;
    }
    const channel = created.value;
    // A new channel takes a moment to accept posts: one retry after a short pause.
    let header = await teamsConnector.startThread(
      install.config.serviceUrl,
      channel.id,
      cardActivity(incidentHeaderCard(card), `${card.reference} — ${card.name}`),
      install.config.aadTenantId,
    );
    if (!header.ok) {
      await new Promise((r) => setTimeout(r, 1500));
      header = await teamsConnector.startThread(
        install.config.serviceUrl,
        channel.id,
        cardActivity(incidentHeaderCard(card), `${card.reference} — ${card.name}`),
        install.config.aadTenantId,
      );
    }
    await recordChatEvent(
      tenantId,
      {
        provider: "teams",
        kind: "channel",
        target: channel.displayName,
        incidentId,
        ok: header.ok,
        error: header.ok ? null : header.error.slice(0, 60),
      },
      tx,
    );
    // A standard channel is open to the whole team: the people of the incident
    // are not invited, they are mentioned — Teams notifies them.
    const people = await channelPeople(tx, tenantId, incidentId, {
      autoInvite: install.settings.autoInvite,
      inviteOnCall: install.settings.inviteOnCall,
    });
    const reachable: Array<{ aadObjectId: string; name: string; onCall: boolean }> = [];
    for (const p of people) {
      const aad = await linkTeamsIdentity(tx, tenantId, install, {
        id: p.memberId,
        email: p.email,
        name: p.name,
      }).catch(() => null);
      if (aad) reachable.push({ aadObjectId: aad, name: p.name, onCall: p.onCall });
      else
        await recordChatEvent(
          tenantId,
          {
            provider: "teams",
            kind: "invite",
            target: channel.displayName,
            detail: p.name,
            incidentId,
            memberId: p.memberId,
            ok: false,
            error: "not_in_team",
          },
          tx,
        );
    }
    if (reachable.length && header.ok) {
      const r = await teamsConnector.post(
        install.config.serviceUrl,
        header.value.id,
        mentionActivity(reachable, card.reference),
      );
      for (const p of reachable)
        await recordChatEvent(
          tenantId,
          {
            provider: "teams",
            kind: "invite",
            target: channel.displayName,
            detail: p.name,
            incidentId,
            ok: r.ok,
            error: r.ok ? null : r.error.slice(0, 60),
            meta: p.onCall ? { onCall: true } : {},
          },
          tx,
        );
    }
    await tx.insert(incidentChannels).values({
      tenantId,
      incidentId,
      kind: "teams",
      channelId: channel.id,
      channelName: channel.displayName,
      headerTs: header.ok ? header.value.activityId : null,
      meta: header.ok
        ? { threadId: header.value.id, activityId: header.value.activityId, webUrl: channel.webUrl }
        : { webUrl: channel.webUrl },
    });
    return {
      channelId: channel.id,
      channelName: channel.displayName,
      webUrl: channel.webUrl ?? null,
    };
  });
}

export async function refreshIncidentHeaderTeams(
  tenantId: string,
  incidentId: string,
  origin: string,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const ch = await channelRow(tx, incidentId);
    if (!ch?.meta.threadId || !ch.meta.activityId) return;
    const install = await liveTeamsInstall(tx, tenantId);
    const card = await incidentCard(tx, tenantId, incidentId, origin);
    if (!install || !card) return;
    const r = await teamsConnector.update(
      install.config.serviceUrl,
      ch.meta.threadId,
      ch.meta.activityId,
      cardActivity(incidentHeaderCard(card), `${card.reference} — ${card.name}`),
    );
    await recordChatEvent(
      tenantId,
      {
        provider: "teams",
        kind: "header",
        target: ch.channelName,
        incidentId,
        ok: r.ok,
        error: r.ok ? null : r.error.slice(0, 60),
      },
      tx,
    );
  });
}

export async function postIncidentUpdateTeams(
  tenantId: string,
  incidentId: string,
  origin: string,
  update: { by: string; message: string; resolved?: boolean },
): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const ch = await channelRow(tx, incidentId);
    if (!ch) return false;
    const install = await liveTeamsInstall(tx, tenantId);
    const card = await incidentCard(tx, tenantId, incidentId, origin);
    if (!install || !card) return false;
    const r = await teamsConnector.startThread(
      install.config.serviceUrl,
      ch.channelId,
      cardActivity(
        incidentUpdateCard({
          reference: card.reference,
          by: update.by,
          status: card.status,
          severity: card.severity,
          message: update.message,
          url: card.url,
          resolved: update.resolved,
        }),
        `${card.reference} — ${update.resolved ? "resolved" : "update"}: ${update.message}`,
      ),
      install.config.aadTenantId,
    );
    await recordChatEvent(
      tenantId,
      {
        provider: "teams",
        kind: "update",
        target: ch.channelName,
        detail: update.by,
        incidentId,
        ok: r.ok,
        error: r.ok ? null : r.error.slice(0, 60),
      },
      tx,
    );
    return r.ok;
  });
}

export async function postIncidentNoteTeams(
  tenantId: string,
  incidentId: string,
  text: string,
): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const ch = await channelRow(tx, incidentId);
    if (!ch) return false;
    const install = await liveTeamsInstall(tx, tenantId);
    if (!install) return false;
    const r = await teamsConnector.startThread(
      install.config.serviceUrl,
      ch.channelId,
      textActivity(text.replace(/:white_check_mark:/g, "✅")),
      install.config.aadTenantId,
    );
    await recordChatEvent(
      tenantId,
      {
        provider: "teams",
        kind: "note",
        target: ch.channelName,
        incidentId,
        ok: r.ok,
        error: r.ok ? null : r.error.slice(0, 60),
      },
      tx,
    );
    return r.ok;
  });
}

/** The living announcement in the configured Teams channel: posted once, then updated in place. */
export async function syncAnnouncementTeams(
  tenantId: string,
  announcementId: string,
  origin: string,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const [a] = await tx
      .select()
      .from(announcements)
      .where(and(eq(announcements.tenantId, tenantId), eq(announcements.id, announcementId)));
    if (!a) return;
    const install = await liveTeamsInstall(tx, tenantId);
    if (!install?.config.announceChannelId) return;
    const [inc] = await tx
      .select({ number: incidents.number })
      .from(incidents)
      .where(eq(incidents.id, a.incidentId));
    if (!inc) return;
    const reference = `INC-${inc.number}`;
    const activity = cardActivity(
      announcementCard({
        body: a.body,
        reference,
        url: `${origin}/app/incidents/${inc.number}`,
        closed: a.status === "closed",
      }),
      a.body,
    );
    const ref = a.chatRef?.teams;
    const where = install.config.announceChannelName ?? install.config.announceChannelId;
    if (ref) {
      const r = await teamsConnector.update(
        install.config.serviceUrl,
        ref.threadId,
        ref.activityId,
        activity,
      );
      await recordChatEvent(
        tenantId,
        {
          provider: "teams",
          kind: "announcement",
          target: where,
          incidentId: a.incidentId,
          ok: r.ok,
          error: r.ok ? null : r.error.slice(0, 60),
          meta: { edited: true },
        },
        tx,
      );
    } else if (a.status === "live") {
      const r = await teamsConnector.startThread(
        install.config.serviceUrl,
        install.config.announceChannelId,
        activity,
        install.config.aadTenantId,
      );
      if (r.ok)
        await tx
          .update(announcements)
          .set({
            chatRef: {
              ...(a.chatRef ?? {}),
              teams: { threadId: r.value.id, activityId: r.value.activityId },
            },
          })
          .where(eq(announcements.id, a.id));
      await recordChatEvent(
        tenantId,
        {
          provider: "teams",
          kind: "announcement",
          target: where,
          incidentId: a.incidentId,
          ok: r.ok,
          error: r.ok ? null : r.error.slice(0, 60),
        },
        tx,
      );
    }
  });
}

/** A personal message that pages someone, with an Acknowledge button. Returns "conversation|activity". */
export async function dmTeamsUser(
  tenantId: string,
  aadObjectId: string,
  message: {
    subject: string;
    text: string;
    url: string;
    ackToken: string | null;
    ackUrl: string | null;
  },
): Promise<{ ok: boolean; error?: string; ref?: string }> {
  return withTenant(tenantId, async (tx) => {
    const install = await liveTeamsInstall(tx, tenantId);
    if (!install) return { ok: false, error: "teams_not_installed" };
    // The administrator turned direct-message pages off in Settings › Slack & Teams.
    if (!install.settings.dmPages) return { ok: false, error: "dm_pages_off" };
    const [who] = await tx
      .select({ id: members.id, name: members.name })
      .from(chatIdentities)
      .innerJoin(members, eq(members.id, chatIdentities.memberId))
      .where(
        and(
          eq(chatIdentities.tenantId, tenantId),
          eq(chatIdentities.kind, "teams"),
          eq(chatIdentities.externalUserId, aadObjectId),
        ),
      );
    const conv = await teamsConnector.openPersonal(
      install.config.serviceUrl,
      install.config.aadTenantId,
      aadObjectId,
    );
    const r = conv.ok
      ? await teamsConnector.post(
          install.config.serviceUrl,
          conv.value.id,
          cardActivity(escalationDmCard(message), `${message.subject} — ${message.text}`),
        )
      : conv;
    const ref = conv.ok && r.ok ? `${conv.value.id}|${r.value.id}` : null;
    await recordChatEvent(
      tenantId,
      {
        provider: "teams",
        kind: "page",
        target: who?.name ?? aadObjectId,
        detail: message.subject,
        memberId: who?.id ?? null,
        ok: r.ok,
        error: r.ok ? null : r.error.slice(0, 60),
        meta: ref ? { ref } : {},
      },
      tx,
    );
    return ref ? { ok: true, ref } : { ok: false, error: r.ok ? "teams failed" : r.error };
  });
}

export async function markTeamsDmAcknowledged(
  tenantId: string,
  ref: string,
  subject: string,
  by: string,
): Promise<void> {
  const [conversationId, activityId] = ref.split("|");
  if (!conversationId || !activityId) return;
  await withTenant(tenantId, async (tx) => {
    const install = await liveTeamsInstall(tx, tenantId);
    if (!install) return;
    await teamsConnector.update(
      install.config.serviceUrl,
      conversationId,
      activityId,
      cardActivity(acknowledgedCard({ subject, by }), `${subject} — acknowledged by ${by}`),
    );
  });
  await markChatPageAcknowledged(tenantId, "teams", ref, by);
}

/**
 * The people of the paired team, from the Bot Framework roster.
 *
 * Read through the bot rather than Graph `/users`: the roster comes with the
 * app being installed in the team, while Graph `User.Read.All` is a
 * tenant-wide application permission only a global administrator can grant —
 * the one consent screen that kept the app out of most organisations.
 */
export async function teamRoster(install: TeamsInstall) {
  const r = await teamsConnector.members(install.config.serviceUrl, install.teamId);
  if (!r.ok) return [];
  return r.value.map((m) => ({
    aadObjectId: m.aadObjectId ?? null,
    name: m.name ?? null,
    email: (m.email ?? m.userPrincipalName ?? "").toLowerCase() || null,
  }));
}

/** Links a member to their Teams user by email, through the team's roster; remembers it. */
export async function linkTeamsIdentity(
  tx: Tx,
  tenantId: string,
  install: TeamsInstall,
  member: { id: string; email: string; name?: string },
): Promise<string | null> {
  const [existing] = await tx
    .select({ externalUserId: chatIdentities.externalUserId })
    .from(chatIdentities)
    .where(and(eq(chatIdentities.memberId, member.id), eq(chatIdentities.kind, "teams")));
  if (existing) return existing.externalUserId;
  const email = member.email.toLowerCase();
  const found = (await teamRoster(install)).find((u) => u.email === email && u.aadObjectId);
  // Remembered either way: a miss is what tells the People section "not in the team".
  await recordChatEvent(
    tenantId,
    {
      provider: "teams",
      kind: "lookup",
      target: member.name ?? member.email,
      detail: member.email,
      memberId: member.id,
      ok: Boolean(found?.aadObjectId),
      error: found?.aadObjectId ? null : "not_in_team",
    },
    tx,
  );
  if (!found?.aadObjectId) return null;
  await tx
    .insert(chatIdentities)
    .values({ tenantId, memberId: member.id, kind: "teams", externalUserId: found.aadObjectId })
    .onConflictDoNothing();
  return found.aadObjectId;
}

/** The member behind a Teams user — remembered identity first, else the team's roster gives the email. */
export async function memberForTeamsUser(
  tx: Tx,
  tenantId: string,
  install: TeamsInstall,
  from: { aadObjectId?: string | null; email?: string | null },
): Promise<{ id: string; name: string; email: string; role: string } | null> {
  if (from.aadObjectId) {
    const [known] = await tx
      .select({
        id: members.id,
        name: members.name,
        email: members.email,
        role: members.role,
        status: members.status,
      })
      .from(chatIdentities)
      .innerJoin(members, eq(members.id, chatIdentities.memberId))
      .where(
        and(
          eq(chatIdentities.tenantId, tenantId),
          eq(chatIdentities.kind, "teams"),
          eq(chatIdentities.externalUserId, from.aadObjectId),
        ),
      );
    if (known && known.status === "active") return known;
  }
  let email = from.email?.toLowerCase() ?? null;
  if (!email && from.aadObjectId) {
    const found = (await teamRoster(install)).find((u) => u.aadObjectId === from.aadObjectId);
    email = found?.email ?? null;
  }
  if (!email) return null;
  const [m] = await tx
    .select({
      id: members.id,
      name: members.name,
      email: members.email,
      role: members.role,
      status: members.status,
    })
    .from(members)
    .where(and(eq(members.tenantId, tenantId), eq(members.email, email)));
  if (!m || m.status !== "active") return null;
  if (from.aadObjectId)
    await tx
      .insert(chatIdentities)
      .values({ tenantId, memberId: m.id, kind: "teams", externalUserId: from.aadObjectId })
      .onConflictDoNothing();
  return m;
}

/** The incident behind a Teams channel (or one of its message threads). */
export async function incidentForTeamsChannel(
  tx: Tx,
  tenantId: string,
  conversationId: string,
): Promise<{ id: string; number: number } | null> {
  const [row] = await tx
    .select({ id: incidents.id, number: incidents.number })
    .from(incidentChannels)
    .innerJoin(incidents, eq(incidents.id, incidentChannels.incidentId))
    .where(
      and(
        eq(incidentChannels.tenantId, tenantId),
        eq(incidentChannels.kind, "teams"),
        eq(incidentChannels.channelId, teamsChannelIdOf(conversationId)),
      ),
    );
  return row ?? null;
}

/** "Atlas acted" in the incident's Teams channel. False when there is no channel to tell. */
export async function postAtlasActedTeams(
  tenantId: string,
  view: Parameters<typeof atlasActedCard>[0],
): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const ch = await channelRow(tx, view.incidentId);
    if (!ch) return false;
    const install = await liveTeamsInstall(tx, tenantId);
    if (!install) return false;
    const r = await teamsConnector.startThread(
      install.config.serviceUrl,
      ch.channelId,
      cardActivity(atlasActedCard(view), `Atlas acted (level ${view.level}): ${view.title}`),
      install.config.aadTenantId,
    );
    await recordChatEvent(
      tenantId,
      {
        provider: "teams",
        kind: "atlas",
        target: ch.channelName,
        detail: view.title,
        incidentId: view.incidentId,
        ok: r.ok,
        error: r.ok ? null : r.error.slice(0, 60),
        meta: { actionId: view.actionId, level: view.level },
      },
      tx,
    );
    return r.ok;
  });
}

/** An update draft by Atlas in the incident's Teams channel — when the administrator asked for them. */
export async function postAtlasDraftTeams(
  tenantId: string,
  incidentId: string,
  draft: { reference: string; message: string },
): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const ch = await channelRow(tx, incidentId);
    if (!ch) return false;
    const install = await liveTeamsInstall(tx, tenantId);
    if (!install || !install.settings.atlasDrafts) return false;
    const r = await teamsConnector.startThread(
      install.config.serviceUrl,
      ch.channelId,
      cardActivity(
        atlasDraftCard({ reference: draft.reference, incidentId, message: draft.message }),
        `Update draft by Atlas — ${draft.reference}`,
      ),
      install.config.aadTenantId,
    );
    await recordChatEvent(
      tenantId,
      {
        provider: "teams",
        kind: "draft",
        target: ch.channelName,
        incidentId,
        ok: r.ok,
        error: r.ok ? null : r.error.slice(0, 60),
      },
      tx,
    );
    return r.ok;
  });
}

/**
 * The root cause analysis in the incident's Teams channel — posted once, then
 * updated in place at every assessment, honouring "Post the root cause
 * analysis". Returns where the card is, or null.
 */
export async function postInvestigationTeams(
  tenantId: string,
  incidentId: string,
  text: string,
  ref: { threadId: string; activityId: string } | null,
): Promise<{ threadId: string; activityId: string } | null> {
  return withTenant(tenantId, async (tx) => {
    const ch = await channelRow(tx, incidentId);
    if (!ch) return null;
    const install = await liveTeamsInstall(tx, tenantId);
    if (!install || !install.settings.postRca) return null;
    if (ref) {
      const r = await teamsConnector.update(
        install.config.serviceUrl,
        ref.threadId,
        ref.activityId,
        textActivity(text),
      );
      if (r.ok) {
        await recordChatEvent(
          tenantId,
          {
            provider: "teams",
            kind: "rca",
            target: ch.channelName,
            incidentId,
            meta: { edited: true },
          },
          tx,
        );
        return ref;
      }
    }
    const r = await teamsConnector.startThread(
      install.config.serviceUrl,
      ch.channelId,
      textActivity(text),
      install.config.aadTenantId,
    );
    await recordChatEvent(
      tenantId,
      {
        provider: "teams",
        kind: "rca",
        target: ch.channelName,
        incidentId,
        ok: r.ok,
        error: r.ok ? null : r.error.slice(0, 60),
      },
      tx,
    );
    return r.ok ? { threadId: r.value.id, activityId: r.value.activityId } : null;
  });
}

/**
 * The test of the settings: a real card in the announcement channel, or the
 * channel the pairing came from. Says where it went, or why not.
 */
export async function sendTeamsTest(
  tenantId: string,
  by: { memberId: string; name: string },
  workspace: string,
  url: string,
): Promise<{ ok: boolean; where: string; error?: string }> {
  return withTenant(tenantId, async (tx) => {
    const install = await liveTeamsInstall(tx, tenantId);
    if (!install) return { ok: false, where: "", error: "teams_not_installed" };
    const channelId = install.config.announceChannelId ?? install.config.generalChannelId;
    const where = install.config.announceChannelName ?? install.teamName;
    const r = await teamsConnector.startThread(
      install.config.serviceUrl,
      channelId,
      cardActivity(
        testCard({ workspace, by: by.name, url }),
        `Open Incident is connected to Microsoft Teams — a test ${by.name} asked for.`,
      ),
      install.config.aadTenantId,
    );
    await recordChatEvent(
      tenantId,
      {
        provider: "teams",
        kind: "test",
        target: where,
        memberId: by.memberId,
        ok: r.ok,
        error: r.ok ? null : r.error.slice(0, 60),
      },
      tx,
    );
    return r.ok ? { ok: true, where } : { ok: false, where, error: r.error.slice(0, 60) };
  });
}
