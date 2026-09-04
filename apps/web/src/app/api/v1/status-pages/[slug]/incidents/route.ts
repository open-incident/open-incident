import { and, eq } from "drizzle-orm";
import { statusPages, withTenant } from "@openincident/db";
import { buildSnapshot } from "@openincident/statuspages";
import { apiAuth, apiError, apiJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/v1/status-pages/{slug}/incidents — public incidents and maintenances of the last 90 days. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const { slug } = await params;
  const tenantId = auth.ctx.tenant.id;
  const snap = await withTenant(tenantId, async (tx) => {
    const [p] = await tx
      .select({ id: statusPages.id })
      .from(statusPages)
      .where(and(eq(statusPages.tenantId, tenantId), eq(statusPages.slug, slug)));
    return p ? buildSnapshot(tx, tenantId, p.id) : null;
  });
  if (!snap) return apiError(404, "not_found", "No such status page.");
  return apiJson({ data: { incidents: snap.incidents, maintenances: snap.maintenances } });
}
