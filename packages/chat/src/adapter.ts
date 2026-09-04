/**
 * The chat adapter — what the product asks of Slack, in product words:
 * a channel for an incident, an update in it, an announcement kept current,
 * a direct message that pages someone. It reads installs and channels from
 * the database and never decides anything: the caller already did.
 */
import { and, eq } from "drizzle-orm";
import { decryptSecrets, encryptSecrets } from "@openincident/crypto";
import {
  announcements,
  catalogEntries,
  chatIdentities,
  incidentChannels,
  incidentRoles,
  incidentStatuses,
  incidents,
  integrationInstalls,
  members,
  roleAssignments,
  severities,
  withTenant,
  type BridgeConfig,
  type SlackConfig,
  type Tx,
} from "@openincident/db";
import { slack, type SlackClient } from "./slack/client";
import {
  acknowledgedBlocks,
  announcementBlocks,
  escalationDmBlocks,
  incidentHeaderBlocks,
  incidentUpdateBlocks,
  type IncidentCard,
} from "./slack/blocks";

export const DEFAULT_SLACK_CONFIG: SlackConfig = {
  channelMode: "auto",
  channelPrefix: "inc-",
  announceChannelId: null,
  announceChannelName: null,
  autoInvite: true,
};

export type SlackInstall = {
  id: string;
  teamId: string;
  teamName: string;
  botUserId: string | null;
  token: string;
  config: SlackConfig;
  installedByMemberId: string | null;
};

/** The workspace's Slack install, decrypted — null when Slack is not connected. */
export async function getSlackInstall(tx: Tx, tenantId: string): Promise<SlackInstall | null> {
  const [row] = await tx
    .select()
    .from(integrationInstalls)
    .where(
      and(
        eq(integrationInstalls.tenantId, tenantId),
        eq(integrationInstalls.kind, "slack"),
        eq(integrationInstalls.status, "active"),
      ),
    );
  if (!row?.encryptedSecrets || !row.externalId) return null;
  const secrets = decryptSecrets(row.encryptedSecrets);
  if (!secrets.bot_token) return null;
  return {
    id: row.id,
    teamId: row.externalId,
    teamName: row.externalName ?? row.externalId,
    botUserId: row.botUserId,
    token: secrets.bot_token,
    config: { ...DEFAULT_SLACK_CONFIG, ...(row.config as Partial<SlackConfig>) },
    installedByMemberId: row.installedByMemberId,
  };
}

export async function saveSlackInstall(
  tx: Tx,
  tenantId: string,
  input: {
    teamId: string;
    teamName: string;
    botUserId: string;
    accessToken: string;
    memberId: string;
  },
): Promise<string> {
  const [existing] = await tx
    .select({ id: integrationInstalls.id, config: integrationInstalls.config })
    .from(integrationInstalls)
    .where(and(eq(integrationInstalls.tenantId, tenantId), eq(integrationInstalls.kind, "slack")));
  const values = {
    externalId: input.teamId,
    externalName: input.teamName,
    botUserId: input.botUserId,
    encryptedSecrets: encryptSecrets({ bot_token: input.accessToken }),
    status: "active" as const,
    installedByMemberId: input.memberId,
    updatedAt: new Date(),
  };
  if (existing) {
    await tx.update(integrationInstalls).set(values).where(eq(integrationInstalls.id, existing.id));
    return existing.id;
  }
  const [row] = await tx
    .insert(integrationInstalls)
    .values({ tenantId, kind: "slack", config: DEFAULT_SLACK_CONFIG, ...values })
    .returning({ id: integrationInstalls.id });
  return row!.id;
}

