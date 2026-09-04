import { createSign, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { createServer, type Server } from "node:http";

/**
 * A mock OpenID Connect provider for the smoke suite — discovery, authorize
 * (no screen: it redirects straight back with a code), token (RS256 id_token),
 * JWKS and userinfo. Every run signs with a fresh key and a fresh `kid`, so a
 * stale cache would be caught rather than tolerated.
 */
export type OidcUser = { sub: string; email: string; name: string };

export function startOidcMock(
  port = 3195,
  user: OidcUser = {
    sub: `sso-${Date.now().toString(36)}`,
    email: `sso-${Date.now().toString(36)}@smoke.example`,
    name: "Sam Single",
  },
): Promise<{ server: Server; issuer: string; user: OidcUser; codes: number }> {
  const issuer = `http://127.0.0.1:${port}`;
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = `oidc-${Date.now().toString(36)}`;
  const jwk = {
    ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>),
    kid,
    use: "sig",
    alg: "RS256",
  };
  const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");
  const sign = (payload: Record<string, unknown>) => {
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
    const body = b64url(JSON.stringify(payload));
    const sig = createSign("RSA-SHA256")
      .update(`${header}.${body}`)
      .sign(privateKey as KeyObject)
      .toString("base64url");
    return `${header}.${body}.${sig}`;
  };
  const codes = new Map<string, { nonce?: string; clientId: string }>();
  const tokens = new Set<string>();
  const state = { server: null as unknown as Server, issuer, user, codes: 0 };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", issuer);
    const json = (o: unknown, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(o));
    };
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (url.pathname === "/.well-known/openid-configuration")
        return json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          userinfo_endpoint: `${issuer}/userinfo`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          scopes_supported: ["openid", "email", "profile"],
          token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
          code_challenge_methods_supported: ["S256"],
        });
      if (url.pathname === "/jwks") return json({ keys: [jwk] });
      if (url.pathname === "/authorize") {
        const redirect = url.searchParams.get("redirect_uri") ?? "";
        const code = randomBytes(12).toString("hex");
        codes.set(code, {
          nonce: url.searchParams.get("nonce") ?? undefined,
          clientId: url.searchParams.get("client_id") ?? "",
        });
        state.codes++;
        const back = new URL(redirect);
        back.searchParams.set("code", code);
        const st = url.searchParams.get("state");
        if (st) back.searchParams.set("state", st);
        res.writeHead(302, { location: back.toString() });
        return res.end();
      }
      if (url.pathname === "/token") {
        const params = new URLSearchParams(raw);
        const code = params.get("code") ?? "";
        const issued = codes.get(code);
        if (!issued) return json({ error: "invalid_grant" }, 400);
        codes.delete(code);
        const now = Math.floor(Date.now() / 1000);
        const accessToken = randomBytes(16).toString("hex");
        tokens.add(accessToken);
        return json({
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: 3600,
          scope: "openid email profile",
          id_token: sign({
            iss: issuer,
            aud: issued.clientId,
            sub: state.user.sub,
            email: state.user.email,
            email_verified: true,
            name: state.user.name,
            iat: now,
            exp: now + 3600,
            ...(issued.nonce ? { nonce: issued.nonce } : {}),
          }),
        });
      }
      if (url.pathname === "/userinfo") {
        const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
        if (!tokens.has(token)) return json({ error: "invalid_token" }, 401);
        return json({
          sub: state.user.sub,
          email: state.user.email,
          email_verified: true,
          name: state.user.name,
        });
      }
      return json({ error: `mock: unknown ${req.method} ${url.pathname}` }, 404);
    });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      state.server = server;
      resolve(state);
    });
  });
}
