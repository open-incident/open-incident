/**
 * Queries of the incident screens — every one inside the caller's tenant
 * context. The screens read shapes, not tables: a row here is what a card or a
 * panel needs, already joined.
 */
import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  catalogEntries,
  debriefs,
  followUpPriorities,
  followUps,
  incidentEvents,
  incidentFields,
  incidentParticipants,
  incidentRoles,
  incidentStatuses,
  incidentTypes,
  incidents,
  members,
  postIncidentTasks,
  postMortems,
  roleAssignments,
  severities,
  type Tx,
} from "@openincident/db";

export type IncidentView = "open" | "triage" | "mine" | "resolved" | "follow-ups";
export const INCIDENT_VIEWS: IncidentView[] = ["open", "triage", "mine", "resolved", "follow-ups"];

export type IncidentRow = {
  id: string;
  number: number;
  name: string;
  phase: "triage" | "active" | "post_incident" | "closed";
  statusName: string | null;
  severityName: string | null;
  severityRank: number | null;
  serviceName: string | null;
  leadName: string | null;
  visibility: "public" | "private";
  mode: "live" | "retrospective" | "test";
  source: string;
  declaredAt: Date;
  resolvedAt: Date | null;
  lastActivityAt: Date;
  creatorName: string | null;
  region: string | null;
};

const leadRole = (tx: Tx, tenantId: string) =>
  tx
    .select({ id: incidentRoles.id })
    .from(incidentRoles)
    .where(and(eq(incidentRoles.tenantId, tenantId), eq(incidentRoles.isLead, true)));

async function baseRows(
  tx: Tx,
  tenantId: string,
  where: ReturnType<typeof and>,
): Promise<IncidentRow[]> {
  const [lead] = await leadRole(tx, tenantId);
  const rows = await tx
    .select({
      id: incidents.id,
      number: incidents.number,
      name: incidents.name,
      phase: incidents.phase,
      visibility: incidents.visibility,
      mode: incidents.mode,
      source: incidents.source,
      declaredAt: incidents.declaredAt,
      resolvedAt: incidents.resolvedAt,
      lastActivityAt: incidents.lastActivityAt,
      customFields: incidents.customFields,
      statusName: incidentStatuses.name,
      severityName: severities.name,
      severityRank: severities.rank,
      serviceName: catalogEntries.name,
      creatorName: members.name,
    })
    .from(incidents)
    .leftJoin(incidentStatuses, eq(incidentStatuses.id, incidents.statusId))
    .leftJoin(severities, eq(severities.id, incidents.severityId))
    .leftJoin(catalogEntries, eq(catalogEntries.id, incidents.serviceEntryId))
    .leftJoin(members, eq(members.id, incidents.creatorMemberId))
    .where(and(eq(incidents.tenantId, tenantId), isNull(incidents.mergedIntoId), where))
    .orderBy(desc(incidents.lastActivityAt))
    .limit(200);
  if (rows.length === 0) return [];
  const leads = lead
    ? await tx
        .select({ incidentId: roleAssignments.incidentId, name: members.name })
        .from(roleAssignments)
        .innerJoin(members, eq(members.id, roleAssignments.memberId))
        .where(
          and(
            eq(roleAssignments.roleId, lead.id),
            inArray(
              roleAssignments.incidentId,
              rows.map((r) => r.id),
            ),
          ),
        )
    : [];
  const leadBy = new Map(leads.map((l) => [l.incidentId, l.name]));
  return rows.map((r) => ({
    ...r,
    leadName: leadBy.get(r.id) ?? null,
    region: typeof r.customFields?.region === "string" ? (r.customFields.region as string) : null,
  }));
}

export async function listIncidents(
  tx: Tx,
  tenantId: string,
  view: IncidentView,
  memberId: string,
): Promise<IncidentRow[]> {
  switch (view) {
    case "open":
      return baseRows(
        tx,
        tenantId,
        and(ne(incidents.phase, "closed"), ne(incidents.phase, "triage")),
      );
    case "triage":
      return baseRows(tx, tenantId, eq(incidents.phase, "triage"));
    case "resolved": {
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
      return baseRows(
        tx,
        tenantId,
        and(eq(incidents.phase, "closed"), gte(incidents.closedAt, since)),
      );
    }
    case "mine": {
      const [lead] = await leadRole(tx, tenantId);
      if (!lead) return [];
      const mine = await tx
        .select({ incidentId: roleAssignments.incidentId })
        .from(roleAssignments)
        .where(and(eq(roleAssignments.tenantId, tenantId), eq(roleAssignments.memberId, memberId)));
      if (mine.length === 0) return [];
      return baseRows(
        tx,
        tenantId,
        inArray(
          incidents.id,
          mine.map((m) => m.incidentId),
        ),
      );
    }
    default:
      return [];
  }
}

