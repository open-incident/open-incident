/**
 * Publishing from an incident: the public incident is created on first
 * publication (title, impact from the severity, components from the service),
 * every later update appends; resolution closes it and brings the components
 * back. Subscribers get one email per update, never for automatic transitions.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  catalogEntries,
  componentImpactHistory,
  incidentEvents,
  incidentStatuses,
  incidents,
  severities,
  statusPageComponents,
  statusPageIncidentUpdates,
  statusPageIncidents,
  statusPageSubscribers,
  statusPages,
  withTenant,
  type PublicImpact,
  type PublicStatus,
  type Tx,
} from "@openincident/db";
import { sendTenantEmail } from "@openincident/mail";
import { dispatchWebhookEvent } from "@openincident/webhooks";
import { refreshStatusSnapshot, statusPageUrl } from "./snapshot";
import { componentStateForImpact, impactForSeverityRank } from "./uptime";

export type PublishInput = {
  pageId: string;
  body: string;
  /** Public status; when omitted, mapped from the incident's internal status (resolved when the incident is). */
  status?: PublicStatus | null;
  title?: string | null;
  impact?: PublicImpact | null;
  componentIds?: string[] | null;
  actor: { memberId: string | null; name: string };
  now?: Date;
};

/** The page's incident linked to an internal incident, if any. */
export async function linkedPublicIncident(tx: Tx, tenantId: string, incidentId: string) {
  const [row] = await tx
    .select()
    .from(statusPageIncidents)
    .where(
      and(
        eq(statusPageIncidents.tenantId, tenantId),
        eq(statusPageIncidents.incidentId, incidentId),
      ),
    );
  return row ?? null;
}

/** Whether publication should be suggested: a page exists and the severity meets its threshold. */
export async function suggestedPage(tx: Tx, tenantId: string, severityRank: number | null) {
  const pages = await tx.select().from(statusPages).where(eq(statusPages.tenantId, tenantId));
  const page = pages[0] ?? null;
  if (!page) return null;
  const eligible = severityRank !== null && severityRank <= page.minSeverityRank;
  return { page, eligible };
}

