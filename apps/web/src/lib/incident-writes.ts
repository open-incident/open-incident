/**
 * The write paths of an incident — declare, update, follow up — shared by the
 * web actions and the public API. Each takes the tenant transaction and an
 * actor, writes the rows and the timeline events that say so, and returns what
 * the caller needs. The side effects that must happen AFTER the commit —
 * announcements, webhooks — are gathered by `afterIncidentChange`.
 */
import { and, asc, eq } from "drizzle-orm";
import {
  catalogEntries,
  followUpPriorities,
  followUps,
  incidentEvents,
  incidentFields,
  incidentParticipants,
  incidentRoles,
  incidentStatuses,
  incidentTypes,
  incidentUpdates,
  incidents,
  nextIncidentNumber,
  postIncidentTaskDefs,
  postIncidentTasks,
  roleAssignments,
  severities,
  withTenant,
  type Tx,
} from "@openincident/db";
import { dispatchWebhookEvent, incidentPayload, type WebhookEvent } from "@openincident/webhooks";
import { refreshAnnouncements } from "@/lib/announcements";
import {
  ensureIncidentChannels,
  getBridgeTemplate,
  postIncidentNoteAll,
  postIncidentUpdateAll,
  refreshIncidentHeaders,
} from "@openincident/chat";
import { tenantOrigin } from "@openincident/oncall";
import { getTenantById } from "@openincident/db";

export type Actor = { kind: "member" | "api" | "system"; memberId: string | null; name: string };

export type DeclareInput = {
  name: string;
  summary?: string | null;
  mode: "live" | "retrospective" | "test";
  typeId: string;
  severityId?: string | null;
  serviceEntryId?: string | null;
  customFields: Record<string, unknown>;
  declaredAt?: Date;
  source: "web" | "api" | "alert" | "chat";
  /** Where the incident starts: an alert route may drop it in triage. */
  phase?: "triage" | "active";
  /** The alert that created it — the timeline then opens on "created from alert". */
  alertRef?: { id: string; source: string; title: string };
  /** Label of the resolved status in the timeline; the API passes none. */
  resolvedLabel?: string;
};

async function touch(tx: Tx, tenantId: string, actor: Actor, incidentId: string, now: Date) {
  await tx
    .update(incidents)
    .set({ lastActivityAt: now, updatedAt: now })
    .where(eq(incidents.id, incidentId));
  if (actor.memberId) {
    await tx
      .insert(incidentParticipants)
      .values({
        tenantId,
        incidentId,
        memberId: actor.memberId,
        kind: "participant",
        firstActivityAt: now,
        lastActivityAt: now,
      })
      .onConflictDoUpdate({
        target: [incidentParticipants.incidentId, incidentParticipants.memberId],
        set: { kind: "participant", lastActivityAt: now },
      });
  }
}

/** Custom field values from a flat record, typed by the workspace's definitions. */
export async function coerceCustomFields(
  tx: Tx,
  tenantId: string,
  raw: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const defs = await tx.select().from(incidentFields).where(eq(incidentFields.tenantId, tenantId));
  const out: Record<string, unknown> = {};
  for (const def of defs) {
    const v = raw[def.key];
    if (v === undefined || v === null || v === "") continue;
    out[def.key] = def.type === "number" ? Number(v) : String(v).slice(0, 2000);
  }
  return out;
}

