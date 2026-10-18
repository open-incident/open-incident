/**
 * The chat adapter — what the product asks of Slack, in product words:
 * a channel for an incident, an update in it, an announcement kept current,
 * a direct message that pages someone. It reads installs and channels from
 * the database and never decides anything: the caller already did.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { decryptSecrets, encryptSecrets } from "@openincident/crypto";
import {
  alertRoutes,
  announcements,
  chatEvents,
  chatIdentities,
  incidentChannels,
  incidentRoles,
  incidentStatuses,
  incidents,
  integrationInstalls,
  members,
  roleAssignments,
  services,
  severities,
  withTenant,
  type BridgeConfig,
  type SlackConfig,
  type Tx,
} from "@openincident/db";
import { markChatPageAcknowledged, recordChatEvent } from "./events";
import { channelPeople, peopleLine } from "./people";
import { chatSettings, type ChatSettings } from "./settings";
import { slack, type SlackClient } from "./slack/client";
import {
  acknowledgedBlocks,
  alertChannelBlocks,
  type AlertChannelView,
  announcementBlocks,
  atlasActedBlocks,
  atlasDraftBlocks,
  type AtlasActedView,
  escalationDmBlocks,
  type IncidentCard,
  incidentHeaderBlocks,
  incidentUpdateBlocks,
  investigationBlocks,
  investigationText,
  type InvestigationView,
  testBlocks,
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
  /** The switches of Settings › Slack & Teams, defaults filled in. */
  settings: ChatSettings;
  installedByMemberId: string | null;
  createdAt: Date;
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
    settings: chatSettings(row.config),
    installedByMemberId: row.installedByMemberId,
    createdAt: row.createdAt,
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
  const installedAt = new Date().toISOString();
  if (existing) {
    // A reinstall keeps every setting: only the token and who installed it change.
    await tx
      .update(integrationInstalls)
      .set({
        ...values,
        config: sql`${integrationInstalls.config} || ${JSON.stringify({ installedAt })}::jsonb`,
      })
      .where(eq(integrationInstalls.id, existing.id));
    return existing.id;
  }
  const [row] = await tx
    .insert(integrationInstalls)
    .values({
      tenantId,
      kind: "slack",
      config: { ...DEFAULT_SLACK_CONFIG, installedAt },
      ...values,
    })
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
      serviceName: services.key,
    })
    .from(incidents)
    .leftJoin(incidentStatuses, eq(incidentStatuses.id, incidents.statusId))
    .leftJoin(severities, eq(severities.id, incidents.severityId))
    .leftJoin(services, eq(services.id, incidents.serviceId))
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

/**
 * The Slack users the channel should hold, matched by email when they have
 * never acted in Slack (and remembered), with the people nobody could match.
 */
