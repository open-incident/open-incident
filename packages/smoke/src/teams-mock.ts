import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { createServer, type Server } from "node:http";

/**
 * A mock of Microsoft for the smoke suite: Azure AD tokens, the Bot
 * Framework's OpenID keys (the mock signs activities with its own RSA key,
 * which the product verifies for real), the Bot Connector conversation API
 * and the two Graph calls the product makes. Everything is recorded.
 */
export type TeamsCall = { method: string; path: string; body: Record<string, unknown> };

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function startTeamsMock(port = 3196): Promise<{
  server: Server;
  calls: TeamsCall[];
  channels: Map<string, { id: string; displayName: string; webUrl: string }>;
  activities: Array<{ conversationId: string; id: string; activity: Record<string, unknown> }>;
  token: (claims?: Record<string, unknown>) => string;
  appId: string;
}> {
  const appId = process.env.TEAMS_APP_ID ?? "smoke-teams-app";
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = `smoke-${Date.now().toString(36)}`;
  const jwk = {
    ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>),
    kid,
    use: "sig",
    alg: "RS256",
  };
  const token = (claims: Record<string, unknown> = {}) => {
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
    const now = Math.floor(Date.now() / 1000);
    const payload = b64url(
      JSON.stringify({
        iss: "https://api.botframework.com",
        aud: appId,
        exp: now + 600,
        nbf: now - 60,
        serviceurl: `http://127.0.0.1:${port}/connector`,
        ...claims,
      }),
    );
    const sig = createSign("RSA-SHA256")
      .update(`${header}.${payload}`)
      .sign(privateKey as KeyObject);
    return `${header}.${payload}.${b64url(sig)}`;
  };
  const calls: TeamsCall[] = [];
  const channels = new Map<string, { id: string; displayName: string; webUrl: string }>();
  channels.set("19:general@thread.tacv2", {
    id: "19:general@thread.tacv2",
    displayName: "General",
    webUrl: "https://teams.microsoft.com/l/channel/general",
  });
  channels.set("19:ops@thread.tacv2", {
    id: "19:ops@thread.tacv2",
    displayName: "Ops",
    webUrl: "https://teams.microsoft.com/l/channel/ops",
  });
  const activities: Array<{
    conversationId: string;
    id: string;
    activity: Record<string, unknown>;
  }> = [];
  let seq = 1000;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const json = (o: unknown, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(o));
    };
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body: Record<string, unknown> = {};
      if (raw) {
        try {
          body = req.headers["content-type"]?.includes("json")
            ? (JSON.parse(raw) as Record<string, unknown>)
            : Object.fromEntries(new URLSearchParams(raw));
        } catch {
          body = {};
        }
      }
      calls.push({ method: req.method ?? "GET", path: url.pathname, body });
      const p = url.pathname;
      if (p === "/_calls") return json(calls);
      if (p === "/_token") return json({ token: token(body as Record<string, unknown>) });
      if (p === "/openid")
        return json({
          issuer: "https://api.botframework.com",
          jwks_uri: `http://127.0.0.1:${port}/jwks`,
        });
      if (p === "/jwks") return json({ keys: [jwk] });
      if (/^\/login\/[^/]+\/oauth2\/v2\.0\/token$/.test(p)) {
        if (body.client_id !== appId) return json({ error: "invalid_client" }, 401);
        return json({
          token_type: "Bearer",
          expires_in: 3599,
          access_token: `mock-${String(body.scope).includes("graph") ? "graph" : "connector"}-token`,
        });
      }
      if (!(req.headers.authorization ?? "").startsWith("Bearer mock-"))
        return json({ error: "unauthorized" }, 401);
      // Graph
      let m = p.match(/^\/graph\/teams\/([^/]+)\/channels$/);
      if (m && req.method === "GET") return json({ value: [...channels.values()] });
      if (m && req.method === "POST") {
        const name = String(body.displayName ?? "channel");
        if ([...channels.values()].some((c) => c.displayName === name))
          return json({ error: { message: "Name already exists" } }, 409);
        const id = `19:${name.replace(/[^a-z0-9-]/gi, "").toLowerCase()}-${++seq}@thread.tacv2`;
        const ch = {
          id,
          displayName: name,
          webUrl: `https://teams.microsoft.com/l/channel/${encodeURIComponent(id)}`,
        };
        channels.set(id, ch);
        return json(ch, 201);
      }
      m = p.match(/^\/graph\/users\/([^/]+)$/);
      if (m) {
        const key = decodeURIComponent(m[1]!);
        if (key.includes("@"))
          return json({
            id: `aad-${key.split("@")[0]}`,
            displayName: key.split("@")[0],
            mail: key,
            userPrincipalName: key,
          });
        if (key.startsWith("aad-"))
          return json({
            id: key,
            displayName: key.slice(4),
            mail: `${key.slice(4)}@skylark.dev`,
            userPrincipalName: `${key.slice(4)}@skylark.dev`,
          });
        return json({ error: { code: "Request_ResourceNotFound" } }, 404);
      }
      // Bot Connector
      if (p === "/connector/v3/conversations" && req.method === "POST") {
        const id =
          body.isGroup === false
            ? `a:personal-${String((body.members as Array<{ id: string }> | undefined)?.[0]?.id ?? "x")}`
            : `${String((body.channelData as { channel?: { id?: string } } | undefined)?.channel?.id ?? "19:x")};messageid=${++seq}`;
        const activityId = String(++seq);
        if (body.activity)
          activities.push({
            conversationId: id,
            id: activityId,
            activity: body.activity as Record<string, unknown>,
          });
        return json({ id, activityId });
      }
      m = p.match(/^\/connector\/v3\/conversations\/([^/]+)\/activities(?:\/([^/]+))?$/);
      if (m && req.method === "POST") {
        const id = String(++seq);
        activities.push({ conversationId: decodeURIComponent(m[1]!), id, activity: body });
        return json({ id });
      }
      if (m && req.method === "PUT") {
        const existing = activities.find((a) => a.id === decodeURIComponent(m![2] ?? ""));
        if (existing) existing.activity = body;
        return json({ id: m[2] });
      }
      m = p.match(/^\/connector\/v3\/conversations\/([^/]+)\/members$/);
      if (m)
        return json([
          {
            id: "29:amelie",
            aadObjectId: "aad-amelie",
            email: "amelie@skylark.dev",
            name: "Amélie Laurent",
          },
        ]);
      return json({ error: `mock: unknown ${req.method} ${p}` }, 404);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () =>
      resolve({ server, calls, channels, activities, token, appId }),
    );
  });
}
