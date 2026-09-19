/**
 * Defaults installed in EVERY new workspace: severities, the default incident
 * type with its lifecycle, the two roles, follow-up priorities and their
 * policy, the alert vocabulary, the post-incident flow. Example content,
 * meant to be edited — it exists so a fresh install has something to look at
 * and so the code paths have rows to read.
 *
 * Runs inside the caller's tenant transaction (provisioning, the demo seed) and
 * is idempotent: it does nothing when severities already exist.
 */
import { eq } from "drizzle-orm";
import type { Tx } from "../client";
import {
  alertAttributes,
  alertPriorities,
  alertRoutes,
  followUpPriorities,
  incidentRoles,
  incidentStatuses,
  incidentTypes,
  postIncidentTaskDefs,
  severities,
} from "../schema/app";
import { seedText } from "./defaults-i18n";

export type InstalledDefaults = {
  severityIds: Record<"SEV1" | "SEV2" | "SEV3" | "SEV4", string>;
  defaultTypeId: string;
  statusIds: Record<"investigating" | "fixing" | "monitoring", string>;
  leadRoleId: string;
  commsRoleId: string;
  priorityIds: Record<"P1" | "P2" | "P3", string>;
  alertPriorityIds: Record<"P1" | "P2" | "P3", string>;
  /** The route every new workspace starts with: catches everything, pages nobody until someone is named. */
  defaultRouteId: string;
};