export async function countViews(
  tx: Tx,
  tenantId: string,
  memberId: string,
): Promise<Record<IncidentView, number>> {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [row] = await tx
    .select({
      open: sql<number>`count(*) filter (where ${incidents.phase} not in ('closed','triage'))`.mapWith(
        Number,
      ),
      triage: sql<number>`count(*) filter (where ${incidents.phase} = 'triage')`.mapWith(Number),
      resolved:
        sql<number>`count(*) filter (where ${incidents.phase} = 'closed' and ${incidents.closedAt} >= ${since.toISOString()}::timestamptz)`.mapWith(
          Number,
        ),
    })
    .from(incidents)
    .where(and(eq(incidents.tenantId, tenantId), isNull(incidents.mergedIntoId)));
  const [mine] = await tx
    .select({ n: sql<number>`count(distinct ${roleAssignments.incidentId})`.mapWith(Number) })
    .from(roleAssignments)
    .innerJoin(incidents, eq(incidents.id, roleAssignments.incidentId))
    .where(
      and(
        eq(roleAssignments.tenantId, tenantId),
        eq(roleAssignments.memberId, memberId),
        ne(incidents.phase, "closed"),
      ),
    );
  const [fu] = await tx
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(followUps)
    .where(eq(followUps.tenantId, tenantId));
  return {
    open: row?.open ?? 0,
    triage: row?.triage ?? 0,
    resolved: row?.resolved ?? 0,
    mine: mine?.n ?? 0,
    "follow-ups": fu?.n ?? 0,
  };
}

export type FollowUpRow = {
  id: string;
  title: string;
  status: "open" | "done" | "cancelled";
  priorityName: string | null;
  incidentNumber: number;
  assigneeName: string | null;
  dueAt: Date | null;
  completedAt: Date | null;
  externalRef: { tracker: string; key: string; url?: string } | null;
  overdue: boolean;
};

export async function listFollowUps(
  tx: Tx,
  tenantId: string,
  incidentId?: string,
): Promise<FollowUpRow[]> {
  const rows = await tx
    .select({
      id: followUps.id,
      title: followUps.title,
      status: followUps.status,
      dueAt: followUps.dueAt,
      completedAt: followUps.completedAt,
      externalRef: followUps.externalRef,
      createdAt: followUps.createdAt,
      priorityName: followUpPriorities.name,
      priorityRank: followUpPriorities.rank,
      incidentNumber: incidents.number,
      assigneeName: members.name,
    })
    .from(followUps)
    .innerJoin(incidents, eq(incidents.id, followUps.incidentId))
    .leftJoin(followUpPriorities, eq(followUpPriorities.id, followUps.priorityId))
    .leftJoin(members, eq(members.id, followUps.assigneeMemberId))
    .where(
      and(
        eq(followUps.tenantId, tenantId),
        incidentId ? eq(followUps.incidentId, incidentId) : undefined,
      ),
    )
    .orderBy(
      sql`case ${followUps.status} when 'open' then 0 else 1 end`,
      asc(followUpPriorities.rank),
      asc(followUps.dueAt),
      asc(followUps.createdAt),
    )
    .limit(200);
  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    overdue: r.status === "open" && r.dueAt !== null && r.dueAt.getTime() < now,
  }));
}

/** The policy line above the follow-ups list: how many open ones are past their deadline. */
export async function followUpPolicy(
  tx: Tx,
  tenantId: string,
): Promise<{ p1Days: number | null; overdue: number }> {
  const [p1] = await tx
    .select({ days: followUpPriorities.completeWithinDays })
    .from(followUpPriorities)
    .where(and(eq(followUpPriorities.tenantId, tenantId), eq(followUpPriorities.rank, 0)));
  const [row] = await tx
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(followUps)
    .where(
      and(
        eq(followUps.tenantId, tenantId),
        eq(followUps.status, "open"),
        sql`${followUps.dueAt} < now()`,
      ),
    );
  return { p1Days: p1?.days ?? null, overdue: row?.n ?? 0 };
}

