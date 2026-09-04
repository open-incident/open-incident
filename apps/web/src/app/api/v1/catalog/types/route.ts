import { asc, eq } from "drizzle-orm";
import { catalogTypes, withTenant } from "@openincident/db";
import { parseTypeSpec, upsertType } from "@openincident/catalog";
import { apiAuth, apiJson, readJson } from "@/lib/api";
import { recordApiAudit } from "@/lib/api-audit";

export const dynamic = "force-dynamic";

/** GET /api/v1/catalog/types */
export async function GET(request: Request) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const rows = await withTenant(auth.ctx.tenant.id, (tx) =>
    tx
      .select()
      .from(catalogTypes)
      .where(eq(catalogTypes.tenantId, auth.ctx.tenant.id))
      .orderBy(asc(catalogTypes.position)),
  );
  return apiJson({
    data: rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      source: r.source,
      locked: r.locked,
      attributes: r.attributes,
    })),
  });
}

/**
 * POST /api/v1/catalog/types — create or update one type by key (scope write).
 * Body: `{ key, name, description?, attributes: [{ key, label, type, refTypeKey?, options? }], lock? }`.
 * Removing an attribute that still holds values answers 409 unless `force: true`.
 */
export async function POST(request: Request) {
  const auth = await apiAuth(request, "write");
  if (!auth.ok) return auth.response;
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const errors: string[] = [];
  const spec = parseTypeSpec(body.body, "type", errors);
  if (!spec || errors.length)
    return Response.json(
      { error: { code: "invalid_body", message: errors.join("; "), details: errors } },
      { status: 422 },
    );
  const raw = body.body as { lock?: unknown; force?: unknown };
  const result = await withTenant(auth.ctx.tenant.id, async (tx) => {
    const r = await upsertType(tx, auth.ctx.tenant.id, spec, {
      locked: raw.lock === true ? true : raw.lock === false ? false : undefined,
      source: "code",
      force: raw.force === true,
    });
    if (r.ok && r.changed)
      await recordApiAudit(
        tx,
        auth.ctx,
        "config",
        r.created ? "catalog.type_created" : "catalog.type_updated",
        {
          key: spec.key,
          attributes: spec.attributes.map((a) => a.key),
        },
      );
    return r;
  });
  if (!result.ok)
    return Response.json(
      {
        error: {
          code: result.errors.some((e) => e.includes("still holds"))
            ? "attribute_in_use"
            : "invalid_body",
          message: result.errors.join("; "),
          details: result.errors,
        },
      },
      { status: result.errors.some((e) => e.includes("still holds")) ? 409 : 422 },
    );
  return apiJson(
    { id: result.id, key: spec.key, created: result.created },
    result.created ? 201 : 200,
  );
}
