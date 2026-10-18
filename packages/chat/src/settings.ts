/**
 * What an administrator decides on Settings › Slack & Teams beyond the
 * connection itself — the same keys for both tools, kept in the install's
 * `config` next to the provider's own settings, each with its default.
 *
 * Every switch here changes what the adapter does; none is decorative:
 *
 * - `autoInvite`     the declarer and the role holders join the channel (Slack:
 *                    invited; Teams: standard channels are open to the whole
 *                    team, so they are mentioned and notified instead);
 * - `inviteOnCall`   the person on call for the incident's service joins too;
 * - `dmPages`        pages may be delivered as a direct message with Acknowledge;
 * - `postRca`        the root cause analysis is posted in the incident channel;
 * - `atlasDrafts`    Atlas suggests update drafts in the channel, labelled, for
 *                    a person to publish.
 */
import { and, eq, sql } from "drizzle-orm";
import { integrationInstalls, type ChatProvider, type Tx } from "@openincident/db";

export type ChatSettings = {
  autoInvite: boolean;
  inviteOnCall: boolean;
  dmPages: boolean;
  postRca: boolean;
  atlasDrafts: boolean;
  /** When the current connection was made (install or pairing) — "installed … Sep 30". */
  installedAt: string | null;
  /** Teams: the organisation's domain, read from the person who paired ("tenant skylark.io"). */
  tenantDomain: string | null;
};

export const CHAT_SETTINGS_DEFAULT: Omit<ChatSettings, "installedAt" | "tenantDomain"> = {
  autoInvite: true,
  inviteOnCall: true,
  dmPages: true,
  postRca: true,
  atlasDrafts: false,
};

export const CHAT_SETTING_KEYS = [
  "autoInvite",
  "inviteOnCall",
  "dmPages",
  "postRca",
  "atlasDrafts",
] as const;
export type ChatSettingKey = (typeof CHAT_SETTING_KEYS)[number];

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

/** The settings of an install, read from its raw config with the defaults filled in. */
export function chatSettings(config: Record<string, unknown> | null | undefined): ChatSettings {
  const c = config ?? {};
  return {
    autoInvite: bool(c.autoInvite, CHAT_SETTINGS_DEFAULT.autoInvite),
    inviteOnCall: bool(c.inviteOnCall, CHAT_SETTINGS_DEFAULT.inviteOnCall),
    dmPages: bool(c.dmPages, CHAT_SETTINGS_DEFAULT.dmPages),
    postRca: bool(c.postRca, CHAT_SETTINGS_DEFAULT.postRca),
    atlasDrafts: bool(c.atlasDrafts, CHAT_SETTINGS_DEFAULT.atlasDrafts),
    installedAt: typeof c.installedAt === "string" ? c.installedAt : null,
    tenantDomain: typeof c.tenantDomain === "string" ? c.tenantDomain : null,
  };
}

/** The raw config of the workspace's install of a tool, whatever its state. */
export async function rawChatConfig(
  tx: Tx,
  tenantId: string,
  provider: ChatProvider,
): Promise<Record<string, unknown> | null> {
  const [row] = await tx
    .select({ config: integrationInstalls.config, status: integrationInstalls.status })
    .from(integrationInstalls)
    .where(and(eq(integrationInstalls.tenantId, tenantId), eq(integrationInstalls.kind, provider)));
  return row && row.status === "active" ? row.config : null;
}

/**
 * Merges a patch into the install's config — never replaces it, so that a key
 * one screen does not know survives another screen's save.
 */
export async function patchChatConfig(
  tx: Tx,
  tenantId: string,
  provider: ChatProvider,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const rows = await tx
    .update(integrationInstalls)
    .set({
      config: sql`${integrationInstalls.config} || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(integrationInstalls.tenantId, tenantId),
        eq(integrationInstalls.kind, provider),
        eq(integrationInstalls.status, "active"),
      ),
    )
    .returning({ id: integrationInstalls.id });
  return rows.length > 0;
}

/** Whether pages may go to this tool as a direct message — the admin's "Offer … as a notification method". */
export async function chatPagesOffered(
  tx: Tx,
  tenantId: string,
  provider: ChatProvider,
): Promise<boolean> {
  const config = await rawChatConfig(tx, tenantId, provider);
  return config ? chatSettings(config).dmPages : false;
}