async function slackPeopleFor(
  tx: Tx,
  tenantId: string,
  incidentId: string,
  install: SlackInstall,
  api: SlackClient,
) {
  const people = await channelPeople(tx, tenantId, incidentId, {
    autoInvite: install.config.autoInvite,
    inviteOnCall: install.settings.inviteOnCall,
  });
  const out: Array<(typeof people)[number] & { slackId: string | null }> = [];
  for (const p of people) {
    const slackId = await linkSlackIdentity(tx, tenantId, api, {
      id: p.memberId,
      email: p.email,
      name: p.name,
    }).catch(() => null);
    out.push({ ...p, slackId });
  }
  return out;
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
    // Incident channels are public channels of the Slack workspace: a private
    // incident gets none rather than a channel anyone can join.
    const [vis] = await tx
      .select({ visibility: incidents.visibility })
      .from(incidents)
      .where(eq(incidents.id, incidentId));
    if (vis?.visibility === "private") return null;
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
      await recordChatEvent(
        tenantId,
        {
          provider: "slack",
          kind: "channel",
          target: `#${base}`,
          incidentId,
          ok: false,
          error: created.error,
        },
        tx,
      );
      return null;
    }
    const channel = created.channel;
    const where = `#${channel.name}`;
    await api.setTopic(channel.id, `${card.reference} — ${card.name} · ${card.url}`);
    const header = await api.postMessage(
      channel.id,
      `${card.reference} — ${card.name}`,
      incidentHeaderBlocks(card),
    );
    if (header.ok) await api.pin(channel.id, header.ts);
    await recordChatEvent(
      tenantId,
      {
        provider: "slack",
        kind: "channel",
        target: where,
        incidentId,
        ok: header.ok,
        error: header.ok ? null : header.error,
      },
      tx,
    );
    const people = await slackPeopleFor(tx, tenantId, incidentId, install, api);
    const added: typeof people = [];
    for (const p of people) {
      if (!p.slackId) {
        await recordChatEvent(
          tenantId,
          {
            provider: "slack",
            kind: "invite",
            target: where,
            detail: p.name,
            incidentId,
            memberId: p.memberId,
            ok: false,
            error: "users_not_found",
          },
          tx,
        );
        continue;
      }
      // One by one: a refusal for one person (user_disabled…) must not keep the others out.
      const r = await api.invite(channel.id, [p.slackId]);
      if (r.ok) added.push(p);
      await recordChatEvent(
        tenantId,
        {
          provider: "slack",
          kind: "invite",
          target: where,
          detail: p.name,
          incidentId,
          memberId: p.memberId,
          ok: r.ok,
          error: r.ok ? null : r.error,
          meta: p.onCall ? { onCall: true } : {},
        },
        tx,
      );
    }
    if (added.length) await api.postMessage(channel.id, `${peopleLine(added)} were added.`);
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
    const r = await slack(install.token).updateMessage(
      ch.channelId,
      ch.headerTs,
      `${card.reference} — ${card.name}`,
      incidentHeaderBlocks(card),
    );
    await recordChatEvent(
      tenantId,
      {
        provider: "slack",
        kind: "header",
        target: `#${ch.channelName}`,
        incidentId,
        ok: r.ok,
        error: r.ok ? null : r.error,
      },
      tx,
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
    await recordChatEvent(
      tenantId,
      {
        provider: "slack",
        kind: "update",
        target: `#${ch.channelName}`,
        detail: update.by,
        incidentId,
        ok: r.ok,
        error: r.ok ? null : r.error,
      },
      tx,
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
    await recordChatEvent(
      tenantId,
      {
        provider: "slack",
        kind: "note",
        target: `#${ch.channelName}`,
        incidentId,
        ok: r.ok,
        error: r.ok ? null : r.error,
      },
      tx,
    );
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
    const where = install.config.announceChannelName
      ? `#${install.config.announceChannelName}`
      : install.config.announceChannelId;
    if (a.chatRef?.channelId && a.chatRef.ts) {
      const r = await api.updateMessage(a.chatRef.channelId, a.chatRef.ts, a.body, blocks);
      await recordChatEvent(
        tenantId,
        {
          provider: "slack",
          kind: "announcement",
          target: where,
          incidentId: a.incidentId,
          ok: r.ok,
          error: r.ok ? null : r.error,
          meta: { edited: true },
        },
        tx,
      );
    } else if (a.status === "live") {
      const r = await api.postMessage(install.config.announceChannelId, a.body, blocks);
      if (r.ok)
        await tx
          .update(announcements)
          .set({ chatRef: { ...(a.chatRef ?? {}), channelId: r.channel, ts: r.ts } })
          .where(eq(announcements.id, a.id));
      await recordChatEvent(
        tenantId,
        {
          provider: "slack",
          kind: "announcement",
          target: where,
          incidentId: a.incidentId,
          ok: r.ok,
          error: r.ok ? null : r.error,
        },
        tx,
      );
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
    // The administrator turned direct-message pages off in Settings › Slack & Teams.
    if (!install.settings.dmPages) return { ok: false, error: "dm_pages_off" };
    const [who] = await tx
      .select({ id: members.id, name: members.name })
      .from(chatIdentities)
      .innerJoin(members, eq(members.id, chatIdentities.memberId))
      .where(
        and(
          eq(chatIdentities.tenantId, tenantId),
          eq(chatIdentities.kind, "slack"),
          eq(chatIdentities.externalUserId, slackUserId),
        ),
      );
    const api = slack(install.token);
    const channel = (await api.openDm(slackUserId)) ?? slackUserId;
    const r = await api.postMessage(
      channel,
      `${message.subject} — ${message.text}`,
      escalationDmBlocks(message),
    );
    await recordChatEvent(
      tenantId,
      {
        provider: "slack",
        kind: "page",
        target: who?.name ?? slackUserId,
        detail: message.subject,
        memberId: who?.id ?? null,
        ok: r.ok,
        error: r.ok ? null : r.error,
        meta: r.ok ? { ref: `${r.channel}:${r.ts}` } : {},
      },
      tx,
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
  await markChatPageAcknowledged(tenantId, "slack", `${ref.channelId}:${ref.ts}`, by);
}

/** Links a member to their Slack user by email; remembers it. */
export async function linkSlackIdentity(
  tx: Tx,
  tenantId: string,
  api: SlackClient,
  member: { id: string; email: string; name?: string },
): Promise<string | null> {
  const [existing] = await tx
    .select({ externalUserId: chatIdentities.externalUserId })
    .from(chatIdentities)
    .where(and(eq(chatIdentities.memberId, member.id), eq(chatIdentities.kind, "slack")));
  if (existing) return existing.externalUserId;
  const user = await api.lookupByEmail(member.email);
  // Remembered either way: a miss is what tells the People section "no Slack account".
  await recordChatEvent(
    tenantId,
    {
      provider: "slack",
      kind: "lookup",
      target: member.name ?? member.email,
      detail: member.email,
      memberId: member.id,
      ok: Boolean(user),
      error: user ? null : "users_not_found",
    },
    tx,
  );
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

/**
 * The root cause analysis in the incident channel: posted once, then updated
 * in place at every assessment. Returns where the message is, or null when the
 * incident has no Slack channel.
 */
export async function postInvestigation(
  tenantId: string,
  incidentId: string,
  view: InvestigationView,
  ref: { channelId?: string; ts?: string } | null,
): Promise<{ channelId: string; ts: string } | null> {
  return withTenant(tenantId, async (tx) => {
    const [ch] = await tx
      .select()
      .from(incidentChannels)
      .where(and(eq(incidentChannels.incidentId, incidentId), eq(incidentChannels.kind, "slack")));
    if (!ch) return null;
    const install = await getSlackInstall(tx, tenantId);
    if (!install || !install.settings.postRca) return null;
    const api = slack(install.token);
    const text = investigationText(view);
    const blocks = investigationBlocks(view);
    const where = `#${ch.channelName}`;
    if (ref?.channelId && ref.ts) {
      const r = await api.updateMessage(ref.channelId, ref.ts, text, blocks);
      if (r.ok) {
        await recordChatEvent(
          tenantId,
          { provider: "slack", kind: "rca", target: where, incidentId, meta: { edited: true } },
          tx,
        );
        return { channelId: ref.channelId, ts: ref.ts };
      }
    }
    const r = await api.postMessage(ch.channelId, text, blocks);
    await recordChatEvent(
      tenantId,
      {
        provider: "slack",
        kind: "rca",
        target: where,
        incidentId,
        ok: r.ok,
        error: r.ok ? null : r.error,
      },
      tx,
    );
    return r.ok ? { channelId: r.channel, ts: r.ts } : null;
  });
}

/**
 * An alert in the channel a rule names — one message per alert: posted when
 * it fires, edited in place when it resolves.
 */
export async function postAlertToChannel(
  tenantId: string,
  channelId: string,
  view: AlertChannelView,
): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const install = await getSlackInstall(tx, tenantId);
    if (!install) return false;
    const api = slack(install.token);
    const alertId = /\/alerts\/([0-9a-f-]{36})/.exec(view.url)?.[1] ?? null;
    const text = `${view.status === "resolved" ? "Resolved" : "Alert"}: ${view.title}`;
    const blocks = alertChannelBlocks(view);
    // The message of the firing, when there was one: resolved in place.
    const [first] =
      alertId && view.status === "resolved"
        ? await tx
            .select({ meta: chatEvents.meta })
            .from(chatEvents)
            .where(
              and(
                eq(chatEvents.tenantId, tenantId),
                eq(chatEvents.provider, "slack"),
                eq(chatEvents.kind, "alert"),
                sql`${chatEvents.meta}->>'alertId' = ${alertId}`,
                sql`${chatEvents.meta}->>'ts' is not null`,
              ),
            )
            .orderBy(desc(chatEvents.createdAt))
            .limit(1)
        : [];
    const ref = first?.meta as { ts?: string; channel?: string } | undefined;
    const r =
      ref?.ts && ref.channel
        ? await api.updateMessage(ref.channel, ref.ts, text, blocks)
        : await api.postMessage(channelId, text, blocks);
    const [route] = await tx
      .select({ notify: alertRoutes.notify })
      .from(alertRoutes)
      .where(
        and(
          eq(alertRoutes.tenantId, tenantId),
          sql`${alertRoutes.notify}->>'slackChannelId' = ${channelId}`,
        ),
      )
      .limit(1);
    const name = route?.notify?.slackChannelName;
    await recordChatEvent(
      tenantId,
      {
        provider: "slack",
        kind: "alert",
        target: name ? `#${name.replace(/^#/, "")}` : channelId,
        detail: view.title,
        ok: r.ok,
        error: r.ok ? null : r.error,
        meta: {
          resolved: view.status === "resolved",
          ...(alertId ? { alertId } : {}),
          ...(r.ok && !ref?.ts ? { ts: r.ts, channel: channelId } : {}),
        },
      },
      tx,
    );
    return r.ok;
  });
}

/** "Atlas acted" in the incident's Slack channel. False when there is no channel to tell. */
export async function postAtlasActedSlack(
  tenantId: string,
  view: AtlasActedView,
): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const [ch] = await tx
      .select()
      .from(incidentChannels)
      .where(
        and(eq(incidentChannels.incidentId, view.incidentId), eq(incidentChannels.kind, "slack")),
      );
    if (!ch) return false;
    const install = await getSlackInstall(tx, tenantId);
    if (!install) return false;
    const r = await slack(install.token).postMessage(
      ch.channelId,
      `Atlas acted (level ${view.level}): ${view.title}`,
      atlasActedBlocks(view),
    );
    await recordChatEvent(
      tenantId,
      {
        provider: "slack",
        kind: "atlas",
        target: `#${ch.channelName}`,
        detail: view.title,
        incidentId: view.incidentId,
        ok: r.ok,
        error: r.ok ? null : r.error,
        meta: { actionId: view.actionId, level: view.level },
      },
      tx,
    );
    return r.ok;
  });
}