export async function publishIncidentUpdate(
  tenantId: string,
  incidentId: string,
  input: PublishInput,
): Promise<{ publicIncidentId: string; created: boolean; notified: number } | null> {
  const now = input.now ?? new Date();
  const result = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({
        inc: incidents,
        statusPublic: incidentStatuses.publicStatus,
        sevRank: severities.rank,
        serviceId: incidents.serviceEntryId,
      })
      .from(incidents)
      .leftJoin(incidentStatuses, eq(incidentStatuses.id, incidents.statusId))
      .leftJoin(severities, eq(severities.id, incidents.severityId))
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, incidentId)));
    if (!row) return null;
    const [page] = await tx
      .select()
      .from(statusPages)
      .where(and(eq(statusPages.tenantId, tenantId), eq(statusPages.id, input.pageId)));
    if (!page) return null;
    const resolvedInternally = row.inc.phase === "post_incident" || row.inc.phase === "closed";
    const status: PublicStatus =
      input.status ??
      (resolvedInternally
        ? "resolved"
        : ((row.statusPublic as PublicStatus | null) ?? "investigating"));
    const impact: PublicImpact = input.impact ?? impactForSeverityRank(row.sevRank ?? null);
    let existing = await linkedPublicIncident(tx, tenantId, incidentId);
    let created = false;
    // Components: given, else the page's components bound to the incident's service.
    let componentIds = input.componentIds ?? existing?.componentIds ?? null;
    if (!componentIds) {
      const comps = row.serviceId
        ? await tx
            .select({ id: statusPageComponents.id })
            .from(statusPageComponents)
            .where(
              and(
                eq(statusPageComponents.pageId, page.id),
                eq(statusPageComponents.serviceEntryId, row.serviceId),
              ),
            )
        : [];
      componentIds = comps.map((c) => c.id);
    }
    if (!existing) {
      const [ins] = await tx
        .insert(statusPageIncidents)
        .values({
          tenantId,
          pageId: page.id,
          incidentId,
          title: input.title?.trim() || row.inc.name,
          status,
          impact,
          componentIds,
          startedAt: now,
          resolvedAt: status === "resolved" ? now : null,
        })
        .returning();
      existing = ins!;
      created = true;
    } else {
      await tx
        .update(statusPageIncidents)
        .set({
          status,
          impact: status === "resolved" ? existing.impact : impact,
          componentIds,
          title: input.title?.trim() || existing.title,
          resolvedAt: status === "resolved" ? (existing.resolvedAt ?? now) : null,
          updatedAt: now,
        })
        .where(eq(statusPageIncidents.id, existing.id));
    }
    const [upd] = await tx
      .insert(statusPageIncidentUpdates)
      .values({
        tenantId,
        statusPageIncidentId: existing.id,
        status,
        body: input.body.trim(),
        publishedAt: now,
        createdByMemberId: input.actor.memberId,
      })
      .returning({ id: statusPageIncidentUpdates.id });
    // Components follow the impact; resolution brings them back.
    const targetState = status === "resolved" ? "operational" : componentStateForImpact(impact);
    for (const cid of componentIds) {
      const [comp] = await tx
        .select()
        .from(statusPageComponents)
        .where(eq(statusPageComponents.id, cid));
      if (!comp || comp.state === targetState) continue;
      await tx
        .update(statusPageComponents)
        .set({ state: targetState })
        .where(eq(statusPageComponents.id, cid));
      await tx
        .update(componentImpactHistory)
        .set({ toAt: now })
        .where(
          and(eq(componentImpactHistory.componentId, cid), isNull(componentImpactHistory.toAt)),
        );
      if (targetState !== "operational")
        await tx.insert(componentImpactHistory).values({
          tenantId,
          componentId: cid,
          state: targetState,
          fromAt: now,
          statusPageIncidentId: existing.id,
        });
    }
    await tx.insert(incidentEvents).values({
      tenantId,
      incidentId,
      kind: "note",
      actorKind: input.actor.memberId ? "member" : "system",
      actorMemberId: input.actor.memberId,
      actorName: input.actor.name,
      payload: {
        system: "status_page_published",
        page: page.name,
        status,
        created,
        publicIncidentId: existing.id,
      },
      occurredAt: now,
    });
    // Subscribers: one email per update.
    const subs = await tx
      .select()
      .from(statusPageSubscribers)
      .where(and(eq(statusPageSubscribers.pageId, page.id)));
    const confirmed = subs.filter((s) => s.confirmedAt);
    const url = statusPageUrl(page);
    const [svcName] = row.serviceId
      ? await tx
          .select({ name: catalogEntries.name })
          .from(catalogEntries)
          .where(eq(catalogEntries.id, row.serviceId))
      : [];
    void svcName;
    let notified = 0;
    for (const s of confirmed) {
      const r = await sendTenantEmail({
        tenantId,
        to: s.email,
        subject: `[${page.name}] ${existing.title} — ${status}`,
        text: `${input.body.trim()}\n\n${url}\n\nUnsubscribe: ${url}/unsubscribe/${s.unsubscribeToken}`,
        kind: "other",
        ref: existing.id,
        headers: page.replyTo ? { "reply-to": page.replyTo } : undefined,
      }).catch(() => null);
      if (r && (r.queued || r.delivered)) notified++;
    }
    await tx
      .update(statusPageIncidentUpdates)
      .set({ notifiedCount: notified })
      .where(eq(statusPageIncidentUpdates.id, upd!.id));
    return { publicIncidentId: existing.id, created, notified, page };
  });
  if (!result) return null;
  await refreshStatusSnapshot(tenantId, result.page.id);
  await dispatchWebhookEvent(tenantId, "status_page.incident_published", {
    status_page: { id: result.page.id, name: result.page.name, url: statusPageUrl(result.page) },
    public_incident: { id: result.publicIncidentId, created: result.created },
  }).catch(() => {});
  return {
    publicIncidentId: result.publicIncidentId,
    created: result.created,
    notified: result.notified,
  };
}

/** Sets a component's state by hand (admin), closing or opening the history stretch. */
export async function setComponentState(
  tx: Tx,
  tenantId: string,
  componentId: string,
  state: "operational" | "degraded" | "partial_outage" | "major_outage" | "maintenance",
  now = new Date(),
  ref: { statusPageIncidentId?: string; maintenanceId?: string } = {},
): Promise<void> {
  const [comp] = await tx
    .select()
    .from(statusPageComponents)
    .where(
      and(eq(statusPageComponents.tenantId, tenantId), eq(statusPageComponents.id, componentId)),
    );
  if (!comp || comp.state === state) return;
  await tx
    .update(statusPageComponents)
    .set({ state })
    .where(eq(statusPageComponents.id, componentId));
  await tx
    .update(componentImpactHistory)
    .set({ toAt: now })
    .where(
      and(eq(componentImpactHistory.componentId, componentId), isNull(componentImpactHistory.toAt)),
    );
  if (state !== "operational")
    await tx.insert(componentImpactHistory).values({
      tenantId,
      componentId,
      state,
      fromAt: now,
      statusPageIncidentId: ref.statusPageIncidentId ?? null,
      maintenanceId: ref.maintenanceId ?? null,
    });
}

export { inArray };
