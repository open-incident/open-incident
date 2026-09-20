/**
 * Who is sending, decided before anything is read.
 *
 * §15.4 is explicit and the order matters: the key resolves its workspace
 * *before* any decoding. A payload is never parsed on behalf of a tenant we
 * have not identified — otherwise a 16 MB body from an unknown sender costs a
 * full parse, and a malformed one costs a stack trace with somebody's data in
 * it.
 *
 * The resolution goes through `directory.telemetry_key_lookup` rather than the
 * key's own row, and that is not a shortcut: `app.telemetry_ingestion_keys`
 * lives under row-level security, so reading it without a tenant context — the
 * very thing we are trying to establish — returns nothing. The product already
 * solved this for API keys; telemetry follows the same path.
 */
import { createHash } from "node:crypto";
import { resolveTelemetryKey, type TelemetryCaller } from "@openincident/db";

export type Caller = TelemetryCaller;

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** `x-oi-key`, or `Authorization: Bearer` — both documented, both accepted. */
export function keyFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const direct = headers["x-oi-key"];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const auth = headers["authorization"];
  if (typeof auth === "string" && /^bearer\s+/i.test(auth))
    return auth.replace(/^bearer\s+/i, "").trim();
  return null;
}

export async function callerFor(key: string): Promise<Caller | null> {
  return resolveTelemetryKey(hashKey(key));
}
