/**
 * GET /app/status-pages/{id}/open — a signed-in member is sent to the page
 * with a short-lived access token; the status app turns it into a cookie.
 * Public pages simply redirect. Nothing here leaks to the outside: the
 * requirement is the member session the whole /app tree already has.
 */
import { and, eq } from "drizzle-orm";
import { statusPages, withTenant } from "@openincident/db";
import { signStatusAccess, statusPageUrl } from "@openincident/statuspages";
import { requireMember } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { tenant } = await requireMember();
  const { id } = await ctx.params;
  const [page] = await withTenant(tenant.id, (tx) =>
    tx
      .select()
      .from(statusPages)
      .where(and(eq(statusPages.tenantId, tenant.id), eq(statusPages.id, id))),
  );
  if (!page) return new Response("Not found", { status: 404 });
  const base = statusPageUrl(page);
  const location =
    page.visibility === "internal"
      ? `${base}/access?t=${encodeURIComponent(signStatusAccess(page.id))}`
      : base;
  return new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });
}
