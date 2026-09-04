/**
 * Access to an internal status page: the product signs a short-lived token for
 * a signed-in member; the status app — which has no session of its own —
 * verifies it with the shared secret and keeps a cookie for the day. No
 * database, no round trip: a signature and a deadline.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  return process.env.STATUS_ACCESS_SECRET ?? process.env.BETTER_AUTH_SECRET ?? "open-incident";
}

export const STATUS_ACCESS_TTL_MS = 12 * 3_600_000;

export function signStatusAccess(
  pageId: string,
  ttlMs = STATUS_ACCESS_TTL_MS,
  now = Date.now(),
): string {
  const exp = Math.floor((now + ttlMs) / 1000);
  const body = `${pageId}.${exp}`;
  const sig = createHmac("sha256", secret()).update(body).digest("hex").slice(0, 40);
  return Buffer.from(`${body}.${sig}`).toString("base64url");
}

export function verifyStatusAccess(
  token: string | null | undefined,
  pageId: string,
  now = Date.now(),
): boolean {
  if (!token) return false;
  let raw: string;
  try {
    raw = Buffer.from(token, "base64url").toString();
  } catch {
    return false;
  }
  const parts = raw.split(".");
  if (parts.length !== 3) return false;
  const [id, exp, sig] = parts as [string, string, string];
  if (id !== pageId) return false;
  if (Number(exp) * 1000 < now) return false;
  const expected = createHmac("sha256", secret()).update(`${id}.${exp}`).digest("hex").slice(0, 40);
  return expected.length === sig.length && timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

export const STATUS_ACCESS_COOKIE = "oi_status_access";