export type IncidentDetail = {
  row: IncidentRow;
  summary: string | null;
  typeName: string;
  severityDescription: string | null;
  statuses: Array<{ id: string; name: string; rank: number }>;
  severities: Array<{ id: string; name: string; rank: number }>;
  roles: Array<{
    roleId: string;
    roleName: string;
    isLead: boolean;
    memberId: string | null;
    memberName: string | null;
  }>;
  participants: { participants: number; observers: number };
  events: Array<typeof incidentEvents.$inferSelect>;
  customFields: Array<{ key: string; label: string; value: string }>;
  acknowledgedAt: Date | null;
  acceptedAt: Date | null;
  closedAt: Date | null;
  nextUpdateDueAt: Date | null;
  position: { index: number; total: number; prev: number | null; next: number | null };
  followUps: FollowUpRow[];
  tasks: Array<typeof postIncidentTasks.$inferSelect & { assigneeName: string | null }>;
  postMortem: (typeof postMortems.$inferSelect & { ownerName: string | null }) | null;
  debrief: (typeof debriefs.$inferSelect & { attendees: string[] }) | null;
};

export async function getIncident(
  tx: Tx,
  tenantId: string,
  number: number,
): Promise<IncidentDetail | null> {
  const [row] = await baseRows(tx, tenantId, eq(incidents.number, number));
  if (!row) return null;
  const [full] = await tx.select().from(incidents).where(eq(incidents.id, row.id));
  if (!full) return null;

  const [type] = await tx
    .select({ name: incidentTypes.name })
    .from(incidentTypes)
    .where(eq(incidentTypes.id, full.typeId));
  const statuses = await tx
    .select({ id: incidentStatuses.id, name: incidentStatuses.name, rank: incidentStatuses.rank })
    .from(incidentStatuses)
    .where(eq(incidentStatuses.typeId, full.typeId))
    .orderBy(asc(incidentStatuses.rank));
  const sevs = await tx
    .select({
      id: severities.id,
      name: severities.name,
      rank: severities.rank,
      description: severities.description,
    })
    .from(severities)
    .where(eq(severities.tenantId, tenantId))
    .orderBy(asc(severities.rank));
  const roleRows = await tx
    .select({
      roleId: incidentRoles.id,
      roleName: incidentRoles.name,
      isLead: incidentRoles.isLead,
      position: incidentRoles.position,
    })
    .from(incidentRoles)
    .where(eq(incidentRoles.tenantId, tenantId))
    .orderBy(asc(incidentRoles.position));
  const assigned = await tx
    .select({
      roleId: roleAssignments.roleId,
      memberId: roleAssignments.memberId,
      memberName: members.name,
    })
    .from(roleAssignments)
    .innerJoin(members, eq(members.id, roleAssignments.memberId))
    .where(eq(roleAssignments.incidentId, full.id));
  const [counts] = await tx
    .select({
      participants:
        sql<number>`count(*) filter (where ${incidentParticipants.kind} = 'participant')`.mapWith(
          Number,
        ),
      observers:
        sql<number>`count(*) filter (where ${incidentParticipants.kind} = 'observer')`.mapWith(
          Number,
        ),
    })
    .from(incidentParticipants)
    .where(eq(incidentParticipants.incidentId, full.id));
  const events = await tx
    .select()
    .from(incidentEvents)
    .where(eq(incidentEvents.incidentId, full.id))
    .orderBy(asc(incidentEvents.occurredAt), asc(incidentEvents.createdAt));
  const fieldDefs = await tx
    .select()
    .from(incidentFields)
    .where(eq(incidentFields.tenantId, tenantId))
    .orderBy(asc(incidentFields.position));
  const customFields = fieldDefs
    .filter(
      (f) =>
        full.customFields[f.key] !== undefined &&
        full.customFields[f.key] !== null &&
        full.customFields[f.key] !== "",
    )
    .map((f) => ({ key: f.key, label: f.label, value: String(full.customFields[f.key]) }));

  // Position among the incidents the list orders the same way (latest activity first).
  const ordered = await tx
    .select({ number: incidents.number })
    .from(incidents)
    .where(
      and(
        eq(incidents.tenantId, tenantId),
        isNull(incidents.mergedIntoId),
        ne(incidents.phase, "closed"),
      ),
    )
    .orderBy(desc(incidents.lastActivityAt));
  const numbers = ordered.map((o) => o.number);
  const index = numbers.indexOf(number);
  const position =
    index === -1
      ? { index: 0, total: 0, prev: null, next: null }
      : {
          index: index + 1,
          total: numbers.length,
          prev: numbers[index - 1] ?? null,
          next: numbers[index + 1] ?? null,
        };

  const fu = await listFollowUps(tx, tenantId, full.id);
  const taskRows = await tx
    .select({ task: postIncidentTasks, assigneeName: members.name })
    .from(postIncidentTasks)
    .leftJoin(members, eq(members.id, postIncidentTasks.assigneeMemberId))
    .where(eq(postIncidentTasks.incidentId, full.id))
    .orderBy(asc(postIncidentTasks.phase), asc(postIncidentTasks.position));
  const [pm] = await tx
    .select({ pm: postMortems, ownerName: members.name })
    .from(postMortems)
    .leftJoin(members, eq(members.id, postMortems.ownerMemberId))
    .where(eq(postMortems.incidentId, full.id));
  const [db] = await tx.select().from(debriefs).where(eq(debriefs.incidentId, full.id));
  const attendees =
    db && db.attendeeMemberIds.length > 0
      ? (
          await tx
            .select({ name: members.name })
            .from(members)
            .where(inArray(members.id, db.attendeeMemberIds))
        ).map((m) => m.name)
      : [];

  return {
    row,
    summary: full.summary,
    typeName: type?.name ?? "",
    severityDescription: sevs.find((s) => s.id === full.severityId)?.description ?? null,
    statuses,
    severities: sevs.map((s) => ({ id: s.id, name: s.name, rank: s.rank })),
    roles: roleRows.map((r) => {
      const a = assigned.find((x) => x.roleId === r.roleId);
      return {
        roleId: r.roleId,
        roleName: r.roleName,
        isLead: r.isLead,
        memberId: a?.memberId ?? null,
        memberName: a?.memberName ?? null,
      };
    }),
    participants: { participants: counts?.participants ?? 0, observers: counts?.observers ?? 0 },
    events,
    customFields,
    acknowledgedAt: full.acknowledgedAt,
    acceptedAt: full.acceptedAt,
    closedAt: full.closedAt,
    nextUpdateDueAt: full.nextUpdateDueAt,
    position,
    followUps: fu,
    tasks: taskRows.map((r) => ({ ...r.task, assigneeName: r.assigneeName })),
    postMortem: pm ? { ...pm.pm, ownerName: pm.ownerName } : null,
    debrief: db ? { ...db, attendees } : null,
  };
}

