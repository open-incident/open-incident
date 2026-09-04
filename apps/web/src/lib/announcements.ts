/**
 * Announcements V1 — the wired automation: rules (severity, type) pick a
 * template and an audience; the resulting post is LIVING — one row per
 * incident and rule, rewritten in place at every change, closed with the
 * incident. In-app audience today; chat channels arrive with the adapter.
 */
import { syncAnnouncementAll } from "@openincident/chat";
import { tenantOrigin } from "@openincident/oncall";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  announcementRules,
  announcementTemplates,
  announcements,
  catalogEntries,
  incidentEvents,
  incidentStatuses,
  incidents,
  severities,
  withTenant,
  type Tx,
  getTenantById,
} from "@openincident/db";

export const TEMPLATE_VARIABLES = [
  "severity",
  "title",
  "status",
  "next_update",
  "number",
  "service",
] as const;

export function renderTemplate(
  body: string,
  vars: Record<(typeof TEMPLATE_VARIABLES)[number], string>,
): string {
  return body.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in vars ? vars[key as keyof typeof vars] : whole,
  );
}

/** Re-evaluates the rules for one incident and rewrites its living posts. */
export async function refreshAnnouncements(tenantId: string, incidentId: string): Promise<void> {
  const touched: string[] = [];
  await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({
        inc: incidents,
        sevName: severities.name,
        sevRank: severities.rank,
        statusName: incidentStatuses.name,
        serviceName: catalogEntries.name,
      })
      .from(incidents)
      .leftJoin(severities, eq(severities.id, incidents.severityId))
      .leftJoin(incidentStatuses, eq(incidentStatuses.id, incidents.statusId))
      .leftJoin(catalogEntries, eq(catalogEntries.id, incidents.serviceEntryId))
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, incidentId)));
    if (!row) return;
    const inc = row.inc;

    // Only an active incident announces; once resolved (post-incident or
    // closed) its posts close, and a triaged alert has nothing to say yet.
    if (inc.phase === "post_incident" || inc.phase === "closed") {
      const closed = await tx
        .update(announcements)
        .set({ status: "closed", updatedAt: new Date() })
        .where(and(eq(announcements.incidentId, inc.id), eq(announcements.status, "live")))
        .returning({ id: announcements.id });
      touched.push(...closed.map((c) => c.id));
      return;
    }
    // Test incidents never announce anything: nobody wants a drill on the feed.
    if (inc.mode === "test" || inc.phase === "triage") return;

    const rules = await tx
      .select({ rule: announcementRules, template: announcementTemplates })
      .from(announcementRules)
      .innerJoin(announcementTemplates, eq(announcementTemplates.id, announcementRules.templateId))
      .where(and(eq(announcementRules.tenantId, tenantId), eq(announcementRules.active, true)))
      .orderBy(asc(announcementRules.createdAt));
    const vars = {
      severity: row.sevName ?? "—",
      title: inc.name,
      status: inc.phase === "active" ? (row.statusName ?? "—") : inc.phase,
      next_update: inc.nextUpdateDueAt ? inc.nextUpdateDueAt.toISOString() : "—",
      number: `INC-${inc.number}`,
      service: row.serviceName ?? "—",
    };
    for (const { rule, template } of rules) {
      const sevOk =
        rule.minSeverityRank === null ||
        (row.sevRank !== null && row.sevRank <= rule.minSeverityRank);
      const typeOk = rule.typeId === null || rule.typeId === inc.typeId;
      if (!sevOk || !typeOk) continue;
      const body = renderTemplate(template.body, vars);
      const [existing] = await tx
        .select({ id: announcements.id })
        .from(announcements)
        .where(and(eq(announcements.incidentId, inc.id), eq(announcements.ruleId, rule.id)));
      if (existing) {
        await tx
          .update(announcements)
          .set({ body, status: "live", updatedAt: new Date() })
          .where(eq(announcements.id, existing.id));
        touched.push(existing.id);
      } else {
        const [created] = await tx
          .insert(announcements)
          .values({
            tenantId,
            incidentId: inc.id,
            ruleId: rule.id,
            templateId: template.id,
            audience: rule.audience,
            body,
            status: "live",
          })
          .returning({ id: announcements.id });
        if (created) touched.push(created.id);
        await tx
          .update(announcementRules)
          .set({
            triggeredCount: rule.triggeredCount + 1,
            lastIncidentId: inc.id,
            updatedAt: new Date(),
          })
          .where(eq(announcementRules.id, rule.id));
        await tx.insert(incidentEvents).values({
          tenantId,
          incidentId: inc.id,
          kind: "announcement_published",
          actorKind: "system",
          payload: { rule: rule.name, template: template.name, audience: rule.audience },
        });
      }
    }
  });
  // The living post also lives in the announcement channel, when Slack is connected.
  if (touched.length > 0) {
    const tenant = await getTenantById(tenantId);
    if (tenant) {
      const origin = tenantOrigin(tenant.slug, tenant.customDomain);
      for (const id of touched) {
        await syncAnnouncementAll(tenantId, id, origin).catch((err) =>
          console.error("[chat] announcement sync failed:", err),
        );
      }
    }
  }
}

export type LiveAnnouncement = {
  id: string;
  body: string;
  incidentNumber: number;
  incidentName: string;
  severity: string | null;
  updatedAt: Date;
};

/** The living posts addressed to the whole workspace, for the feed above the incidents. */
export async function liveAnnouncements(
  tx: Tx,
  tenantId: string,
  limit = 3,
): Promise<LiveAnnouncement[]> {
  const rows = await tx
    .select({
      id: announcements.id,
      body: announcements.body,
      updatedAt: announcements.updatedAt,
      number: incidents.number,
      name: incidents.name,
      severity: severities.name,
    })
    .from(announcements)
    .innerJoin(incidents, eq(incidents.id, announcements.incidentId))
    .leftJoin(severities, eq(severities.id, incidents.severityId))
    .where(
      and(
        eq(announcements.tenantId, tenantId),
        eq(announcements.status, "live"),
        inArray(announcements.audience, ["workspace"]),
      ),
    )
    .orderBy(asc(severities.rank), asc(announcements.updatedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    incidentNumber: r.number,
    incidentName: r.name,
    severity: r.severity,
    updatedAt: r.updatedAt,
  }));
}
