/** OAuth install of the Slack app: the authorize URL, the code exchange, the state that names the workspace. */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { slackApiBase, slackCall } from "./slack/client";

export const SLACK_BOT_SCOPES = [
  "channels:manage",
  "channels:read",
  "channels:history",
  "chat:write",
  "chat:write.public",
  "commands",
  "pins:write",
  "pins:read",
  "reactions:read",
  "users:read",
  "users:read.email",
  "im:write",
];

function stateSecret(): string {
  return process.env.SLACK_STATE_SECRET ?? process.env.BETTER_AUTH_SECRET ?? "open-incident";
}

/** A signed state: tenant, member, nonce — verified on the way back. */
export function makeInstallState(tenantId: string, memberId: string): string {
  const body = `${tenantId}.${memberId}.${randomBytes(8).toString("hex")}.${Math.floor(Date.now() / 1000)}`;
  const sig = createHmac("sha256", stateSecret()).update(body).digest("hex").slice(0, 32);
  return Buffer.from(`${body}.${sig}`).toString("base64url");
}

export function readInstallState(state: string): { tenantId: string; memberId: string } | null {
  let raw: string;
  try {
    raw = Buffer.from(state, "base64url").toString();
  } catch {
    return null;
  }
  const parts = raw.split(".");
  if (parts.length !== 5) return null;
  const [tenantId, memberId, nonce, ts, sig] = parts as [string, string, string, string, string];
  const body = `${tenantId}.${memberId}.${nonce}.${ts}`;
  const expected = createHmac("sha256", stateSecret()).update(body).digest("hex").slice(0, 32);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig)))
    return null;
  if (Date.now() / 1000 - Number(ts) > 900) return null;
  return { tenantId, memberId };
}

/**
 * Whether an authorize URL points somewhere only this machine can reach.
 *
 * `SLACK_API_BASE` exists so the test suite can stand a mock in Slack's place.
 * Left set on an instance people actually use, the "Authorize in Slack" button
 * sends them to `127.0.0.1:3197` — and a browser that cannot connect shows its
 * own error page, outside the product, with no way back. The person is not
 * merely blocked: they are ejected.
 *
 * So the instance checks its own configuration before handing anybody over. It
 * is a shape check, not a reachability probe: a loopback or link-local host is
 * never a real Slack, and probing the network on the way to an OAuth screen
 * would be slow and would fail for reasons of its own.
 */
export function pointsAtThisMachine(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host === "0.0.0.0"
  );
}

/** Where the "Authorize in Slack" button sends the admin. A mock base rewrites the host for tests. */
export function slackAuthorizeUrl(redirectUri: string, state: string): string {
  const base = process.env.SLACK_API_BASE
    ? `${slackApiBase()}/oauth/v2/authorize`
    : "https://slack.com/oauth/v2/authorize";
  const u = new URL(base);
  u.searchParams.set("client_id", process.env.SLACK_CLIENT_ID ?? "");
  u.searchParams.set("scope", SLACK_BOT_SCOPES.join(","));
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

export type SlackInstallResult = {
  accessToken: string;
  teamId: string;
  teamName: string;
  botUserId: string;
  appId: string | null;
};

export async function exchangeOAuthCode(
  code: string,
  redirectUri: string,
): Promise<SlackInstallResult | { error: string }> {
  const r = await slackCall<{
    access_token: string;
    bot_user_id: string;
    app_id?: string;
    team: { id: string; name: string };
  }>(
    null,
    "oauth.v2.access",
    {
      client_id: process.env.SLACK_CLIENT_ID ?? "",
      client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
      code,
      redirect_uri: redirectUri,
    },
    true,
  );
  if (!r.ok) return { error: r.error };
  return {
    accessToken: r.access_token,
    teamId: r.team.id,
    teamName: r.team.name,
    botUserId: r.bot_user_id,
    appId: r.app_id ?? null,
  };
}