/** Everything the declaration form offers: types, severities, services, the responders. */
export async function declareOptions(tx: Tx, tenantId: string) {
  const types = await tx
    .select({
      id: incidentTypes.id,
      name: incidentTypes.name,
      isDefault: incidentTypes.isDefault,
      declareForm: incidentTypes.declareForm,
      privateByDefault: incidentTypes.privateByDefault,
      restrictedToTeamIds: incidentTypes.restrictedToTeamIds,
    })
    .from(incidentTypes)
    .where(eq(incidentTypes.tenantId, tenantId))
    .orderBy(asc(incidentTypes.position));
  const sevs = await tx
    .select({
      id: severities.id,
      name: severities.name,
      description: severities.description,
      rank: severities.rank,
    })
    .from(severities)
    .where(eq(severities.tenantId, tenantId))
    .orderBy(asc(severities.rank));
  const services = await tx
    .select({
      id: catalogEntries.id,
      name: catalogEntries.name,
      typeKey: sql<string>`(select key from app.catalog_types ct where ct.id = ${catalogEntries.typeId})`,
    })
    .from(catalogEntries)
    .where(eq(catalogEntries.tenantId, tenantId))
    .orderBy(asc(catalogEntries.name));
  const fields = await tx
    .select()
    .from(incidentFields)
    .where(eq(incidentFields.tenantId, tenantId))
    .orderBy(asc(incidentFields.position));
  return {
    types,
    severities: sevs,
    services: services.filter((s) => s.typeKey === "service"),
    fields,
  };
}

/** Open incidents whose name resembles the title being typed — the anti-duplicate hint. */
export async function similarOpenIncidents(tx: Tx, tenantId: string, title: string) {
  const q = title.trim();
  if (q.length < 3) return [];
  return tx
    .select({ number: incidents.number, name: incidents.name, declaredAt: incidents.declaredAt })
    .from(incidents)
    .where(
      and(
        eq(incidents.tenantId, tenantId),
        ne(incidents.phase, "closed"),
        sql`similarity(${incidents.name}, ${q}) > 0.25 or ${incidents.name} ilike ${"%" + q + "%"}`,
      ),
    )
    .orderBy(desc(incidents.lastActivityAt))
    .limit(3);
}
