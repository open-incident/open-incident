/**
 * The public shape of an incident, shared by the REST API and the webhook
 * payloads. One definition on purpose: an integrator who reads
 * `GET /api/v1/incidents/{n}` and then receives an `incident.updated` webhook
 * must see the same fields with the same names.
 */
import { and, eq } from "drizzle-orm";
import {
  catalogEntries,
  incidentRoles,
  incidentStatuses,
  incidentTypes,
  incidents,
  members,
  roleAssignments,
  severities,
  type Tx,
} from "@openincident/db";

export type IncidentPayload = {
  id: string;
  number: number;
  reference: string;
  name: string;
  summary: string | null;
  phase: "triage" | "active" | "post_incident" | "closed";
  status: string | null;
  severity: string | null;
  type: string;
  mode: "live" | "retrospective" | "test";
  visibility: "public" | "private";
  source: string;
  service: { id: string; name: string } | null;
  lead: { id: string; name: string; email: string } | null;
  custom_fields: Record<string, unknown>;
  declared_at: string;
  accepted_at: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  next_update_due_at: string | null;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Loads an incident with everything the public shape names, already serialized. */
export async function incidentPayload(
  tx: Tx,
  tenantId: string,
  incidentId: string,
): Promise<IncidentPayload | null> {
  const [row] = await tx
    .select({
      inc: incidents,
      statusName: incidentStatuses.name,
      severityName: severities.name,
      typeName: incidentTypes.name,
      serviceId: catalogEntries.id,
      serviceName: catalogEntries.name,
    })
    .from(incidents)
    .innerJoin(incidentTypes, eq(incidentTypes.id, incidents.typeId))
    .leftJoin(incidentStatuses, eq(incidentStatuses.id, incidents.statusId))
    .leftJoin(severities, eq(severities.id, incidents.severityId))
    .leftJoin(catalogEntries, eq(catalogEntries.id, incidents.serviceEntryId))
    .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, incidentId)));
  if (!row) return null;
  const [lead] = await tx
    .select({ id: members.id, name: members.name, email: members.email })
    .from(roleAssignments)
    .innerJoin(
      incidentRoles,
      and(eq(incidentRoles.id, roleAssignments.roleId), eq(incidentRoles.isLead, true)),
    )
    .innerJoin(members, eq(members.id, roleAssignments.memberId))
    .where(eq(roleAssignments.incidentId, incidentId));
  const i = row.inc;
  return {
    id: i.id,
    number: i.number,
    reference: `INC-${i.number}`,
    name: i.name,
    summary: i.summary,
    phase: i.phase,
    status: i.phase === "active" ? row.statusName : null,
    severity: row.severityName,
    type: row.typeName,
    mode: i.mode,
    visibility: i.visibility,
    source: i.source,
    service: row.serviceId && row.serviceName ? { id: row.serviceId, name: row.serviceName } : null,
    lead: lead ?? null,
    custom_fields: i.customFields,
    declared_at: i.declaredAt.toISOString(),
    accepted_at: iso(i.acceptedAt),
    acknowledged_at: iso(i.acknowledgedAt),
    resolved_at: iso(i.resolvedAt),
    closed_at: iso(i.closedAt),
    next_update_due_at: iso(i.nextUpdateDueAt),
    last_activity_at: i.lastActivityAt.toISOString(),
    created_at: i.createdAt.toISOString(),
    updated_at: i.updatedAt.toISOString(),
  };
}
