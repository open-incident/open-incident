/**
 * Member invitation — HMAC-signed token: nothing is stored, the token carries
 * the invited member and its expiry. Clicking the link counts as proof of
 * control over the email address.
 *
 * Lives here — the package of signed things — rather than in the web app or in
 * the auth package: the web app sends the invitation, the database package's
 * workspace command prints the owner's link, and the auth package depends on
 * the database package. Putting it anywhere else closes a cycle.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000; // 7 days

function secret(): string {
  return process.env.BETTER_AUTH_SECRET ?? "dev-secret-change-me";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex").slice(0, 32);
}

function safeEqual(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** `memberId.expiry.sig` token — memberId = app.members row (status invited). */
export function inviteToken(tenantId: string, memberId: string, now = Date.now()): string {
  const expiry = now + INVITE_TTL_MS;
  return `${memberId}.${expiry}.${sign(`invite:${tenantId}:${memberId}:${expiry}`)}`;
}

/** The member id the token names, or null when forged, expired or malformed. */
export function verifyInviteToken(
  tenantId: string,
  token: string,
  now = Date.now(),
): string | null {
  const [memberId, expiryRaw, sig] = token.split(".");
  if (!memberId || !expiryRaw || !sig) return null;
  const expiry = Number(expiryRaw);
  if (!Number.isFinite(expiry) || expiry < now) return null;
  return safeEqual(sig, sign(`invite:${tenantId}:${memberId}:${expiry}`)) ? memberId : null;
}
