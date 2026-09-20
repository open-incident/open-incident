import { asc, eq } from "drizzle-orm";
import { rotations, schedules, withTenant } from "@openincident/db";
import { apiAuth, apiJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/v1/schedules — the rotas, with the shape of each rotation. */
export async function GET(request: Request) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const tenantId = auth.ctx.tenant.id;

  const { rows, turns } = await withTenant(tenantId, async (tx) => ({
    rows: await tx
      .select()
      .from(schedules)
      .where(eq(schedules.tenantId, tenantId))
      .orderBy(asc(schedules.name)),
    turns: await tx
      .select()
      .from(rotations)
      .where(eq(rotations.tenantId, tenantId))
      .orderBy(asc(rotations.position)),
  }));

  return apiJson({
    data: rows.map((s) => ({
      id: s.id,
      name: s.name,
      timezone: s.timezone,
      handover_time: s.handoverTime,
      status: s.status,
      rotations: turns
        .filter((r) => r.scheduleId === s.id)
        .map((r) => ({
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
    })),
  });
}