export async function installDefaults(
  tx: Tx,
  tenantId: string,
  locale = "en",
): Promise<InstalledDefaults | null> {
  const T = (key: string) => seedText(key, locale);

  const [existing] = await tx
    .select({ id: severities.id })
    .from(severities)
    .where(eq(severities.tenantId, tenantId))
    .limit(1);
  if (existing) return null;

  /* ---------- Severities — shared by every type, ordered ---------- */
  const sevRows = await tx
    .insert(severities)
    .values([
      { tenantId, name: "SEV1", rank: 0, description: T("sev1.desc"), postIncident: "always" },
      { tenantId, name: "SEV2", rank: 1, description: T("sev2.desc"), postIncident: "yes" },
      { tenantId, name: "SEV3", rank: 2, description: T("sev3.desc"), postIncident: "opt_in" },
      { tenantId, name: "SEV4", rank: 3, description: T("sev4.desc"), postIncident: "never" },
    ])
    .returning({ id: severities.id, name: severities.name });
  const sev = (name: string) => sevRows.find((s) => s.name === name)!.id;

  /* ---------- The default type and its lifecycle ---------- */
  const [type] = await tx
    .insert(incidentTypes)
    .values({
      tenantId,
      name: T("type.default"),
      description: T("type.default.desc"),
      isDefault: true,
      postIncidentFromRank: 1, // SEV2 and above
      declareForm: [
        { key: "title", required: true },
        { key: "severity", required: true },
        { key: "service", required: true },
        { key: "summary", required: false },
      ],
      position: 0,
    })
    .returning({ id: incidentTypes.id });
  const statusRows = await tx
    .insert(incidentStatuses)
    .values([
      {
        tenantId,
        typeId: type!.id,
        name: T("status.investigating"),
        description: T("status.investigating.desc"),
        rank: 0,
        updateReminderMinutes: 30,
        publicStatus: "investigating",
      },
      {
        tenantId,
        typeId: type!.id,
        name: T("status.fixing"),
        description: T("status.fixing.desc"),
        rank: 1,
        updateReminderMinutes: 30,
        publicStatus: "identified",
      },
      {
        tenantId,
        typeId: type!.id,
        name: T("status.monitoring"),
        description: T("status.monitoring.desc"),
        rank: 2,
        updateReminderMinutes: 60,
        publicStatus: "monitoring",
      },
    ])
    .returning({ id: incidentStatuses.id, rank: incidentStatuses.rank });
  const status = (rank: number) => statusRows.find((s) => s.rank === rank)!.id;

  /* ---------- Roles ---------- */
  const roleRows = await tx
    .insert(incidentRoles)
    .values([
      {
        tenantId,
        name: T("role.lead"),
        description: T("role.lead.desc"),
        instructions: T("role.lead.instructions"),
        isLead: true,
        position: 0,
      },
      { tenantId, name: T("role.comms"), description: T("role.comms.desc"), position: 1 },
    ])
    .returning({ id: incidentRoles.id, isLead: incidentRoles.isLead });

  /* ---------- Follow-up priorities and their policy ---------- */
  const prioRows = await tx
    .insert(followUpPriorities)
    .values([
      { tenantId, name: "P1", rank: 0, description: T("prio.p1.desc"), completeWithinDays: 14 },
      { tenantId, name: "P2", rank: 1, description: T("prio.p2.desc"), completeWithinDays: 30 },
      { tenantId, name: "P3", rank: 2, description: T("prio.p3.desc"), completeWithinDays: null },
    ])
    .returning({ id: followUpPriorities.id, name: followUpPriorities.name });
  const prio = (name: string) => prioRows.find((p) => p.name === name)!.id;

  /* ---------- Alerting — three priorities, the attribute vocabulary, one route ---------- */
  const aprioRows = await tx
    .insert(alertPriorities)
    .values([
      {
        tenantId,
        name: "P1",
        rank: 0,
        position: 0,
        urgency: "high",
        color: "var(--dang)",
        description: T("aprio.p1.desc"),
        aliases: ["critical", "sev1", "p1", "high", "fatal", "emergency", "page"],
      },
      {
        tenantId,
        name: "P2",
        rank: 1,
        position: 1,
        urgency: "high",
        color: "var(--wait)",
        description: T("aprio.p2.desc"),
        aliases: ["warning", "major", "medium", "p2", "error", "sev2"],
        isDefault: true,
      },
      {
        tenantId,
        name: "P3",
        rank: 2,
        position: 2,
        urgency: "low",
        color: "var(--ink-3)",
        description: T("aprio.p3.desc"),
        aliases: ["info", "low", "minor", "p3", "notice", "sev3", "sev4"],
      },
    ])
    .returning({ id: alertPriorities.id, name: alertPriorities.name });
  const aprio = (name: string) => aprioRows.find((p) => p.name === name)!.id;

  await tx.insert(alertAttributes).values([
    {
      tenantId,
      key: "service",
      label: T("aattr.service"),
      description: T("aattr.service.desc"),
      type: "service",
      position: 0,
    },
    {
      tenantId,
      key: "team",
      label: T("aattr.team"),
      description: T("aattr.team.desc"),
      type: "team",
      position: 1,
    },
    {
      tenantId,
      key: "environment",
      label: T("aattr.environment"),
      description: T("aattr.environment.desc"),
      type: "text",
      position: 2,
    },
    {
      tenantId,
      key: "region",
      label: T("aattr.region"),
      description: T("aattr.region.desc"),
      type: "text",
      position: 3,
    },
    {
      tenantId,
      key: "severity",
      label: T("aattr.severity"),
      description: T("aattr.severity.desc"),
      type: "text",
      position: 4,
    },
  ]);

  const [defaultRoute] = await tx
    .insert(alertRoutes)
    .values({
      tenantId,
      name: T("route.default"),
      description: T("route.default.desc"),
      active: true,
      sourceIds: [],
      conditions: [],
      escalations: [],
      incident: {
        mode: "conditional",
        typeId: type!.id,
        startPhase: "triage",
        severity: { mode: "priority" },
        visibility: "public",
        customFields: {},
        declineOnResolve: true,
      },
      grouping: {
        enabled: true,
        by: ["service"],
        windowMinutes: 5,
        extending: true,
        escalate: "never",
        graceMinutes: 0,
      },
      notify: null,
      escalationMode: "none",
      incidentMode: "conditional",
      incidentTypeId: type!.id,
      // Last on purpose: the routes a workspace adds come before the one that catches everything.
      position: 1000,
    })
    .returning({ id: alertRoutes.id });

  /* ---------- Post-incident flow — two phases, six tasks ---------- */
  await tx.insert(postIncidentTaskDefs).values([
    {
      tenantId,
      phase: "documenting",
      title: T("task.reviewTimeline"),
      defaultAssigneeRole: "lead",
      dueAfterDays: 2,
      position: 0,
    },
    {
      tenantId,
      phase: "documenting",
      title: T("task.createPostMortem"),
      defaultAssigneeRole: "lead",
      dueAfterDays: 3,
      position: 1,
    },
    {
      tenantId,
      phase: "documenting",
      title: T("task.scheduleDebrief"),
      defaultAssigneeRole: "lead",
      dueAfterDays: 3,
      position: 2,
    },
    {
      tenantId,
      phase: "reviewing",
      title: T("task.reviewFollowUps"),
      defaultAssigneeRole: "lead",
      dueAfterDays: 7,
      position: 0,
    },
    {
      tenantId,
      phase: "reviewing",
      title: T("task.sharePostMortem"),
      defaultAssigneeRole: "communication",
      dueAfterDays: 7,
      position: 1,
    },
    {
      tenantId,
      phase: "reviewing",
      title: T("task.holdDebrief"),
      defaultAssigneeRole: "lead",
      dueAfterDays: 7,
      position: 2,
    },
  ]);

  return {
    severityIds: { SEV1: sev("SEV1"), SEV2: sev("SEV2"), SEV3: sev("SEV3"), SEV4: sev("SEV4") },
    defaultTypeId: type!.id,
    statusIds: { investigating: status(0), fixing: status(1), monitoring: status(2) },
    leadRoleId: roleRows.find((r) => r.isLead)!.id,
    commsRoleId: roleRows.find((r) => !r.isLead)!.id,
    priorityIds: { P1: prio("P1"), P2: prio("P2"), P3: prio("P3") },
    alertPriorityIds: { P1: aprio("P1"), P2: aprio("P2"), P3: aprio("P3") },
    defaultRouteId: defaultRoute!.id,
  };
}
