/**
 * The public API's door: Bearer key → workspace, scopes, rate limit, envelope.
 *
 * A key is `oi_live_[a-f0-9]{32}`, stored as its SHA-256; it resolves its own
 * workspace through directory.api_key_lookup, whatever host the request came
 * in on. Errors share one shape — `{ error: { code, message } }` — and one
 * vocabulary: 401 `unknown_key`, 403 `missing_scope` / `workspace_suspended`,
 * 429 `rate_limited`.
 */
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  apiKeys,
  getTenantById,
  getTenantIdForApiKeyHash,
  withTenant,
  type ApiScope,
  type Tenant,
} from "@openincident/db";
import { rateLimit } from "@/lib/rate-limit";

export type ApiContext = {
  tenant: Tenant;
  key: { id: string; name: string; scopes: ApiScope[] };
};

export const KEY_PATTERN = /^oi_live_[a-f0-9]{32}$/;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function apiError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export function apiJson(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return Response.json(data, { status, headers });
}

/** `write` implies `read`; `incident:create` is the narrow scope of an ingestion key. */
export function hasScope(scopes: ApiScope[], needed: ApiScope): boolean {
  if (scopes.includes(needed)) return true;
  if (scopes.includes("write") && (needed === "read" || needed === "incident:create")) return true;
  return false;
}

export async function apiAuth(
  request: Request,
  needed: ApiScope,
): Promise<{ ok: true; ctx: ApiContext } | { ok: false; response: Response }> {
  const header = request.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!KEY_PATTERN.test(key))
    return {
      ok: false,
      response: apiError(
        401,
        "unknown_key",
        "Provide a valid API key as `Authorization: Bearer oi_live_…`.",
      ),
    };

  const keyHash = hashApiKey(key);
  const tenantId = await getTenantIdForApiKeyHash(keyHash);
  if (!tenantId)
    return {
      ok: false,
      response: apiError(401, "unknown_key", "This API key is unknown or has been revoked."),
    };

  const tenant = await getTenantById(tenantId);
  if (!tenant)
    return {
      ok: false,
      response: apiError(401, "unknown_key", "This API key is unknown or has been revoked."),
    };
  if (tenant.status !== "active" && tenant.status !== "trial") {
    return {
      ok: false,
      response: apiError(403, "workspace_suspended", "This workspace is suspended."),
    };
  }

  const row = await withTenant(tenantId, async (tx) => {
    const [k] = await tx
      .select()
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.tenantId, tenantId),
          eq(apiKeys.keyHash, keyHash),
          isNull(apiKeys.revokedAt),
        ),
      );
    return k ?? null;
  });
  if (!row)
    return {
      ok: false,
      response: apiError(401, "unknown_key", "This API key is unknown or has been revoked."),
    };
  if (!hasScope(row.scopes, needed)) {
    return {
      ok: false,
      response: apiError(403, "missing_scope", `This key lacks the \`${needed}\` scope.`),
    };
  }

  const limit = await rateLimit(`api-key:${row.id}`, 600, 60);
  if (!limit.allowed) {
    return {
      ok: false,
      response: apiError(429, "rate_limited", "Too many requests for this key — 600 per minute."),
    };
  }

  // Fire-and-forget: the request must not wait for a bookkeeping write.
  void withTenant(tenantId, (tx) =>
    tx.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id)),
  ).catch(() => {});

  return { ok: true, ctx: { tenant, key: { id: row.id, name: row.name, scopes: row.scopes } } };
}

/** Opaque cursor over (last_activity_at desc, id desc). */
export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
}

export function decodeCursor(raw: string | null): { at: Date; id: string } | null {
  if (!raw) return null;
  try {
    const [iso, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    const at = new Date(iso ?? "");
    if (!id || Number.isNaN(at.getTime())) return null;
    return { at, id };
  } catch {
    return null;
  }
}

/** `limit` query parameter, capped at 100. */
export function pageLimit(url: URL): number {
  const raw = Number(url.searchParams.get("limit") ?? "50");
  if (!Number.isFinite(raw) || raw <= 0) return 50;
  return Math.min(100, Math.floor(raw));
}

/** Reads a JSON body, or answers 400. */
export async function readJson(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false, response: apiError(400, "invalid_json", "The request body must be JSON.") };
  }
}
