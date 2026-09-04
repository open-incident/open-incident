import { and, asc, eq } from "drizzle-orm";
import { incidentEvents, incidents, withTenant } from "@openincident/db";
import { apiAuth, apiError, apiJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/v1/incidents/{number}/timeline — every event, oldest first, as stored. */
export async function GET(request: Request, { params }: { params: Promise<{ number: string }> }) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const number = Number((await params).number.replace(/^INC-/i, ""));
  if (!Number.isInteger(number) || number <= 0)
    return apiError(404, "not_found", "No such incident.");
  const tenantId = auth.ctx.tenant.id;
  const data = await withTenant(tenantId, async (tx) => {
    const [inc] = await tx
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.number, number)));
    if (!inc) return null;
    const rows = await tx
      .select()
      .from(incidentEvents)
      .where(eq(incidentEvents.incidentId, inc.id))
      .orderBy(asc(incidentEvents.occurredAt), asc(incidentEvents.createdAt));
    return rows.map((e) => ({
      id: e.id,
      kind: e.kind,
      actor: { kind: e.actorKind, member_id: e.actorMemberId, name: e.actorName },
      payload: e.payload,
      pinned: e.pinned,
      occurred_at: e.occurredAt.toISOString(),
    }));
  });
  if (!data) return apiError(404, "not_found", "No such incident.");
  return apiJson({ data });
}