export async function declareIncidentCore(
  tx: Tx,
  tenantId: string,
  actor: Actor,
  input: DeclareInput,
): Promise<{ id: string; number: number }> {
  const [type] = await tx
    .select()
    .from(incidentTypes)
    .where(and(eq(incidentTypes.tenantId, tenantId), eq(incidentTypes.id, input.typeId)));
  if (!type) throw new Error("unknown_type");
  const [first] = await tx
    .select()
    .from(incidentStatuses)
    .where(eq(incidentStatuses.typeId, type.id))
    .orderBy(asc(incidentStatuses.rank))
    .limit(1);
  const [sev] = input.severityId
    ? await tx
        .select()
        .from(severities)
        .where(and(eq(severities.tenantId, tenantId), eq(severities.id, input.severityId)))
    : [];
  const [service] = input.serviceEntryId
    ? await tx
        .select({ id: catalogEntries.id, name: catalogEntries.name })
        .from(catalogEntries)
        .where(
          and(eq(catalogEntries.tenantId, tenantId), eq(catalogEntries.id, input.serviceEntryId)),
        )
    : [];
  const declaredAt =
    input.mode === "retrospective" && input.declaredAt ? input.declaredAt : new Date();
  const now = new Date();

  let attempts = 0;
  for (;;) {
    const n = await nextIncidentNumber(tx, tenantId);
    try {
      const [row] = await tx
        .insert(incidents)
        .values({
          tenantId,
          number: n,
          name: input.name,
          summary: input.summary || null,
          mode: input.mode,
          visibility: type.privateByDefault ? "private" : "public",
          typeId: type.id,
          severityId: sev?.id ?? null,
          phase: input.phase ?? "active",
          statusId: input.phase === "triage" ? null : (first?.id ?? null),
          serviceEntryId: service?.id ?? null,
          creatorMemberId: actor.memberId,
          source: input.source,
          customFields: input.customFields,
          declaredAt,
          acceptedAt: input.phase === "triage" ? null : now,
          lastActivityAt: now,
          nextUpdateDueAt:
            input.phase !== "triage" && input.mode === "live" && first?.updateReminderMinutes
              ? new Date(now.getTime() + first.updateReminderMinutes * 60_000)
              : null,
        })
        .returning({ id: incidents.id, number: incidents.number });
      const id = row!.id;
      await tx.insert(incidentEvents).values({
        tenantId,
        incidentId: id,
        kind: input.alertRef ? "created_from_alert" : "declared",
        actorKind: actor.kind,
        actorMemberId: actor.memberId,
        actorName: actor.name,
        payload: input.alertRef
          ? {
              source: input.alertRef.source,
              title: input.alertRef.title,
              alertId: input.alertRef.id,
              phase: input.phase ?? "active",
              service: service?.name ?? null,
            }
          : {
              source: input.source,
              mode: input.mode,
              severity: sev?.name ?? null,
              service: service?.name ?? null,
            },
        occurredAt: declaredAt,
      });
      if (actor.memberId) {
        const [lead] = await tx
          .select({ id: incidentRoles.id })
          .from(incidentRoles)
          .where(and(eq(incidentRoles.tenantId, tenantId), eq(incidentRoles.isLead, true)));
        if (lead) {
          await tx
            .insert(roleAssignments)
            .values({ tenantId, incidentId: id, roleId: lead.id, memberId: actor.memberId });
          await tx.insert(incidentEvents).values({
            tenantId,
            incidentId: id,
            kind: "role_assigned",
            actorKind: "member",
            actorMemberId: actor.memberId,
            actorName: actor.name,
            payload: { role: "lead", member: actor.name },
            occurredAt: new Date(declaredAt.getTime() + 1),
          });
        }
        await tx
          .insert(incidentParticipants)
          .values({ tenantId, incidentId: id, memberId: actor.memberId, kind: "participant" });
      }
      return { id, number: row!.number };
    } catch (err) {
      // The unique (tenant_id, number) index caught a concurrent declaration: retry once with the next number.
      if (attempts++ < 1 && err instanceof Error && /incidents_tenant_number/.test(err.message))
        continue;
      throw err;
    }
  }
}

export type UpdateInput = {
  /** A status of the incident's type, or "resolve". */
  statusId: string;
  message: string;
  severityId?: string | null;
  nextUpdateMinutes?: number | null;
  /** The word for "Resolved" in the workspace's language, for the timeline. */
  resolvedLabel: string;
};

export type UpdateResult = {
  resolved: boolean;
  enteredPostIncident: boolean;
  statusChanged: boolean;
  severityChanged: boolean;
};

/**
 * The status update — one gesture, several facts: the message, maybe a new
 * status, maybe a new severity, maybe a reminder. "Resolved" closes the active
 * phase and, when the severity or the type asks for it, starts the
 * post-incident flow with its tasks.
 */
