/**
 * Which services an incident is about.
 *
 * Two sources, and no invention between them: the service the incident carries
 * (`incidents.service_id`), and the services named by the alerts attached to it
 * — `observeService()` has already created a row for each of those, with its
 * owner. Nothing is guessed from the title.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { alerts, incidents, services, teams, type Tx } from "@openincident/db";

export type IncidentService = {
  id: string;
  key: string;
  ownerTeamId: string | null;
  ownerTeamName: string | null;
};

export async function servicesOfIncidents(
  tx: Tx,
  tenantId: string,
  incidentIds: string[],
): Promise<Map<string, IncidentService[]>> {
  const out = new Map<string, IncidentService[]>();
  if (incidentIds.length === 0) return out;

  const push = (incidentId: string, svc: IncidentService) => {
    const list = out.get(incidentId) ?? [];
    if (!list.some((s) => s.id === svc.id)) list.push(svc);
    out.set(incidentId, list);
  };

  const direct = await tx
    .select({
      incidentId: incidents.id,
      id: services.id,
      key: services.key,
      ownerTeamId: services.ownerTeamId,
      ownerTeamName: teams.name,
    })
    .from(incidents)
    .innerJoin(services, eq(services.id, incidents.serviceId))
    .leftJoin(teams, eq(teams.id, services.ownerTeamId))
    .where(and(eq(incidents.tenantId, tenantId), inArray(incidents.id, incidentIds)));
  for (const r of direct) push(r.incidentId, r);

  const fromAlerts = await tx
    .selectDistinct({
      incidentId: alerts.incidentId,
      id: services.id,
      key: services.key,
      ownerTeamId: services.ownerTeamId,
      ownerTeamName: teams.name,
    })
    .from(alerts)
    .innerJoin(
      services,
      and(
        eq(services.tenantId, tenantId),
        sql`${services.key} = lower(${alerts.attributes} ->> 'service')`,
      ),
    )
    .leftJoin(teams, eq(teams.id, services.ownerTeamId))
    .where(and(eq(alerts.tenantId, tenantId), inArray(alerts.incidentId, incidentIds)));
  for (const r of fromAlerts) if (r.incidentId) push(r.incidentId, r);

  return out;
}
