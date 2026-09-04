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
import {
  acknowledgedCard,
  announcementCard,
  escalationDmCard,
  incidentHeaderCard,
  incidentUpdateCard,
} from "./cards";
import { cardActivity, teamsConnector, textActivity } from "./client";
import { teamsGraph } from "./graph";

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
  installedByMemberId: string | null;
};

function toInstall(row: typeof integrationInstalls.$inferSelect): TeamsInstall {
  return {
    id: row.id,
    teamId: row.externalId ?? "",
    teamName: row.externalName ?? row.externalId ?? "Microsoft Teams",
    config: { ...DEFAULT_TEAMS_CONFIG, ...(row.config as Partial<TeamsConfig>) } as TeamsConfig,
    installedByMemberId: row.installedByMemberId,
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
    const config: TeamsConfig = {
      ...DEFAULT_TEAMS_CONFIG,
      ...rest,
      aadTenantId: team.aadTenantId,
      serviceUrl: team.serviceUrl,
      generalChannelId: team.generalChannelId,
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
    const install = await getTeamsInstall(tx, tenantId);
    if (!install) return null;
    if (install.config.channelMode !== "auto" && !opts.force) return null;
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
    const install = await getTeamsInstall(tx, tenantId);
    const card = await incidentCard(tx, tenantId, incidentId, origin);
    if (!install || !card) return;
    await teamsConnector.update(
      install.config.serviceUrl,
      ch.meta.threadId,
      ch.meta.activityId,
      cardActivity(incidentHeaderCard(card), `${card.reference} — ${card.name}`),
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
    const install = await getTeamsInstall(tx, tenantId);
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
    const install = await getTeamsInstall(tx, tenantId);
    if (!install) return false;
    const r = await teamsConnector.startThread(
      install.config.serviceUrl,
      ch.channelId,
      textActivity(text.replace(/:white_check_mark:/g, "✅")),
      install.config.aadTenantId,
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
    const install = await getTeamsInstall(tx, tenantId);
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
    if (ref) {
      await teamsConnector.update(
        install.config.serviceUrl,
        ref.threadId,
        ref.activityId,
        activity,
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
    const install = await getTeamsInstall(tx, tenantId);
    if (!install) return { ok: false, error: "teams_not_installed" };
    const conv = await teamsConnector.openPersonal(
      install.config.serviceUrl,
      install.config.aadTenantId,
      aadObjectId,
    );
    if (!conv.ok) return { ok: false, error: conv.error };
    const r = await teamsConnector.post(
      install.config.serviceUrl,
      conv.value.id,
      cardActivity(escalationDmCard(message), `${message.subject} — ${message.text}`),
    );
    return r.ok
      ? { ok: true, ref: `${conv.value.id}|${r.value.id}` }
      : { ok: false, error: r.error };
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
    const install = await getTeamsInstall(tx, tenantId);
    if (!install) return;
    await teamsConnector.update(
      install.config.serviceUrl,
      conversationId,
      activityId,
      cardActivity(acknowledgedCard({ subject, by }), `${subject} — acknowledged by ${by}`),
    );
  });
}

/** Links a member to their Azure AD user by email through Graph; remembers it. */
export async function linkTeamsIdentity(
  tx: Tx,
  tenantId: string,
  install: TeamsInstall,
  member: { id: string; email: string },
): Promise<string | null> {
  const [existing] = await tx
    .select({ externalUserId: chatIdentities.externalUserId })
    .from(chatIdentities)
    .where(and(eq(chatIdentities.memberId, member.id), eq(chatIdentities.kind, "teams")));
  if (existing) return existing.externalUserId;
  const user = await teamsGraph.user(install.config.aadTenantId, member.email);
  if (!user.ok) return null;
  await tx
    .insert(chatIdentities)
    .values({ tenantId, memberId: member.id, kind: "teams", externalUserId: user.value.id })
    .onConflictDoNothing();
  return user.value.id;
}

/** The member behind a Teams user — remembered identity first, else Graph gives the email. */
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
    const user = await teamsGraph.user(install.config.aadTenantId, from.aadObjectId);
    email = user.ok
      ? ((user.value.mail ?? user.value.userPrincipalName ?? null)?.toLowerCase() ?? null)
      : null;
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