export async function postUpdateCore(
  tx: Tx,
  tenantId: string,
  actor: Actor,
  incidentId: string,
  input: UpdateInput,
): Promise<UpdateResult | null> {
  const [inc] = await tx
    .select()
    .from(incidents)
    .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, incidentId)));
  if (!inc || inc.phase === "closed") return null;
  const now = new Date();
  const resolves = input.statusId === "resolve";
  const [status] = resolves
    ? []
    : await tx
        .select()
        .from(incidentStatuses)
        .where(
          and(eq(incidentStatuses.typeId, inc.typeId), eq(incidentStatuses.id, input.statusId)),
        );
  if (!resolves && !status) return null;
  const [sev] = input.severityId
    ? await tx
        .select()
        .from(severities)
        .where(and(eq(severities.tenantId, tenantId), eq(severities.id, input.severityId)))
    : [];
  const [prevSev] = inc.severityId
    ? await tx
        .select({ name: severities.name, rank: severities.rank })
        .from(severities)
        .where(eq(severities.id, inc.severityId))
    : [];
  const nextMinutes = !resolves && input.nextUpdateMinutes ? input.nextUpdateMinutes : null;
  const nextDue = nextMinutes ? new Date(now.getTime() + nextMinutes * 60_000) : null;
  const severityChanged = Boolean(sev && sev.id !== inc.severityId);

  await tx.insert(incidentUpdates).values({
    tenantId,
    incidentId: inc.id,
    memberId: actor.memberId,
    statusId: status?.id ?? null,
    severityId: sev?.id ?? null,
    resolves,
    message: input.message,
    nextUpdateDueAt: nextDue,
    createdAt: now,
  });
  await tx.insert(incidentEvents).values({
    tenantId,
    incidentId: inc.id,
    kind: "update_posted",
    actorKind: actor.kind,
    actorMemberId: actor.memberId,
    actorName: actor.name,
    payload: {
      status: resolves ? input.resolvedLabel : (status?.name ?? null),
      message: input.message,
      nextUpdateMinutes: nextMinutes,
      severity: severityChanged ? sev!.name : null,
    },
    occurredAt: now,
  });
  if (severityChanged) {
    await tx.insert(incidentEvents).values({
      tenantId,
      incidentId: inc.id,
      kind: "severity_changed",
      actorKind: actor.kind,
      actorMemberId: actor.memberId,
      actorName: actor.name,
      payload: { from: prevSev?.name ?? null, to: sev!.name },
      occurredAt: new Date(now.getTime() + 1),
    });
  }
  const effectiveSevRank = sev?.rank ?? prevSev?.rank ?? null;
  let enteredPostIncident = false;
  let statusChanged = false;

  if (resolves) {
    const [type] = await tx.select().from(incidentTypes).where(eq(incidentTypes.id, inc.typeId));
    const sevRow =
      sev ??
      (inc.severityId
        ? (await tx.select().from(severities).where(eq(severities.id, inc.severityId)))[0]
        : undefined);
    const byType =
      type?.postIncidentFromRank !== null &&
      type?.postIncidentFromRank !== undefined &&
      effectiveSevRank !== null &&
      effectiveSevRank <= (type.postIncidentFromRank === -1 ? 99 : type.postIncidentFromRank);
    const bySeverity = sevRow
      ? sevRow.postIncident === "always" || sevRow.postIncident === "yes"
      : false;
    enteredPostIncident = byType || bySeverity;
    await tx
      .update(incidents)
      .set({
        phase: enteredPostIncident ? "post_incident" : "closed",
        statusId: null,
        resolvedAt: now,
        closedAt: enteredPostIncident ? null : now,
        nextUpdateDueAt: null,
        severityId: sev?.id ?? inc.severityId,
      })
      .where(eq(incidents.id, inc.id));
    await tx.insert(incidentEvents).values({
      tenantId,
      incidentId: inc.id,
      kind: "resolved",
      actorKind: actor.kind,
      actorMemberId: actor.memberId,
      actorName: actor.name,
      payload: {
        durationMinutes: Math.round((now.getTime() - inc.declaredAt.getTime()) / 60_000),
        ttaMinutes: inc.acknowledgedAt
          ? Math.round((inc.acknowledgedAt.getTime() - inc.declaredAt.getTime()) / 60_000)
          : undefined,
        postIncident: enteredPostIncident ? (sevRow?.name ?? type?.name ?? null) : null,
      },
      occurredAt: new Date(now.getTime() + 2),
    });
    if (enteredPostIncident) {
      const defs = await tx
        .select()
        .from(postIncidentTaskDefs)
        .where(eq(postIncidentTaskDefs.tenantId, tenantId))
        .orderBy(asc(postIncidentTaskDefs.phase), asc(postIncidentTaskDefs.position));
      const [lead] = await tx
        .select({ memberId: roleAssignments.memberId })
        .from(roleAssignments)
        .innerJoin(
          incidentRoles,
          and(eq(incidentRoles.id, roleAssignments.roleId), eq(incidentRoles.isLead, true)),
        )
        .where(eq(roleAssignments.incidentId, inc.id));
      if (defs.length > 0) {
        await tx.insert(postIncidentTasks).values(
          defs.map((d) => ({
            tenantId,
            incidentId: inc.id,
            defId: d.id,
            phase: d.phase,
            title: d.title,
            assigneeMemberId:
              d.defaultAssigneeRole === "lead" ? (lead?.memberId ?? actor.memberId) : null,
            dueAt: d.dueAfterDays ? new Date(now.getTime() + d.dueAfterDays * 86_400_000) : null,
            position: d.position,
          })),
        );
      }
      await tx.insert(incidentEvents).values({
        tenantId,
        incidentId: inc.id,
        kind: "post_incident_started",
        actorKind: "system",
        payload: { rule: sevRow?.name ?? null, tasks: defs.length },
        occurredAt: new Date(now.getTime() + 3),
      });
    } else {
      await tx.insert(incidentEvents).values({
        tenantId,
        incidentId: inc.id,
        kind: "closed",
        actorKind: "system",
        payload: {},
        occurredAt: new Date(now.getTime() + 3),
      });
    }
  } else if (status) {
    statusChanged = status.id !== inc.statusId;
    await tx
      .update(incidents)
      .set({
        statusId: status.id,
        severityId: sev?.id ?? inc.severityId,
        nextUpdateDueAt: nextDue,
        phase: "active",
      })
      .where(eq(incidents.id, inc.id));
    if (statusChanged) {
      const [prev] = inc.statusId
        ? await tx
            .select({ name: incidentStatuses.name })
            .from(incidentStatuses)
            .where(eq(incidentStatuses.id, inc.statusId))
        : [];
      await tx.insert(incidentEvents).values({
        tenantId,
        incidentId: inc.id,
        kind: "status_changed",
        actorKind: actor.kind,
        actorMemberId: actor.memberId,
        actorName: actor.name,
        payload: { from: prev?.name ?? null, to: status.name },
        occurredAt: new Date(now.getTime() + 2),
      });
    }
  }
  await touch(tx, tenantId, actor, inc.id, now);
  return { resolved: resolves, enteredPostIncident, statusChanged, severityChanged };
}

