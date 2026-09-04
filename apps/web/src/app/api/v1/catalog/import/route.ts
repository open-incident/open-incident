import { withTenant } from "@openincident/db";
import { applyBundle, BundleError, parseBundle } from "@openincident/catalog";
import { apiAuth, apiError, apiJson, readJson } from "@/lib/api";
import { recordApiAudit } from "@/lib/api-audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/catalog/import — a whole bundle `{ types, entries, lock?, source? }`
 * in one transaction. What the catalog-importer sends; usable by anything else
 * that owns the truth about services and teams.
 */
export async function POST(request: Request) {
  const auth = await apiAuth(request, "write");
  if (!auth.ok) return auth.response;
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const { bundle, errors } = parseBundle(body.body);
  if (errors.length)
    return Response.json(
      {
        error: { code: "invalid_bundle", message: errors.slice(0, 5).join("; "), details: errors },
      },
      { status: 422 },
    );
  if (bundle.types.length + bundle.entries.length > 5000)
    return apiError(413, "too_large", "Send at most 5000 types and entries per call.");
  const raw = body.body as { lock?: unknown; source?: unknown; force?: unknown };
  const lock = raw.lock === true ? true : raw.lock === false ? false : undefined;
  const source = raw.source === "sync" ? "sync" : "code";
  try {
    const report = await withTenant(auth.ctx.tenant.id, async (tx) => {
      const r = await applyBundle(tx, auth.ctx.tenant.id, bundle, {
        locked: lock,
        source,
        force: raw.force === true,
      });
      await recordApiAudit(tx, auth.ctx, "config", "catalog.imported", {
        source,
        lock: lock ?? null,
        typeKeys: bundle.types.map((t) => t.key),
        entryCount: bundle.entries.length,
        ...r,
      });
      return r;
    });
    return apiJson(report);
  } catch (e) {
    if (e instanceof BundleError)
      return Response.json(
        { error: { code: "invalid_bundle", message: e.message, details: e.errors } },
        { status: 422 },
      );
    throw e;
  }
}
