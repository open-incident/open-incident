import { and, eq } from "drizzle-orm";
import { catalogEntries, catalogTypes, withTenant } from "@openincident/db";
import { entryUsages } from "@openincident/catalog";
import { apiAuth, apiError, apiJson } from "@/lib/api";
import { recordApiAudit } from "@/lib/api-audit";

export const dynamic = "force-dynamic";

/** GET /api/v1/catalog/entries/{id} — one entry with what references it. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const found = await withTenant(auth.ctx.tenant.id, async (tx) => {
    const [row] = await tx
      .select({ e: catalogEntries, typeKey: catalogTypes.key })
      .from(catalogEntries)
      .innerJoin(catalogTypes, eq(catalogTypes.id, catalogEntries.typeId))
      .where(and(eq(catalogEntries.tenantId, auth.ctx.tenant.id), eq(catalogEntries.id, id)));
    if (!row) return null;
    return { row, usages: await entryUsages(tx, auth.ctx.tenant.id, id) };
  });
  if (!found) return apiError(404, "not_found", "No such entry.");
  const { e, typeKey } = found.row;
  return apiJson({
    id: e.id,
    type: typeKey,
    name: e.name,
    description: e.description,
    external_id: e.externalId,
    attributes: e.attributes,
    updated_at: e.updatedAt.toISOString(),
    referenced_by: found.usages,
  });
}

/** DELETE /api/v1/catalog/entries/{id} — refused (409) while anything references the entry. */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await apiAuth(request, "write");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const outcome = await withTenant(auth.ctx.tenant.id, async (tx) => {
    const [row] = await tx
      .select({ name: catalogEntries.name, typeKey: catalogTypes.key })
      .from(catalogEntries)
      .innerJoin(catalogTypes, eq(catalogTypes.id, catalogEntries.typeId))
      .where(and(eq(catalogEntries.tenantId, auth.ctx.tenant.id), eq(catalogEntries.id, id)));
    if (!row) return { status: 404 as const };
    const usages = await entryUsages(tx, auth.ctx.tenant.id, id);
    if (usages.length) return { status: 409 as const, usages };
    await tx.delete(catalogEntries).where(eq(catalogEntries.id, id));
    await recordApiAudit(tx, auth.ctx, "config", "catalog.entry_deleted", {
      type: row.typeKey,
      name: row.name,
      id,
    });
    return { status: 204 as const };
  });
  if (outcome.status === 404) return apiError(404, "not_found", "No such entry.");
  if (outcome.status === 409)
    return Response.json(
      {
        error: {
          code: "entry_in_use",
          message: "The entry is still referenced; remove the references first.",
          referenced_by: outcome.usages,
        },
      },
      { status: 409 },
    );
  return new Response(null, { status: 204 });
}
