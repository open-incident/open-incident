/**
 * Encryption of application secrets at rest (AES-256-GCM).
 *
 * Used by the chat installation tokens and the third-party provider credentials
 * (voice/SMS, trackers). The key comes from `ENCRYPTION_KEY` (32 bytes
 * in base64 or hex, or any long string); failing that it is derived from
 * `BETTER_AUTH_SECRET` so that development works without configuration.
 *
 * Stored format: `v1.<iv base64url>.<tag base64url>.<ciphertext base64url>` — the
 * version prefix will allow rotating the key without guessing the format.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function keyMaterial(): string {
  const explicit = process.env.ENCRYPTION_KEY;
  if (explicit && explicit.length >= 16) return explicit;
  const fallback = process.env.BETTER_AUTH_SECRET;
  if (fallback && fallback.length >= 8) return fallback;
  // Development without configuration: stable but public key, never in production.
  return "openincident-dev-encryption-key";
}

/** 32-byte key derived from the available material (SHA-256: guaranteed length). */
function key(): Buffer {
  return createHash("sha256").update(keyMaterial()).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

/** Decrypts, or returns null if the value is unreadable (key changed, corrupted data). */
export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(parts[1]!, "base64url"));
    decipher.setAuthTag(Buffer.from(parts[2]!, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3]!, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** Encrypts an object of secrets (several keys: an API key and its secret). */
export function encryptSecrets(secrets: Record<string, string>): string {
  return encryptSecret(JSON.stringify(secrets));
}

export function decryptSecrets(payload: string | null | undefined): Record<string, string> {
  const raw = decryptSecret(payload);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Displayable suffix of a secret: "••••••••1a2b" (never the whole secret). */
export function secretHint(secret: string): string {
  const tail = secret.slice(-4);
  return `${"•".repeat(Math.min(20, Math.max(4, secret.length - 4)))}${tail}`;
}

/** True if the instance still runs on the development key (warning banner). */
export function usingDevEncryptionKey(): boolean {
  return !process.env.ENCRYPTION_KEY && !process.env.BETTER_AUTH_SECRET;
}

/**
 * Provenance of the key material — an exact mirror of keyMaterial(), so that the
 * diagnostics can qualify the installation without duplicating the
 * thresholds: `explicit` = dedicated ENCRYPTION_KEY · `derived` = derived from
 * BETTER_AUTH_SECRET (acceptable, to be fixed) · `dev` = public development
 * key (never in production).
 */
export function encryptionKeySource(): "explicit" | "derived" | "dev" {
  const explicit = process.env.ENCRYPTION_KEY;
  if (explicit && explicit.length >= 16) return "explicit";
  const fallback = process.env.BETTER_AUTH_SECRET;
  if (fallback && fallback.length >= 8) return "derived";
  return "dev";
}

export { inviteToken, verifyInviteToken } from "./invite-token";