/** The video-call link template (Meet, Zoom) — the war room of every new incident. */
export async function getBridgeTemplate(
  tx: Tx,
  tenantId: string,
): Promise<{ kind: "meet" | "zoom"; template: string } | null> {
  const rows = await tx
    .select()
    .from(integrationInstalls)
    .where(
      and(eq(integrationInstalls.tenantId, tenantId), eq(integrationInstalls.status, "active")),
    );
  const hit = rows.find((r) => r.kind === "meet" || r.kind === "zoom");
  const template = (hit?.config as Partial<BridgeConfig> | undefined)?.template;
  return hit && template ? { kind: hit.kind as "meet" | "zoom", template } : null;
}

/** Everything a message about an incident needs, in one read. */
export async function incidentCard(
  tx: Tx,
  tenantId: string,
  incidentId: string,
  origin: string,
): Promise<IncidentCard | null> {
  const [row] = await tx
    .select({
      inc: incidents,
      statusName: incidentStatuses.name,
      sevName: severities.name,
      serviceName: catalogEntries.name,
    })
    .from(incidents)
    .leftJoin(incidentStatuses, eq(incidentStatuses.id, incidents.statusId))
    .leftJoin(severities, eq(severities.id, incidents.severityId))
    .leftJoin(catalogEntries, eq(catalogEntries.id, incidents.serviceEntryId))
    .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, incidentId)));
  if (!row) return null;
  const [lead] = await tx
    .select({ name: members.name })
    .from(roleAssignments)
    .innerJoin(
      incidentRoles,
      and(eq(incidentRoles.id, roleAssignments.roleId), eq(incidentRoles.isLead, true)),
    )
    .innerJoin(members, eq(members.id, roleAssignments.memberId))
    .where(eq(roleAssignments.incidentId, incidentId));
  return {
    reference: `INC-${row.inc.number}`,
    name: row.inc.name,
    status: row.statusName,
    severity: row.sevName,
    phase: row.inc.phase,
    lead: lead?.name ?? null,
    service: row.serviceName,
    url: `${origin}/app/incidents/${row.inc.number}`,
    bridgeUrl: row.inc.bridgeUrl,
    summary: row.inc.summary,
  };
}

/** The Slack user ids of the members holding roles on the incident, plus the declarer. */
async function incidentSlackUsers(tx: Tx, tenantId: string, incidentId: string): Promise<string[]> {
  const [inc] = await tx
    .select({ creator: incidents.creatorMemberId })
    .from(incidents)
    .where(eq(incidents.id, incidentId));
  const roles = await tx
    .select({ memberId: roleAssignments.memberId })
    .from(roleAssignments)
    .where(eq(roleAssignments.incidentId, incidentId));
  const ids = [
    ...new Set(
      [inc?.creator, ...roles.map((r) => r.memberId)].filter((x): x is string => Boolean(x)),
    ),
  ];
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ externalUserId: chatIdentities.externalUserId, memberId: chatIdentities.memberId })
    .from(chatIdentities)
    .where(and(eq(chatIdentities.tenantId, tenantId), eq(chatIdentities.kind, "slack")));
  return rows.filter((r) => ids.includes(r.memberId)).map((r) => r.externalUserId);
}

/**
 * The incident's channel: created on first call (mode auto, or by hand from
 * the incident page), with the header message and the people already on it.
 */
