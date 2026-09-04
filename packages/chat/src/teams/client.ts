/**
 * Bot Connector REST — the few calls the product makes: post an activity in
 * a conversation, update one, start a new thread in a channel, open a
 * personal conversation, list a conversation's members.
 */
import { connectorToken } from "./auth";
import { teamsAppId, teamsServiceUrlOverride } from "./config";

export type Activity = Record<string, unknown>;

export type ConnectorResult<T> = { ok: true; value: T } | { ok: false; error: string };

function base(serviceUrl: string): string {
  return (teamsServiceUrlOverride() ?? serviceUrl).replace(/\/$/, "");
}

async function call<T>(
  serviceUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<ConnectorResult<T>> {
  try {
    const token = await connectorToken();
    const res = await fetch(`${base(serviceUrl)}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok)
      return {
        ok: false,
        error: `${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`,
      };
    const text = await res.text();
    return { ok: true, value: (text ? JSON.parse(text) : {}) as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** A message with an Adaptive Card and a plain-text fallback. */
export function cardActivity(card: unknown, text: string): Activity {
  return {
    type: "message",
    text,
    attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: card }],
  };
}

export function textActivity(text: string): Activity {
  return { type: "message", text, textFormat: "markdown" };
}

export const teamsConnector = {
  /** Posts in an existing conversation (channel thread or personal chat). */
  post(serviceUrl: string, conversationId: string, activity: Activity) {
    return call<{ id: string }>(
      serviceUrl,
      "POST",
      `/v3/conversations/${encodeURIComponent(conversationId)}/activities`,
      activity,
    );
  },
  /** Replaces an activity in place (the living header, the acknowledged DM). */
  update(serviceUrl: string, conversationId: string, activityId: string, activity: Activity) {
    return call<{ id: string }>(
      serviceUrl,
      "PUT",
      `/v3/conversations/${encodeURIComponent(conversationId)}/activities/${encodeURIComponent(activityId)}`,
      activity,
    );
  },
  /** Starts a new thread in a channel; returns the thread's conversation id and the root activity id. */
  startThread(serviceUrl: string, channelId: string, activity: Activity, aadTenantId: string) {
    return call<{ id: string; activityId: string }>(serviceUrl, "POST", "/v3/conversations", {
      isGroup: true,
      channelData: { channel: { id: channelId } },
      tenantId: aadTenantId,
      activity,
    });
  },
  /** Opens (or finds) the personal conversation with a user, by their Azure AD object id. */
  openPersonal(serviceUrl: string, aadTenantId: string, aadObjectId: string) {
    return call<{ id: string }>(serviceUrl, "POST", "/v3/conversations", {
      isGroup: false,
      bot: { id: `28:${teamsAppId()}` },
      members: [{ id: aadObjectId }],
      tenantId: aadTenantId,
      channelData: { tenant: { id: aadTenantId } },
    });
  },
  /** The members of a conversation — with emails when the tenant exposes them. */
  members(serviceUrl: string, conversationId: string) {
    return call<
      Array<{
        id: string;
        aadObjectId?: string;
        email?: string;
        name?: string;
        userPrincipalName?: string;
      }>
    >(serviceUrl, "GET", `/v3/conversations/${encodeURIComponent(conversationId)}/members`);
  },
};
