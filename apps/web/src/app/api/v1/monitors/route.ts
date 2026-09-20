import { asc, eq } from "drizzle-orm";
import { monitors, services, withTenant } from "@openincident/db";
import { apiAuth, apiJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/monitors — the checks, and what each one last saw.
 *
 * `state` is the current verdict and `last_check_at` is when it was reached;
 * both are needed, because a monitor that says "up" and was last checked two
 * hours ago is not saying anything about now. A paused monitor keeps its last
 * state rather than reporting healthy — the commonest way a dashboard lies.
 */
export async function GET(request: Request) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const rows = await withTenant(auth.ctx.tenant.id, (tx) =>
    tx
      .select({
        id: monitors.id,
        name: monitors.name,
        type: monitors.type,
        target: monitors.target,
        intervalSeconds: monitors.intervalSeconds,
        state: monitors.state,
        stateSince: monitors.stateSince,
        lastCheckAt: monitors.lastCheckAt,
        lastLatencyMs: monitors.lastLatencyMs,
        lastDetail: monitors.lastDetail,
        paused: monitors.paused,
        openAlertId: monitors.openAlertId,
        serviceId: monitors.serviceId,
        service: services.key,
      })
      .from(monitors)
      .leftJoin(services, eq(services.id, monitors.serviceId))
      .where(eq(monitors.tenantId, auth.ctx.tenant.id))
      .orderBy(asc(monitors.name)),
  );
  return apiJson({
    data: rows.map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      target: m.target,
      interval_seconds: m.intervalSeconds,
      state: m.state,
      state_since: m.stateSince?.toISOString() ?? null,
      last_check_at: m.lastCheckAt?.toISOString() ?? null,
      last_latency_ms: m.lastLatencyMs,
      last_detail: m.lastDetail,
      paused: m.paused,
      open_alert_id: m.openAlertId,
      service_id: m.serviceId,
      service: m.service,
    })),
  });
}
