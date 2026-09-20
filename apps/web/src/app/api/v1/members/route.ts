import { asc, eq } from "drizzle-orm";
import { members, withTenant } from "@openincident/db";
import { apiAuth, apiJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/members — who is in the workspace.
 *
 * Read-only, and it stays that way: accounts arrive by invitation, in the
 * product, because an account created over an API is an account nobody agreed
 * to have. What this is for is resolving the ids that come back from every
 * other endpoint into names somebody recognises.
 */
export async function GET(request: Request) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const rows = await withTenant(auth.ctx.tenant.id, (tx) =>
    tx
      .select({
        id: members.id,
        name: members.name,
        email: members.email,
        role: members.role,
        status: members.status,
        timezone: members.timezone,
        lastSeenAt: members.lastSeenAt,
      })
      .from(members)
      .where(eq(members.tenantId, auth.ctx.tenant.id))
      .orderBy(asc(members.name)),
  );
  return apiJson({
    data: rows.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      role: m.role,
      status: m.status,
      timezone: m.timezone,
      last_seen_at: m.lastSeenAt?.toISOString() ?? null,
    })),
  });
}