export async function addFollowUpCore(
  tx: Tx,
  tenantId: string,
  actor: Actor,
  incidentId: string,
  input: { title: string; priorityName?: string | null; assigneeMemberId?: string | null },
): Promise<{ id: string } | null> {
  const [inc] = await tx
    .select({ id: incidents.id })
    .from(incidents)
    .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, incidentId)));
  if (!inc) return null;
  const [prio] = input.priorityName
    ? await tx
        .select()
        .from(followUpPriorities)
        .where(
          and(
            eq(followUpPriorities.tenantId, tenantId),
            eq(followUpPriorities.name, input.priorityName),
          ),
        )
    : [];
  const now = new Date();
  const [row] = await tx
    .insert(followUps)
    .values({
      tenantId,
      incidentId: inc.id,
      title: input.title,
      priorityId: prio?.id ?? null,
      assigneeMemberId: input.assigneeMemberId ?? actor.memberId,
      dueAt: prio?.completeWithinDays
        ? new Date(now.getTime() + prio.completeWithinDays * 86_400_000)
        : null,
    })
    .returning({ id: followUps.id });
  await tx.insert(incidentEvents).values({
    tenantId,
    incidentId: inc.id,
    kind: "follow_up_created",
    actorKind: actor.kind,
    actorMemberId: actor.memberId,
    actorName: actor.name,
    payload: { title: input.title, priority: prio?.name ?? null },
    occurredAt: now,
  });
  await touch(tx, tenantId, actor, inc.id, now);
  return { id: row!.id };
}

