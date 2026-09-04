/**
 * Defaults installed in EVERY new workspace: severities, the default incident
 * type with its lifecycle, the two roles, follow-up priorities and their
 * policy, the three catalog types, the post-incident flow. Example content,
 * meant to be edited — it exists so a fresh install has something to look at
 * and so the code paths have rows to read.
 *
 * Runs inside the caller's tenant transaction (provisioning, the demo seed) and
 * is idempotent: it does nothing when severities already exist.
 */
import { eq } from "drizzle-orm";
import type { Tx } from "../client";
import {
  catalogTypes,
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
  catalogTypeIds: Record<"team" | "service" | "environment", string>;
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

  /* ---------- Catalog types — the spine of the routing ---------- */
  const catRows = await tx
    .insert(catalogTypes)
    .values([
      {
        tenantId,
        key: "team",
        name: T("catalog.team"),
        description: T("catalog.team.desc"),
        position: 0,
        attributes: [
          { key: "members", label: T("attr.members"), type: "member_list" },
          { key: "escalation_path", label: T("attr.escalationPath"), type: "text" },
          { key: "chat_channel", label: T("attr.chatChannel"), type: "text" },
        ],
      },
      {
        tenantId,
        key: "service",
        name: T("catalog.service"),
        description: T("catalog.service.desc"),
        position: 1,
        attributes: [
          { key: "owner", label: T("attr.owner"), type: "entry", refTypeKey: "team" },
          { key: "repository", label: T("attr.repository"), type: "text" },
          {
            key: "tier",
            label: T("attr.tier"),
            type: "select",
            options: ["tier 1", "tier 2", "tier 3"],
          },
          { key: "environments", label: T("attr.environments"), type: "text" },
        ],
      },
      {
        tenantId,
        key: "environment",
        name: T("catalog.environment"),
        description: T("catalog.environment.desc"),
        position: 2,
        attributes: [
          { key: "paging", label: T("attr.paging"), type: "select", options: ["pages", "silent"] },
        ],
      },
    ])
    .returning({ id: catalogTypes.id, key: catalogTypes.key });
  const cat = (key: string) => catRows.find((c) => c.key === key)!.id;

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
    catalogTypeIds: { team: cat("team"), service: cat("service"), environment: cat("environment") },
  };
}
