/**
 * Outbound tokens — client credentials against Azure AD, one per audience
 * (Bot Connector, Graph), cached until a minute before they expire.
 */
import { teamsAppId, teamsAppSecret, teamsLoginBase } from "./config";

const cache = new Map<string, { token: string; expiresAt: number }>();

async function fetchToken(tenant: string, scope: string): Promise<string> {
  const key = `${tenant}|${scope}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: teamsAppId(),
    client_secret: teamsAppSecret(),
    scope,
  });
  const res = await fetch(`${teamsLoginBase()}/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`teams_token_${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cache.set(key, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  return data.access_token;
}

/** Token for the Bot Connector (posting activities). */
export function connectorToken(): Promise<string> {
  return fetchToken("botframework.com", "https://api.botframework.com/.default");
}

/** Token for Microsoft Graph in the customer's Azure AD tenant. */
export function graphToken(aadTenantId: string): Promise<string> {
  return fetchToken(aadTenantId, "https://graph.microsoft.com/.default");
}

export function resetTeamsTokenCache(): void {
  cache.clear();
}
