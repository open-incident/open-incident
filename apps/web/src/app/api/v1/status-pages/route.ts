import { asc, eq } from "drizzle-orm";
import { statusPages, withTenant } from "@openincident/db";
import { buildSnapshot, statusPageUrl } from "@openincident/statuspages";
import { apiAuth, apiJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/v1/status-pages — the workspace's pages with their current overall state. */
export async function GET(request: Request) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const tenantId = auth.ctx.tenant.id;
  const data = await withTenant(tenantId, async (tx) => {
    const pages = await tx
      .select()
      .from(statusPages)
      .where(eq(statusPages.tenantId, tenantId))
      .orderBy(asc(statusPages.createdAt));
    const out = [];
    for (const p of pages) {
      const snap = await buildSnapshot(tx, tenantId, p.id);
      out.push({
        id: p.id,
        name: p.name,
        slug: p.slug,
        url: statusPageUrl(p),
        locale: p.locale,
        custom_domain: p.customDomain,
        custom_domain_verified: Boolean(p.customDomainVerifiedAt),
        overall: snap?.overall ?? "operational",
        components:
          snap?.components.map((c) => ({
            id: c.id,
            name: c.name,
            state: c.state,
            uptime_90d: c.uptime90,
          })) ?? [],
        subscribers: snap?.subscribers ?? 0,
      });
    }
    return out;
  });
  return apiJson({ data });
}
