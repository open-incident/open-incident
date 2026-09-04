/**
 * Inbound activities carry a JWT signed by the Bot Framework. It is verified
 * for real: signature against the published JWKS, audience = our app id,
 * issuer, expiry, and the service URL claim when present. No shared secret,
 * no "trust the header" shortcut.
 */
import { createPublicKey, verify as verifySignature, type JsonWebKey } from "node:crypto";
import { teamsAppId, teamsOpenIdConfigUrl } from "./config";

type Jwk = JsonWebKey & { kid?: string; endorsements?: string[] };
let keyCache: { keys: Jwk[]; fetchedAt: number } | null = null;

async function keys(force = false): Promise<Jwk[]> {
  if (!force && keyCache && Date.now() - keyCache.fetchedAt < 60 * 60_000) return keyCache.keys;
  const cfg = (await (
    await fetch(teamsOpenIdConfigUrl(), { signal: AbortSignal.timeout(10_000) })
  ).json()) as { jwks_uri: string };
  const jwks = (await (
    await fetch(cfg.jwks_uri, { signal: AbortSignal.timeout(10_000) })
  ).json()) as { keys: Jwk[] };
  keyCache = { keys: jwks.keys, fetchedAt: Date.now() };
  return jwks.keys;
}

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export type VerifiedActivityToken = { appId: string; serviceUrl: string | null };

/** Returns the verified claims, or null — the caller answers 401. */
export async function verifyTeamsToken(
  authorization: string | null,
  activityServiceUrl: string | null,
): Promise<VerifiedActivityToken | null> {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: { alg?: string; kid?: string };
  let payload: { aud?: string; iss?: string; exp?: number; nbf?: number; serviceurl?: string };
  try {
    header = JSON.parse(b64url(parts[0]!).toString("utf8"));
    payload = JSON.parse(b64url(parts[1]!).toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || !header.kid) return null;
  if (payload.aud !== teamsAppId()) return null;
  if (payload.iss !== "https://api.botframework.com") return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now - 300) return null;
  if (typeof payload.nbf === "number" && payload.nbf > now + 300) return null;
  if (
    payload.serviceurl &&
    activityServiceUrl &&
    payload.serviceurl.replace(/\/$/, "") !== activityServiceUrl.replace(/\/$/, "")
  )
    return null;
  const check = (jwk: Jwk | undefined): boolean => {
    if (!jwk) return false;
    try {
      const key = createPublicKey({ key: jwk, format: "jwk" });
      return verifySignature(
        "RSA-SHA256",
        Buffer.from(`${parts[0]}.${parts[1]}`),
        key,
        b64url(parts[2]!),
      );
    } catch {
      return false;
    }
  };
  // Keys rotate: a kid we do not know, or a signature the cached key refuses,
  // earns one fresh fetch of the published keys before the answer is no.
  let ok = check((await keys()).find((k) => k.kid === header.kid));
  if (!ok) ok = check((await keys(true)).find((k) => k.kid === header.kid));
  if (!ok) return null;
  return { appId: payload.aud, serviceUrl: payload.serviceurl ?? null };
}

export function resetTeamsKeyCache(): void {
  keyCache = null;
}