/**
 * What happens once the transaction is committed: the announcements the rules
 * ask for are rewritten, and the webhooks go out with the incident's public
 * shape. Never throws — these are side effects of someone else's gesture.
 */
export async function afterIncidentChange(
  tenantId: string,
  incidentId: string,
  events: WebhookEvent[],
  extra: Record<string, unknown> = {},
  options: { chat?: boolean } = {},
): Promise<void> {
  try {
    await syncChat(tenantId, incidentId, events, extra, options);
  } catch (err) {
    console.error("[chat] sync failed:", err);
  }
  try {
    await refreshAnnouncements(tenantId, incidentId);
  } catch (err) {
    console.error("[announcements] refresh failed:", err);
  }
  try {
    const incident = await withTenant(tenantId, (tx) => incidentPayload(tx, tenantId, incidentId));
    if (!incident) return;
    for (const event of events) await dispatchWebhookEvent(tenantId, event, { incident, ...extra });
  } catch (err) {
    console.error("[webhooks] after-change dispatch failed:", err);
  }
  // The knowledge layer learns the incident at declaration and at resolution — quietly.
  if (events.includes("incident.created") || events.includes("incident.resolved")) {
    const { indexIncidentForKnowledge } = await import("./ai-capabilities");
    await indexIncidentForKnowledge(tenantId, incidentId).catch((err) =>
      console.error("[ai] knowledge indexing failed:", err),
    );
  }
}

/**
 * The chat side of a change: a new incident gets its war-room link and, when
 * Slack is connected in "auto" mode, its channel; an update is posted in the
 * channel unless the author unticked it; a resolution closes the thread; the
 * pinned header follows status, severity and roles.
 */
async function syncChat(
  tenantId: string,
  incidentId: string,
  events: WebhookEvent[],
  extra: Record<string, unknown>,
  options: { chat?: boolean },
): Promise<void> {
  const tenant = await getTenantById(tenantId);
  if (!tenant) return;
  const origin = tenantOrigin(tenant.slug, tenant.customDomain);
  if (events.includes("incident.created")) {
    await withTenant(tenantId, async (tx) => {
      const bridge = await getBridgeTemplate(tx, tenantId);
      if (!bridge) return;
      const [inc] = await tx
        .select({ number: incidents.number, bridgeUrl: incidents.bridgeUrl, mode: incidents.mode })
        .from(incidents)
        .where(eq(incidents.id, incidentId));
      if (!inc || inc.bridgeUrl || inc.mode === "test") return;
      await tx
        .update(incidents)
        .set({ bridgeUrl: bridge.template.replace(/\{number\}/g, String(inc.number)) })
        .where(eq(incidents.id, incidentId));
    });
    const [inc] = await withTenant(tenantId, (tx) =>
      tx
        .select({ mode: incidents.mode, phase: incidents.phase })
        .from(incidents)
        .where(eq(incidents.id, incidentId)),
    );
    if (inc && inc.mode !== "test") await ensureIncidentChannels(tenantId, incidentId, origin);
  }
  if (events.includes("incident.update_published") && options.chat !== false) {
    await postIncidentUpdateAll(tenantId, incidentId, origin, {
      by: typeof extra.by === "string" ? extra.by : "—",
      message: typeof extra.message === "string" ? extra.message : "",
      resolved: events.includes("incident.resolved"),
    });
  }
  if (
    events.includes("follow_up.created") &&
    extra.follow_up &&
    typeof extra.follow_up === "object"
  ) {
    const fu = extra.follow_up as { title?: string };
    if (fu.title)
      await postIncidentNoteAll(
        tenantId,
        incidentId,
        `:white_check_mark: Follow-up created — ${fu.title}`,
      );
  }
  if (events.some((e) => e !== "follow_up.created"))
    await refreshIncidentHeaders(tenantId, incidentId, origin);
}
