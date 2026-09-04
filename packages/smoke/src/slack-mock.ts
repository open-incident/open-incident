import { createServer, type Server } from "node:http";

/**
 * A mock of the Slack Web API for the smoke suite: enough of oauth, channels,
 * messages, users and views to run the product's Slack surface end to end.
 * Every call is recorded and readable by the test. Runs on the port the web
 * server was started with (SLACK_API_BASE=http://127.0.0.1:3197).
 */
export type Call = { method: string; body: Record<string, unknown>; response?: unknown };

export function startSlackMock(
  port = 3197,
): Promise<{ server: Server; calls: Call[]; reset: () => void }> {
  const calls: Call[] = [];
  let channelSeq = 100;
  let tsSeq = 1_700_000_000;
  const users: Record<string, { id: string; email: string; real_name: string }> = {
    U_AMELIE: { id: "U_AMELIE", email: "amelie@skylark.dev", real_name: "Amélie Laurent" },
    U_KARIM: { id: "U_KARIM", email: "karim@skylark.dev", real_name: "Karim Haddad" },
    U_NADIA: { id: "U_NADIA", email: "nadia@skylark.dev", real_name: "Nadia Benali" },
    U_LUCAS: { id: "U_LUCAS", email: "lucas@skylark.dev", real_name: "Lucas Girard" },
    U_STRANGER: { id: "U_STRANGER", email: "stranger@example.com", real_name: "Stranger" },
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = url.pathname.replace(/^\//, "");
    let current: Call | null = null;
    const json = (o: unknown) => {
      if (current) current.response = o;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(o));
    };
    if (req.method === "GET" && method === "_calls") return json(calls);
    if (req.method === "GET" && method === "oauth/v2/authorize") {
      const redirect = url.searchParams.get("redirect_uri") ?? "";
      const state = url.searchParams.get("state") ?? "";
      calls.push({
        method,
        body: { redirect_uri: redirect, scope: url.searchParams.get("scope") },
      });
      res.writeHead(302, {
        location: `${redirect}?code=mock-code&state=${encodeURIComponent(state)}`,
      });
      return res.end();
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body: Record<string, unknown> = {};
      const ct = req.headers["content-type"] ?? "";
      try {
        body = ct.includes("json")
          ? (JSON.parse(raw || "{}") as Record<string, unknown>)
          : Object.fromEntries(new URLSearchParams(raw).entries());
      } catch {
        body = {};
      }
      current = { method, body };
      calls.push(current);
      switch (method) {
        case "oauth.v2.access":
          return json({
            ok: true,
            access_token: "xoxb-mock-token",
            bot_user_id: "U_BOT",
            app_id: "A_MOCK",
            team: { id: "T_SMOKE", name: "Skylark (mock)" },
          });
        case "auth.test":
          return json({ ok: true, team_id: "T_SMOKE", team: "Skylark (mock)", user_id: "U_BOT" });
        case "conversations.list":
          return json({
            ok: true,
            channels: [
              { id: "C_ANNOUNCE", name: "annonces-incidents" },
              { id: "C_GENERAL", name: "general" },
            ],
            response_metadata: { next_cursor: "" },
          });
        case "conversations.create": {
          const name = String(body.name ?? "inc");
          if (
            calls.filter((c) => c.method === "conversations.create" && c.body.name === name)
              .length > 1
          )
            return json({ ok: false, error: "name_taken" });
          channelSeq += 1;
          return json({
            ok: true,
            channel: { id: `C_${Date.now().toString(36).toUpperCase()}${channelSeq}`, name },
          });
        }
        case "conversations.setTopic":
        case "conversations.invite":
        case "pins.add":
        case "chat.postEphemeral":
        case "views.open":
          return json({ ok: true });
        case "conversations.open":
          return json({ ok: true, channel: { id: `D_${String(body.users ?? "X")}` } });
        case "chat.postMessage":
          tsSeq += 1;
          return json({ ok: true, ts: `${tsSeq}.000100`, channel: String(body.channel ?? "") });
        case "chat.update":
          return json({ ok: true, ts: String(body.ts ?? "") });
        case "chat.getPermalink":
          return json({
            ok: true,
            permalink: `https://skylark-mock.slack.com/archives/${String(body.channel)}/p${String(body.message_ts).replace(".", "")}`,
          });
        case "users.lookupByEmail": {
          const u = Object.values(users).find(
            (x) => x.email === String(body.email ?? "").toLowerCase(),
          );
          return json(
            u
              ? {
                  ok: true,
                  user: {
                    id: u.id,
                    real_name: u.real_name,
                    profile: { email: u.email, real_name: u.real_name },
                  },
                }
              : { ok: false, error: "users_not_found" },
          );
        }
        case "users.info": {
          const u = users[String(body.user ?? "")];
          return json(
            u
              ? {
                  ok: true,
                  user: {
                    id: u.id,
                    real_name: u.real_name,
                    profile: { email: u.email, real_name: u.real_name },
                  },
                }
              : { ok: false, error: "user_not_found" },
          );
        }
        case "conversations.history":
          return json({
            ok: true,
            messages: [
              {
                text: "Root cause found: the connection pool of checkout-api is exhausted since the 13:55 deploy.",
                user: "U_KARIM",
                ts: String(body.latest ?? "1.0"),
              },
            ],
          });
        default:
          return json({ ok: false, error: `mock_unknown_method_${method}` });
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () =>
      resolve({ server, calls, reset: () => calls.splice(0, calls.length) }),
    );
  });
}
