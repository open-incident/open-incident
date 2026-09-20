import { asc, eq } from "drizzle-orm";
import { services, slos, withTenant } from "@openincident/db";
import { apiAuth, apiJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/slos — objectives, and how much budget is left.
 *
 * `budget_left` is a share of the error budget, and it goes negative: past zero
 * the objective is not "0 % left", it is overspent, and clamping it at zero
 * would hide the difference between just missing and missing by a factor of
 * fifteen.
 */
export async function GET(request: Request) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const rows = await withTenant(auth.ctx.tenant.id, (tx) =>
    tx
      .select({
        id: slos.id,
        name: slos.name,
        description: slos.description,
        objective: slos.objective,
        windowKind: slos.windowKind,
        windowDays: slos.windowDays,
        lastSli: slos.lastSli,
        lastBudgetLeft: slos.lastBudgetLeft,
        lastFastBurn: slos.lastFastBurn,
        lastSlowBurn: slos.lastSlowBurn,
        burnState: slos.burnState,
        burnSince: slos.burnSince,
        lastEvaluatedAt: slos.lastEvaluatedAt,
        paused: slos.paused,
        serviceId: slos.serviceId,
        service: services.key,
      })
      .from(slos)
      .leftJoin(services, eq(services.id, slos.serviceId))
      .where(eq(slos.tenantId, auth.ctx.tenant.id))
      .orderBy(asc(slos.name)),
  );
  return apiJson({
    data: rows.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      objective: s.objective,
      window: { kind: s.windowKind, days: s.windowDays },
      sli: s.lastSli,
      budget_left: s.lastBudgetLeft,
      burn: { fast: s.lastFastBurn, slow: s.lastSlowBurn, state: s.burnState },
      burn_since: s.burnSince?.toISOString() ?? null,
      last_evaluated_at: s.lastEvaluatedAt?.toISOString() ?? null,
      paused: s.paused,
      service_id: s.serviceId,
      service: s.service,
    })),
  });
}
