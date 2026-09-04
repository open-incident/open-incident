import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Slack signs every request: v0=HMAC-SHA256(signing secret, "v0:" + timestamp + ":" + raw body).
 * Requests older than five minutes are refused (replay).
 */
export function verifySlackRequest(
  signingSecret: string,
  headers: { get(name: string): string | null },
  rawBody: string,
  now = Date.now(),
): boolean {
  const ts = headers.get("x-slack-request-timestamp");
  const sig = headers.get("x-slack-signature");
  if (!ts || !sig || !/^\d+$/.test(ts)) return false;
  if (Math.abs(now / 1000 - Number(ts)) > 300) return false;
  const expected = `v0=${createHmac("sha256", signingSecret).update(`v0:${ts}:${rawBody}`).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Signs a body the way Slack does — the smoke test and the unit tests use it. */
export function signSlackRequest(
  signingSecret: string,
  rawBody: string,
  timestamp = Math.floor(Date.now() / 1000),
): { "x-slack-request-timestamp": string; "x-slack-signature": string } {
  return {
    "x-slack-request-timestamp": String(timestamp),
    "x-slack-signature": `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`,
  };
}
