/**
 * A thin Slack Web API client on fetch. The base URL is configurable so the
 * smoke test can point the whole product at a mock — everything else is the
 * real protocol: form-encoded or JSON bodies, `ok` envelopes, bot tokens.
 */

export type SlackResult<T = Record<string, unknown>> =
  ({ ok: true } & T) | { ok: false; error: string };

export function slackApiBase(): string {
  return (process.env.SLACK_API_BASE ?? "https://slack.com/api").replace(/\/$/, "");
}

/** Whether the instance knows a Slack app at all (client id/secret + signing secret). */
export function slackConfigured(): boolean {
  return Boolean(
    process.env.SLACK_CLIENT_ID &&
    process.env.SLACK_CLIENT_SECRET &&
    process.env.SLACK_SIGNING_SECRET,
  );
}

export async function slackCall<T = Record<string, unknown>>(
  token: string | null,
  method: string,
  params: Record<string, unknown> = {},
  form = false,
): Promise<SlackResult<T>> {
  const headers: Record<string, string> = { authorization: token ? `Bearer ${token}` : "" };
  let body: string;
  if (form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]),
      ),
    ).toString();
  } else {
    headers["content-type"] = "application/json; charset=utf-8";
    body = JSON.stringify(params);
  }
  try {
    const res = await fetch(`${slackApiBase()}/${method}`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(8_000),
    });
    const json = (await res
      .json()
      .catch(() => ({ ok: false, error: `http_${res.status}` }))) as SlackResult<T>;
    return json;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type SlackChannel = {
  id: string;
  name: string;
  is_archived?: boolean;
  is_private?: boolean;
};
export type SlackUser = {
  id: string;
  name?: string;
  real_name?: string;
  profile?: { email?: string; real_name?: string; display_name?: string };
};

/** Bound helpers for one bot token. */
export function slack(token: string) {
  return {
    authTest: () =>
      slackCall<{ team_id: string; team: string; user_id: string; bot_id?: string }>(
        token,
        "auth.test",
      ),
    createChannel: (name: string) =>
      slackCall<{ channel: SlackChannel }>(token, "conversations.create", {
        name,
        is_private: false,
      }),
    setTopic: (channel: string, topic: string) =>
      slackCall(token, "conversations.setTopic", { channel, topic: topic.slice(0, 250) }),
    invite: (channel: string, users: string[]) =>
      users.length
        ? slackCall(token, "conversations.invite", { channel, users: users.join(",") })
        : Promise.resolve({ ok: true } as SlackResult),
    listChannels: async (): Promise<SlackChannel[]> => {
      const out: SlackChannel[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 5; i++) {
        const r = await slackCall<{
          channels: SlackChannel[];
          response_metadata?: { next_cursor?: string };
        }>(
          token,
          "conversations.list",
          {
            exclude_archived: true,
            limit: 200,
            types: "public_channel",
            ...(cursor ? { cursor } : {}),
          },
          true,
        );
        if (!r.ok) break;
        out.push(...r.channels);
        cursor = r.response_metadata?.next_cursor || undefined;
        if (!cursor) break;
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },
    postMessage: (
      channel: string,
      text: string,
      blocks?: unknown[],
      extra: Record<string, unknown> = {},
    ) =>
      slackCall<{ ts: string; channel: string }>(token, "chat.postMessage", {
        channel,
        text,
        ...(blocks ? { blocks } : {}),
        unfurl_links: false,
        ...extra,
      }),
    updateMessage: (channel: string, ts: string, text: string, blocks?: unknown[]) =>
      slackCall<{ ts: string }>(token, "chat.update", {
        channel,
        ts,
        text,
        ...(blocks ? { blocks } : {}),
      }),
    postEphemeral: (channel: string, user: string, text: string, blocks?: unknown[]) =>
      slackCall(token, "chat.postEphemeral", {
        channel,
        user,
        text,
        ...(blocks ? { blocks } : {}),
      }),
    pin: (channel: string, timestamp: string) =>
      slackCall(token, "pins.add", { channel, timestamp }),
    lookupByEmail: async (email: string): Promise<SlackUser | null> => {
      const r = await slackCall<{ user: SlackUser }>(token, "users.lookupByEmail", { email }, true);
      return r.ok ? r.user : null;
    },
    userInfo: async (user: string): Promise<SlackUser | null> => {
      const r = await slackCall<{ user: SlackUser }>(token, "users.info", { user }, true);
      return r.ok ? r.user : null;
    },
    openView: (triggerId: string, view: unknown) =>
      slackCall<{ view: { id: string } }>(token, "views.open", { trigger_id: triggerId, view }),
    history: async (
      channel: string,
      ts: string,
    ): Promise<{ text: string; user?: string } | null> => {
      const r = await slackCall<{ messages: Array<{ text: string; user?: string; ts: string }> }>(
        token,
        "conversations.history",
        { channel, latest: ts, oldest: ts, inclusive: true, limit: 1 },
        true,
      );
      return r.ok ? (r.messages[0] ?? null) : null;
    },
    permalink: async (channel: string, ts: string): Promise<string | null> => {
      const r = await slackCall<{ permalink: string }>(
        token,
        "chat.getPermalink",
        { channel, message_ts: ts },
        true,
      );
      return r.ok ? r.permalink : null;
    },
    openDm: async (user: string): Promise<string | null> => {
      const r = await slackCall<{ channel: { id: string } }>(token, "conversations.open", {
        users: user,
      });
      return r.ok ? r.channel.id : null;
    },
  };
}

export type SlackClient = ReturnType<typeof slack>;
