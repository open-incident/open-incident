import { and, asc, eq } from "drizzle-orm";
import { catalogEntries, catalogTypes, withTenant } from "@openincident/db";
import { parseEntrySpec, upsertEntries } from "@openincident/catalog";
import { apiAuth, apiError, apiJson, readJson } from "@/lib/api";
import { recordApiAudit } from "@/lib/api-audit";

export const dynamic = "force-dynamic";

/** GET /api/v1/catalog/entries?type=service */
export async function GET(request: Request) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const typeKey = new URL(request.url).searchParams.get("type");
  const rows = await withTenant(auth.ctx.tenant.id, (tx) =>
    tx
      .select({ e: catalogEntries, typeKey: catalogTypes.key })
      .from(catalogEntries)
      .innerJoin(catalogTypes, eq(catalogTypes.id, catalogEntries.typeId))
      .where(
        and(
          eq(catalogEntries.tenantId, auth.ctx.tenant.id),
          typeKey ? eq(catalogTypes.key, typeKey) : undefined,
        ),
      )
      .orderBy(asc(catalogTypes.position), asc(catalogEntries.name)),
  );
  return apiJson({
    data: rows.map(({ e, typeKey }) => ({
      id: e.id,
      type: typeKey,
      name: e.name,
      description: e.description,
      external_id: e.externalId,
      attributes: e.attributes,
      updated_at: e.updatedAt.toISOString(),
    })),
  });
}

/**
 * POST /api/v1/catalog/entries — upsert one entry or a list (scope write).
 * Body: `{ type, name, description?, external_id?, attributes? }` or
 * `{ type, entries: [ … ] }`. Matched by external_id, then by name; `entry`
 * attributes accept an id, an external_id or a name of the referenced type.
 * One invalid row and nothing is written.
 */
export async function POST(request: Request) {
  const auth = await apiAuth(request, "write");
  if (!auth.ok) return auth.response;
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const raw = body.body as { type?: unknown; entries?: unknown };
  const typeKey = typeof raw.type === "string" ? raw.type : "";
  const items = Array.isArray(raw.entries) ? raw.entries : [raw];
  const errors: string[] = [];
  const specs = items
    .map((item, i) => parseEntrySpec(item, `entries[${i}]`, errors, typeKey))
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (errors.length)
    return Response.json(
      { error: { code: "invalid_body", message: errors.join("; "), details: errors } },
      { status: 422 },
    );
  if (specs.length === 0 || specs.length > 5000)
    return apiError(422, "invalid_body", "Send between 1 and 5000 entries.");
  const byType = new Map<string, typeof specs>();
  for (const s of specs) byType.set(s.type, [...(byType.get(s.type) ?? []), s]);
  const report = await withTenant(auth.ctx.tenant.id, async (tx) => {
    const total = {
      created: 0,
      updated: 0,
      unchanged: 0,
      ids: [] as string[],
      errors: [] as string[],
    };
    for (const [key, rows] of byType) {
      const r = await upsertEntries(tx, auth.ctx.tenant.id, key, rows);
      total.errors.push(...r.errors);
      total.created += r.created;
      total.updated += r.updated;
      total.unchanged += r.unchanged;
      total.ids.push(...r.ids);
    }
    if (total.errors.length) throw new EntriesError(total.errors);
    if (total.created + total.updated > 0)
      await recordApiAudit(tx, auth.ctx, "config", "catalog.entries_upserted", {
        types: [...byType.keys()],
        created: total.created,
        updated: total.updated,
      });
    return total;
  }).catch((e: unknown) => {
    if (e instanceof EntriesError) return e;
    throw e;
  });
  if (report instanceof EntriesError)
    return Response.json(
      {
        error: { code: "invalid_body", message: report.errors.join("; "), details: report.errors },
      },
      { status: 422 },
    );
  return apiJson(
    {
      created: report.created,
      updated: report.updated,
      unchanged: report.unchanged,
      ids: report.ids,
    },
    report.created > 0 ? 201 : 200,
  );
}

class EntriesError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join("; "));
  }
}
