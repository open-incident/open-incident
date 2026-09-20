import { and, asc, eq } from "drizzle-orm";
import { alertEvents, alertPriorities, alertSources, alerts, withTenant } from "@openincident/db";
import { apiAuth, apiError, apiJson } from "@/lib/api";
import { serialiseAlert } from "@/lib/api-serialise";

export const dynamic = "force-dynamic";

/** GET /api/v1/alerts/{id} — one alert, its payload and what happened to it. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const tenantId = auth.ctx.tenant.id;
  const { id } = await params;

  const found = await withTenant(tenantId, async (tx) => {
    const [a] = await tx
      .select({
        id: alerts.id,
        title: alerts.title,
        description: alerts.description,
        status: alerts.status,
        urgency: alerts.urgency,
        snoozedUntil: alerts.snoozedUntil,
        dedupKey: alerts.dedupKey,
        groupCount: alerts.groupCount,
        incidentId: alerts.incidentId,
        externalUrl: alerts.externalUrl,
        testMode: alerts.testMode,
        firstAt: alerts.firstAt,
        lastAt: alerts.lastAt,
        ackedAt: alerts.ackedAt,
        resolvedAt: alerts.resolvedAt,
        source: alertSources.name,
        priority: alertPriorities.name,
        payload: alerts.payload,
        attributes: alerts.attributes,
      })
      .from(alerts)
      .leftJoin(alertSources, eq(alertSources.id, alerts.sourceId))
      .leftJoin(alertPriorities, eq(alertPriorities.id, alerts.priorityId))
      .where(and(eq(alerts.tenantId, tenantId), eq(alerts.id, id)))
      .limit(1);
    if (!a) return null;
    const events = await tx
      .select({
        kind: alertEvents.kind,
        at: alertEvents.occurredAt,
        actor: alertEvents.actorName,
        payload: alertEvents.payload,
      })
      .from(alertEvents)
      .where(and(eq(alertEvents.tenantId, tenantId), eq(alertEvents.alertId, a.id)))
      .orderBy(asc(alertEvents.occurredAt))
      .limit(200);
    return { a, events };
  });
  if (!found) return apiError(404, "not_found", `No alert "${id}" in this workspace.`);

  return apiJson({
    ...serialiseAlert(found.a),
    // What the sender actually sent, kept whole. An alert nobody can explain is
    // an alert nobody can silence, and the payload is usually the explanation.
    payload: found.a.payload,
    attributes: found.a.attributes,
    events: found.events.map((e) => ({
      kind: e.kind,
      at: e.at.toISOString(),
      actor: e.actor,
      payload: e.payload,
    })),
  });
}
