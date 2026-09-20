import { and, asc, eq } from "drizzle-orm";
import { rotations, schedules, withTenant } from "@openincident/db";
import { apiAuth, apiError, apiJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/v1/schedules/{id} — one rota and its rotations. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const tenantId = auth.ctx.tenant.id;
  const { id } = await params;

  const found = await withTenant(tenantId, async (tx) => {
    const [s] = await tx
      .select()
      .from(schedules)
      .where(and(eq(schedules.tenantId, tenantId), eq(schedules.id, id)))
      .limit(1);
    if (!s) return null;
    const turns = await tx
      .select()
      .from(rotations)
      .where(and(eq(rotations.tenantId, tenantId), eq(rotations.scheduleId, s.id)))
      .orderBy(asc(rotations.position));
    return { s, turns };
  });
  if (!found) return apiError(404, "not_found", `No schedule "${id}" in this workspace.`);

  return apiJson({
    id: found.s.id,
    name: found.s.name,
    timezone: found.s.timezone,
    handover_time: found.s.handoverTime,
    status: found.s.status,
    rotations: found.turns.map((r) => ({
      id: r.id,
      name: r.name,
      interval: r.interval,
      handover_day: r.handoverDay,
      active_start: r.activeStart,
      active_end: r.activeEnd,
      member_ids: r.memberIds,
      effective_from: r.effectiveFrom,
      position: r.position,
    })),
  });
}