/** An update draft by Atlas in the incident's Slack channel — when the administrator asked for them. */
export async function postAtlasDraftSlack(
  tenantId: string,
  incidentId: string,
  draft: { reference: string; message: string },
): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const [ch] = await tx
      .select()
      .from(incidentChannels)
      .where(and(eq(incidentChannels.incidentId, incidentId), eq(incidentChannels.kind, "slack")));
    if (!ch) return false;
    const install = await getSlackInstall(tx, tenantId);
    if (!install || !install.settings.atlasDrafts) return false;
    const r = await slack(install.token).postMessage(
      ch.channelId,
      `Update draft by Atlas — ${draft.reference}`,
      atlasDraftBlocks({ reference: draft.reference, incidentId, message: draft.message }),
    );
    await recordChatEvent(
      tenantId,
      {
        provider: "slack",
        kind: "draft",
        target: `#${ch.channelName}`,
        incidentId,
        ok: r.ok,
        error: r.ok ? null : r.error,
      },
      tx,
    );
    return r.ok;
  });
}

/**
 * The test of the settings: a real message in the announcement channel, or
 * to the person who asked when there is none. Says where it went, or why not.
 */
export async function sendSlackTest(
  tenantId: string,
  by: { memberId: string; name: string; email: string },
  workspace: string,
  url: string,
): Promise<{ ok: boolean; where: string; error?: string }> {
  return withTenant(tenantId, async (tx) => {
    const install = await getSlackInstall(tx, tenantId);
    if (!install) return { ok: false, where: "", error: "slack_not_installed" };
    const api = slack(install.token);
    let channel = install.config.announceChannelId;
    let where = install.config.announceChannelName ? `#${install.config.announceChannelName}` : "";
    if (!channel) {
      const me = await linkSlackIdentity(tx, tenantId, api, {
        id: by.memberId,
        email: by.email,
        name: by.name,
      });
      channel = me ? ((await api.openDm(me)) ?? me) : null;
      where = by.name;
    }
    if (!channel) return { ok: false, where, error: "users_not_found" };
    const r = await api.postMessage(
      channel,
      `Open Incident is connected to Slack — a test ${by.name} asked for.`,
      testBlocks({ workspace, by: by.name, url }),
    );
    await recordChatEvent(
      tenantId,
      {
        provider: "slack",
        kind: "test",
        target: where,
        memberId: by.memberId,
        ok: r.ok,
        error: r.ok ? null : r.error,
      },
      tx,
    );
    return r.ok ? { ok: true, where } : { ok: false, where, error: r.error };
  });
}
