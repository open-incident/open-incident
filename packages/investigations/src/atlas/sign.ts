/**
 * Signatures for everything Atlas sends or receives without a session:
 *  - the one-tap links of the phone and the chat (Undo, Approve, Review, Stop),
 *  - the internal calls between the worker and the web app,
 *  - the requests to the customer's own automation (do / undo / verify).
 *
 * One instance key — the same material as @openincident/crypto
 * (ENCRYPTION_KEY, else BETTER_AUTH_SECRET) — and one derived key per purpose,
 * so a link token can never be replayed as an internal call or the reverse.
 * The automation secret of a workspace is derived from that key and a salt
 * stored on the workspace: never stored itself, rotated by changing the salt.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function material(): string {
  const explicit = process.env.ENCRYPTION_KEY;
  if (explicit && explicit.length >= 16) return explicit;
  const fallback = process.env.BETTER_AUTH_SECRET;
  if (fallback && fallback.length >= 8) return fallback;
  return "openincident-dev-encryption-key";
}

function derived(purpose: string): Buffer {
  const root = createHash("sha256").update(material()).digest();
  return createHmac("sha256", root).update(`atlas:${purpose}`).digest();
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/* ---------- One-tap links ---------- */

export type LinkOp = "undo" | "approve" | "reject" | "review" | "stop";

export type LinkClaims = {
  /** Workspace. */
  t: string;
  op: LinkOp;
  /** The journal row (undo, approve, reject), the investigation (review) or the incident (stop). */
  id: string;
  /** The member the link was sent to; null for a link posted in a channel. */
  m: string | null;
  /** Expiry, epoch seconds. */
  exp: number;
};

/** A compact signed token: claims in base64url, then 26 bytes of HMAC. */
export function signLink(claims: Omit<LinkClaims, "exp">, ttlMs: number): string {
  const body = b64(JSON.stringify({ ...claims, exp: Math.floor((Date.now() + ttlMs) / 1000) }));
  const mac = createHmac("sha256", derived("link")).update(body).digest().subarray(0, 26);
  return `${body}.${b64(mac)}`;
}

/** The claims of a valid, unexpired token for this workspace — otherwise null. */
export function verifyLink(token: string, tenantId: string): LinkClaims | null {
  const [body, mac] = token.split(".");
  if (!body || !mac || token.length > 600) return null;
  const expected = b64(createHmac("sha256", derived("link")).update(body).digest().subarray(0, 26));
  if (!equal(mac, expected)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LinkClaims;
    if (c.t !== tenantId) return null;
    if (!c.exp || c.exp * 1000 < Date.now()) return null;
    if (!["undo", "approve", "reject", "review", "stop"].includes(c.op)) return null;
    return c;
  } catch {
    return null;
  }
}

/* ---------- Internal calls (worker → web) ---------- */

export const INTERNAL_HEADER = "x-oi-atlas-signature";

export function signInternal(body: string, now = Date.now()): string {
  const t = Math.floor(now / 1000);
  const mac = createHmac("sha256", derived("internal")).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${mac}`;
}

/** Valid within five minutes either way. */
export function verifyInternal(header: string | null, body: string, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=", 2) as [string, string]),
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > 300 || !parts.v1) return false;
  const mac = createHmac("sha256", derived("internal")).update(`${t}.${body}`).digest("hex");
  return equal(parts.v1, mac);
}

/* ---------- The customer's automation ---------- */

/** A fresh salt for a workspace's automation secret. */
export function newExecutorNonce(): string {
  return randomBytes(12).toString("base64url");
}

/** The workspace's automation secret, from the instance key and its salt. */
export function executorSecret(tenantId: string, nonce: string): string {
  const mac = createHmac("sha256", derived("executor")).update(`${tenantId}:${nonce}`).digest();
  return `oia_${b64(mac).slice(0, 40)}`;
}

export const EXECUTOR_HEADER = "x-openincident-signature";

/** `t=<epoch>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>` — the scheme the guide documents. */
export function signExecutorBody(secret: string, body: string, now = Date.now()): string {
  const t = Math.floor(now / 1000);
  const mac = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${mac}`;
}

/** The receiving side's check — exported for the guide's example and the tests. */
export function verifyExecutorBody(
  secret: string,
  header: string | null,
  body: string,
  now = Date.now(),
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=", 2) as [string, string]),
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > 300 || !parts.v1) return false;
  return equal(parts.v1, createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"));
}
