import { asc, eq } from "drizzle-orm";
import { heartbeats, services, withTenant } from "@openincident/db";
import { apiAuth, apiJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/heartbeats — the jobs that are supposed to check in.
 *
 * The token is never returned. It is stored encrypted and is the credential
 * that lets anybody holding it say a backup ran; an endpoint that hands it back
 * turns a read key into a write one for the only thing heartbeats can assert.
 */
export async function GET(request: Request) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const rows = await withTenant(auth.ctx.tenant.id, (tx) =>
    tx
      .select({
        id: heartbeats.id,
        name: heartbeats.name,
        description: heartbeats.description,
        intervalSeconds: heartbeats.intervalSeconds,
        graceSeconds: heartbeats.graceSeconds,
        status: heartbeats.status,
        lastPingAt: heartbeats.lastPingAt,
        lastMissedAt: heartbeats.lastMissedAt,
        active: heartbeats.active,
        serviceId: heartbeats.serviceId,
        service: services.key,
      })
      .from(heartbeats)
      .leftJoin(services, eq(services.id, heartbeats.serviceId))
      .where(eq(heartbeats.tenantId, auth.ctx.tenant.id))
      .orderBy(asc(heartbeats.name)),
  );
  return apiJson({
    data: rows.map((h) => ({
      id: h.id,
      name: h.name,
      description: h.description,
      interval_seconds: h.intervalSeconds,
      grace_seconds: h.graceSeconds,
      status: h.status,
      last_ping_at: h.lastPingAt?.toISOString() ?? null,
      last_missed_at: h.lastMissedAt?.toISOString() ?? null,
      active: h.active,
      service_id: h.serviceId,
      service: h.service,
    })),
  });
}
