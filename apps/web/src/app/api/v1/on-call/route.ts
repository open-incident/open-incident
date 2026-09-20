import { and, asc, eq, gte, lte } from "drizzle-orm";
import { members, rotations, scheduleOverrides, schedules, withTenant } from "@openincident/db";
import { onCallAt } from "@openincident/oncall";
import { apiAuth, apiError, apiJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/on-call?at=ISO&schedule=<id|name> — who to wake, right now.
 *
 * The single most-asked question of any on-call product, and the reason this
 * endpoint exists before most of the others: every chatbot, every runbook and
 * every "who do I call" script wants exactly this, and without it people paste
 * a rota into a wiki and let it rot.
 *
 * It is computed, never stored. A shift is the product of a rotation's
 * interval, its handover, its active window and any override laid over the
 * top — so there is no table to read, and a cached answer is a wrong answer
 * the moment somebody takes a cover.
 */
export async function GET(request: Request) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const tenantId = auth.ctx.tenant.id;
  const url = new URL(request.url);

  const atParam = url.searchParams.get("at");
  const at = atParam ? new Date(atParam) : new Date();
  if (Number.isNaN(at.getTime()))
    return apiError(422, "invalid_body", "`at` must be an ISO 8601 timestamp.");
  const wanted = url.searchParams.get("schedule");

  const data = await withTenant(tenantId, async (tx) => {
    const scheduleRows = await tx
      .select({
        id: schedules.id,
        name: schedules.name,
        timezone: schedules.timezone,
        handoverTime: schedules.handoverTime,
        status: schedules.status,
      })
      .from(schedules)
      .where(eq(schedules.tenantId, tenantId))
      .orderBy(asc(schedules.name));

    const chosen = wanted
      ? scheduleRows.filter((s) => s.id === wanted || s.name === wanted)
      : scheduleRows;
    if (chosen.length === 0) return null;

    const [allRotations, allOverrides, people] = await Promise.all([
      tx.select().from(rotations).where(eq(rotations.tenantId, tenantId)),
      tx
        .select()
        .from(scheduleOverrides)
        .where(
          and(
            eq(scheduleOverrides.tenantId, tenantId),
            lte(scheduleOverrides.startAt, at),
            gte(scheduleOverrides.endAt, at),
          ),
        ),
      tx
        .select({ id: members.id, name: members.name, email: members.email })
        .from(members)
        .where(eq(members.tenantId, tenantId)),
    ]);
    const byId = new Map(people.map((p) => [p.id, p]));

    return chosen.map((s) => {
      const shifts = onCallAt(
        s,
        allRotations.filter((r) => r.scheduleId === s.id),
        allOverrides.filter((o) => o.scheduleId === s.id),
        at,
      );
      return {
        schedule_id: s.id,
        schedule: s.name,
        timezone: s.timezone,
        status: s.status,
        // An empty array is the answer that matters most: it means nobody is
        // on call on this schedule at this moment, which is a gap somebody
        // should see rather than a 404 they can dismiss.
        on_call: shifts.map((shift) => {
          const person = shift.memberId ? byId.get(shift.memberId) : undefined;
          return {
            rotation_id: shift.rotationId,
            rotation: shift.rotationName,
            member_id: shift.memberId,
            name: person?.name ?? null,
            email: person?.email ?? null,
            override: shift.override,
            until: shift.until.toISOString(),
          };
        }),
      };
    });
  });

  if (data === null)
    return apiError(404, "not_found", `No schedule "${wanted}" in this workspace.`);
  return apiJson({ at: at.toISOString(), data });
}