export async function ensureIncidentChannel(
  tenantId: string,
  incidentId: string,
  origin: string,
  opts: { force?: boolean } = {},
): Promise<{ channelId: string; channelName: string } | null> {
  return withTenant(tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(incidentChannels)
      .where(and(eq(incidentChannels.incidentId, incidentId), eq(incidentChannels.kind, "slack")));
    if (existing) return { channelId: existing.channelId, channelName: existing.channelName };
    const install = await getSlackInstall(tx, tenantId);
    if (!install) return null;
    if (install.config.channelMode !== "auto" && !opts.force) return null;
    const card = await incidentCard(tx, tenantId, incidentId, origin);
    if (!card) return null;
    const api = slack(install.token);
    const base = `${install.config.channelPrefix}${card.reference.replace(/^INC-/, "")}`
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "-")
      .slice(0, 70);
    let created = await api.createChannel(base);
    if (!created.ok && created.error === "name_taken")
      created = await api.createChannel(`${base}-${Date.now().toString(36).slice(-4)}`);
    if (!created.ok) {
      console.error(`[slack] conversations.create failed: ${created.error}`);
      return null;
    }
    const channel = created.channel;
    await api.setTopic(channel.id, `${card.reference} — ${card.name} · ${card.url}`);
    const header = await api.postMessage(
      channel.id,
      `${card.reference} — ${card.name}`,
      incidentHeaderBlocks(card),
    );
    if (header.ok) await api.pin(channel.id, header.ts);
    if (install.config.autoInvite) {
      const users = await incidentSlackUsers(tx, tenantId, incidentId);
      if (users.length) await api.invite(channel.id, users);
    }
    await tx.insert(incidentChannels).values({
      tenantId,
      incidentId,
      kind: "slack",
      channelId: channel.id,
      channelName: channel.name,
      headerTs: header.ok ? header.ts : null,
    });
    return { channelId: channel.id, channelName: channel.name };
  });
}

/** Re-renders the pinned header after a change (status, severity, lead). */
export async function refreshIncidentHeader(
  tenantId: string,
  incidentId: string,
  origin: string,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const [ch] = await tx
      .select()
      .from(incidentChannels)
      .where(and(eq(incidentChannels.incidentId, incidentId), eq(incidentChannels.kind, "slack")));
    if (!ch?.headerTs) return;
    const install = await getSlackInstall(tx, tenantId);
    const card = await incidentCard(tx, tenantId, incidentId, origin);
    if (!install || !card) return;
    await slack(install.token).updateMessage(
      ch.channelId,
      ch.headerTs,
      `${card.reference} — ${card.name}`,
      incidentHeaderBlocks(card),
    );
  });
}

/** Posts a status update in the incident's channel, if it has one. */
export async function postIncidentUpdate(
  tenantId: string,
  incidentId: string,
  origin: string,
  update: { by: string; message: string; resolved?: boolean },
): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const [ch] = await tx
      .select()
      .from(incidentChannels)
      .where(and(eq(incidentChannels.incidentId, incidentId), eq(incidentChannels.kind, "slack")));
    if (!ch) return false;
    const install = await getSlackInstall(tx, tenantId);
    const card = await incidentCard(tx, tenantId, incidentId, origin);
    if (!install || !card) return false;
    const r = await slack(install.token).postMessage(
      ch.channelId,
      `${card.reference} — ${update.resolved ? "resolved" : `update: ${card.status ?? ""}`}`,
      incidentUpdateBlocks({
        reference: card.reference,
        by: update.by,
        status: card.status,
        severity: card.severity,
        message: update.message,
        url: card.url,
        resolved: update.resolved,
      }),
    );
    return r.ok;
  });
}

/** A short line in the incident channel (role assigned, follow-up created, escalation…). */
export async function postIncidentNote(
  tenantId: string,
  incidentId: string,
  text: string,
): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const [ch] = await tx
      .select()
      .from(incidentChannels)
      .where(and(eq(incidentChannels.incidentId, incidentId), eq(incidentChannels.kind, "slack")));
    if (!ch) return false;
    const install = await getSlackInstall(tx, tenantId);
    if (!install) return false;
    const r = await slack(install.token).postMessage(ch.channelId, text);
    return r.ok;
  });
}

/** Publishes or updates a living announcement in the configured channel. */
export async function syncAnnouncement(
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
    const install = await getSlackInstall(tx, tenantId);
    if (!install?.config.announceChannelId) return;
    const [inc] = await tx
      .select({ number: incidents.number })
      .from(incidents)
      .where(eq(incidents.id, a.incidentId));
    if (!inc) return;
    const reference = `INC-${inc.number}`;
    const api = slack(install.token);
    const blocks = announcementBlocks({
      body: a.body,
      reference,
      url: `${origin}/app/incidents/${inc.number}`,
      closed: a.status === "closed",
    });
    if (a.chatRef?.channelId && a.chatRef.ts) {
      await api.updateMessage(a.chatRef.channelId, a.chatRef.ts, a.body, blocks);
    } else if (a.status === "live") {
      const r = await api.postMessage(install.config.announceChannelId, a.body, blocks);
      if (r.ok)
        await tx
          .update(announcements)
          .set({ chatRef: { ...(a.chatRef ?? {}), channelId: r.channel, ts: r.ts } })
          .where(eq(announcements.id, a.id));
    }
  });
}

