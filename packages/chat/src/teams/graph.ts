/**
 * Microsoft Graph — the channels of the paired team, and nothing else.
 *
 * Granted as resource-specific consent (RSC) by the team's owner when the app
 * is added to the team: `Channel.Create.Group` and `ChannelSettings.Read.Group`,
 * scoped to that one team. No tenant-wide permission, so no global
 * administrator: people are found through the bot's roster (adapter.ts), not
 * Graph `/users`.
 */
import { graphToken } from "./auth";
import { teamsGraphBase } from "./config";

export type GraphResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function call<T>(
  aadTenantId: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<GraphResult<T>> {
  try {
    const token = await graphToken(aadTenantId);
    const res = await fetch(`${teamsGraphBase()}${path}`, {
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

export type GraphChannel = {
  id: string;
  displayName: string;
  webUrl?: string;
  membershipType?: string;
};

export const teamsGraph = {
  listChannels(aadTenantId: string, teamId: string) {
    return call<{ value: GraphChannel[] }>(
      aadTenantId,
      "GET",
      `/teams/${encodeURIComponent(teamId)}/channels`,
    );
  },
  createChannel(aadTenantId: string, teamId: string, displayName: string, description: string) {
    return call<GraphChannel>(
      aadTenantId,
      "POST",
      `/teams/${encodeURIComponent(teamId)}/channels`,
      {
        displayName: displayName.slice(0, 50),
        description: description.slice(0, 1024),
        membershipType: "standard",
      },
    );
  },
};