/** A direct message that pages someone, with an Acknowledge button. Returns the message ref. */
export async function dmSlackUser(
  tenantId: string,
  slackUserId: string,
  message: {
    subject: string;
    text: string;
    url: string;
    ackToken: string | null;
    ackUrl: string | null;
  },
): Promise<{ ok: boolean; error?: string; ref?: string }> {
  return withTenant(tenantId, async (tx) => {
    const install = await getSlackInstall(tx, tenantId);
    if (!install) return { ok: false, error: "slack_not_installed" };
    const api = slack(install.token);
    const channel = (await api.openDm(slackUserId)) ?? slackUserId;
    const r = await api.postMessage(
      channel,
      `${message.subject} — ${message.text}`,
      escalationDmBlocks(message),
    );
    return r.ok ? { ok: true, ref: `${r.channel}:${r.ts}` } : { ok: false, error: r.error };
  });
}

/** Turns the DM into its acknowledged form. */
export async function markDmAcknowledged(
  tenantId: string,
  ref: { channelId: string; ts: string },
  subject: string,
  by: string,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const install = await getSlackInstall(tx, tenantId);
    if (!install) return;
    await slack(install.token).updateMessage(
      ref.channelId,
      ref.ts,
      `${subject} — acknowledged by ${by}`,
      acknowledgedBlocks({ subject, by }),
    );
  });
}

/** Links a member to their Slack user by email; remembers it. */
export async function linkSlackIdentity(
  tx: Tx,
  tenantId: string,
  api: SlackClient,
  member: { id: string; email: string },
): Promise<string | null> {
  const [existing] = await tx
    .select({ externalUserId: chatIdentities.externalUserId })
    .from(chatIdentities)
    .where(and(eq(chatIdentities.memberId, member.id), eq(chatIdentities.kind, "slack")));
  if (existing) return existing.externalUserId;
  const user = await api.lookupByEmail(member.email);
  if (!user) return null;
  await tx
    .insert(chatIdentities)
    .values({ tenantId, memberId: member.id, kind: "slack", externalUserId: user.id })
    .onConflictDoNothing();
  return user.id;
}

/** The member behind a Slack user id — by remembered identity, else by the user's email. */
export async function memberForSlackUser(
  tx: Tx,
  tenantId: string,
  api: SlackClient,
  slackUserId: string,
): Promise<{ id: string; name: string; email: string; role: string } | null> {
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
        eq(chatIdentities.kind, "slack"),
        eq(chatIdentities.externalUserId, slackUserId),
      ),
    );
  if (known && known.status === "active") return known;
  const user = await api.userInfo(slackUserId);
  const email = user?.profile?.email?.toLowerCase();
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
  await tx
    .insert(chatIdentities)
    .values({ tenantId, memberId: m.id, kind: "slack", externalUserId: slackUserId })
    .onConflictDoNothing();
  return m;
}

/** The incident behind a channel id, if the channel is an incident channel. */
export async function incidentForChannel(
  tx: Tx,
  tenantId: string,
  channelId: string,
): Promise<{ id: string; number: number } | null> {
  const [row] = await tx
    .select({ id: incidents.id, number: incidents.number })
    .from(incidentChannels)
    .innerJoin(incidents, eq(incidents.id, incidentChannels.incidentId))
    .where(and(eq(incidentChannels.tenantId, tenantId), eq(incidentChannels.channelId, channelId)));
  return row ?? null;
}
