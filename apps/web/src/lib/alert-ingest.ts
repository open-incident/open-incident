/**
 * The alert pipeline: source → parse → attributes → dedup / group → route →
 * priority & urgency → incident → escalation. One function, called by the
 * ingest endpoint and by the "send a test alert" button — a test alert takes
 * the same road with `testMode`, which logs everything and pages nobody.
 */
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import {
  alertEvents,
  alertPriorities,
  alertRoutes,
  alertSources,
  alerts,
  catalogEntries,
  catalogTypes,
  incidentEvents,
  incidentTypes,
  incidents,
  severities,
  withTenant,
  type RouteFilter,
  type Tx,
} from "@openincident/db";
import {
  applyMappings,
  cancelEscalation,
  parsePayload,
  resolveDynamicPath,
  startEscalation,
  type ParsedAlert,
} from "@openincident/oncall";
import { dispatchWebhookEvent } from "@openincident/webhooks";
import {
  afterIncidentChange,
  coerceCustomFields,
  declareIncidentCore,
} from "@/lib/incident-writes";

const GROUP_WINDOW_MS = 5 * 60_000;

export type IngestOutcome = {
  alertId: string;
  action: "created" | "deduplicated" | "grouped" | "resolved" | "ignored";
  incidentNumber?: number | null;
};

type SourceRow = typeof alertSources.$inferSelect;

/** Whether a route's filters accept the attributes. "source" matches the source kind or name. */
export function routeMatches(filters: RouteFilter[], attributes: Record<string, string>): boolean {
  return filters.every((f) => {
    const v = attributes[f.attribute];
    switch (f.op) {
      case "exists":
        return Boolean(v);
      case "eq":
        return (v ?? "").toLowerCase() === (f.value ?? "").toLowerCase();
      case "neq":
        return (v ?? "").toLowerCase() !== (f.value ?? "").toLowerCase();
      case "in":
        return (f.value ?? "")
          .split(",")
          .map((x) => x.trim().toLowerCase())
          .includes((v ?? "").toLowerCase());
    }
  });
}

/** Canonicalises catalog-bound attributes and derives the owning team from the service. */
async function bindCatalog(
  tx: Tx,
  tenantId: string,
  source: SourceRow,
  attributes: Record<string, string>,
): Promise<Record<string, string>> {
  const out = { ...attributes };
  const bound = new Set(source.mappings.filter((m) => m.catalogTypeKey).map((m) => m.attribute));
  if (out.service) bound.add("service");
  for (const attr of bound) {
    const typeKey = source.mappings.find((m) => m.attribute === attr)?.catalogTypeKey ?? attr;
    const value = out[attr];
    if (!value) continue;
    const [type] = await tx
      .select({ id: catalogTypes.id })
      .from(catalogTypes)
      .where(and(eq(catalogTypes.tenantId, tenantId), eq(catalogTypes.key, typeKey)));
    if (!type) continue;
    const [entry] = await tx
      .select()
      .from(catalogEntries)
      .where(
        and(
          eq(catalogEntries.typeId, type.id),
          sql`lower(${catalogEntries.name}) = lower(${value})`,
        ),
      );
    if (!entry) continue;
    out[attr] = entry.name;
    out[`${attr}_id`] = entry.id;
    if (typeKey === "service" && typeof entry.attributes.owner === "string") {
      const [team] = await tx
        .select({ name: catalogEntries.name })
        .from(catalogEntries)
        .where(eq(catalogEntries.id, entry.attributes.owner));
      if (team) out.team = team.name;
    }
  }
  return out;
}

/** Ingests one raw payload for a source; a batch yields one outcome per alert. */
export async function ingestPayload(
  tenantId: string,
  source: SourceRow,
  rawPayload: unknown,
  opts: { test?: boolean; actorName?: string } = {},
): Promise<IngestOutcome[]> {
  const parsed = parsePayload(source.kind, rawPayload);
  const out: IngestOutcome[] = [];
  for (const p of parsed) out.push(await ingestOne(tenantId, source, p, opts));
  return out;
}

async function ingestOne(
  tenantId: string,
  source: SourceRow,
  parsed: ParsedAlert,
  opts: { test?: boolean; actorName?: string },
): Promise<IngestOutcome> {
  const now = new Date();
  const result = await withTenant(tenantId, async (tx) => {
    let attributes = applyMappings(parsed.attributes, parsed.payload, source.mappings);
    attributes = await bindCatalog(tx, tenantId, source, attributes);
    attributes.source = source.kind;
    attributes.source_name = source.name;
    await tx.update(alertSources).set({ lastAlertAt: now }).where(eq(alertSources.id, source.id));

    const [existing] = await tx
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.sourceId, source.id),
          eq(alerts.dedupKey, parsed.dedupKey),
          eq(alerts.status, "firing"),
        ),
      )
      .orderBy(desc(alerts.firstAt))
      .limit(1);

    // Resolution from the source.
    if (parsed.status === "resolved") {
      if (!existing) return { outcome: { alertId: "", action: "ignored" as const } };
      await tx
        .update(alerts)
        .set({ status: "resolved", resolvedAt: now, lastAt: now })
        .where(eq(alerts.id, existing.id));
      await tx.insert(alertEvents).values({
        tenantId,
        alertId: existing.id,
        kind: "resolved",
        actorKind: "system",
        payload: { by: "source", title: parsed.title },
        occurredAt: now,
      });
      if (existing.incidentId) {
        await tx.insert(incidentEvents).values({
          tenantId,
          incidentId: existing.incidentId,
          kind: "note",
          actorKind: "system",
          payload: { system: "alert_resolved", alertId: existing.id, title: existing.title },
          occurredAt: now,
        });
      }
      const [route] = existing.routeId
        ? await tx.select().from(alertRoutes).where(eq(alertRoutes.id, existing.routeId))
        : [];
      return {
        outcome: { alertId: existing.id, action: "resolved" as const },
        cancel: route?.resolveClosesEscalation !== false ? existing.escalationId : null,
        webhook: { event: "alert.resolved" as const, alertId: existing.id },
      };
    }

    // Deduplication: the same key firing again is one more occurrence.
    if (existing) {
      await tx
        .update(alerts)
        .set({ lastAt: now, groupCount: existing.groupCount + 1, payload: parsed.payload })
        .where(eq(alerts.id, existing.id));
      await tx.insert(alertEvents).values({
        tenantId,
        alertId: existing.id,
        kind: "grouped",
        actorKind: "system",
        payload: { reason: "dedup", title: parsed.title },
        occurredAt: now,
      });
      return { outcome: { alertId: existing.id, action: "deduplicated" as const } };
    }

    // Grouping: a similar alert of the same service, within the window, absorbs this one.
    const service = attributes.service ?? null;
    const [leader] = service
      ? await tx
          .select()
          .from(alerts)
          .where(
            and(
              eq(alerts.sourceId, source.id),
              eq(alerts.status, "firing"),
              isNull(alerts.groupId),
              gte(alerts.firstAt, new Date(now.getTime() - GROUP_WINDOW_MS)),
              sql`${alerts.attributes}->>'service' = ${service}`,
            ),
          )
          .orderBy(desc(alerts.firstAt))
          .limit(1)
      : [];

    // Route, priority, urgency.
    const routes = await tx
      .select()
      .from(alertRoutes)
      .where(and(eq(alertRoutes.tenantId, tenantId), eq(alertRoutes.active, true)))
      .orderBy(alertRoutes.position);
    const route = routes.find((r) => routeMatches(r.filters, attributes)) ?? null;
    const prios = await tx
      .select()
      .from(alertPriorities)
      .where(eq(alertPriorities.tenantId, tenantId));
    const priority =
      (attributes.priority
        ? prios.find((p) => p.name.toLowerCase() === attributes.priority!.toLowerCase())
        : null) ??
      (route?.priorityId ? prios.find((p) => p.id === route.priorityId) : null) ??
      null;
    if (priority) attributes.priority = priority.name;
    const urgency = route?.urgencyOverride ?? priority?.urgency ?? "high";
    const testMode = Boolean(opts.test) || Boolean(route?.testMode);

    const [row] = await tx
      .insert(alerts)
      .values({
        tenantId,
        sourceId: source.id,
        routeId: route?.id ?? null,
        dedupKey: parsed.dedupKey,
        status: "firing",
        title: parsed.title,
        description: parsed.description,
        payload: parsed.payload,
        attributes,
        priorityId: priority?.id ?? null,
        urgency,
        groupId: leader?.id ?? null,
        incidentId: leader?.incidentId ?? null,
        externalUrl: parsed.externalUrl,
        testMode,
        firstAt: now,
        lastAt: now,
      })
      .returning({ id: alerts.id });
    const alertId = row!.id;
    await tx.insert(alertEvents).values({
      tenantId,
      alertId,
      kind: "triggered",
      actorKind: opts.actorName ? "member" : "system",
      actorName: opts.actorName ?? null,
      payload: { source: source.name, priority: priority?.name ?? null, test: testMode },
      occurredAt: now,
    });
    if (route)
      await tx
        .update(alertRoutes)
        .set({ alertCount: route.alertCount + 1 })
        .where(eq(alertRoutes.id, route.id));

    if (leader) {
      await tx
        .update(alerts)
        .set({ groupCount: leader.groupCount + 1, lastAt: now })
        .where(eq(alerts.id, leader.id));
      await tx.insert(alertEvents).values({
        tenantId,
        alertId: leader.id,
        kind: "grouped",
        actorKind: "system",
        payload: { reason: "window", title: parsed.title, alertId },
        occurredAt: now,
      });
      await tx.insert(alertEvents).values({
        tenantId,
        alertId,
        kind: "grouped",
        actorKind: "system",
        payload: { reason: "window", leaderId: leader.id, leaderTitle: leader.title },
        occurredAt: now,
      });
      return {
        outcome: { alertId, action: "grouped" as const },
        webhook: { event: "alert.created" as const, alertId },
      };
    }

    if (!route) {
      await tx.insert(alertEvents).values({
        tenantId,
        alertId,
        kind: "routed",
        actorKind: "system",
        payload: { route: null },
        occurredAt: now,
      });
      return {
        outcome: { alertId, action: "created" as const },
        webhook: { event: "alert.created" as const, alertId },
      };
    }
    if (testMode) {
      await tx.insert(alertEvents).values({
        tenantId,
        alertId,
        kind: "test_mode",
        actorKind: "system",
        payload: { route: route.name },
        occurredAt: now,
      });
    }

    // Escalation target — resolved now, started after the commit.
    let pathId: string | null = null;
    let via: string | null = null;
    if (route.escalationMode === "static") pathId = route.escalationPathId;
    if (route.escalationMode === "dynamic") {
      const dyn = await resolveDynamicPath(tx, tenantId, attributes.service);
      pathId = dyn?.pathId ?? route.escalationPathId;
      via = dyn?.via ?? null;
    }
    await tx.insert(alertEvents).values({
      tenantId,
      alertId,
      kind: "routed",
      actorKind: "system",
      payload: {
        route: route.name,
        escalation: route.escalationMode,
        via,
        incident: route.incidentMode,
        urgency,
      },
      occurredAt: now,
    });

    // Incident: always → active; conditional → triage when the urgency is high.
    let incidentNumber: number | null = null;
    let incidentId: string | null = null;
    const wantsIncident =
      !testMode &&
      (route.incidentMode === "always" ||
        (route.incidentMode === "conditional" && urgency === "high"));
    if (wantsIncident) {
      const [type] = route.incidentTypeId
        ? await tx.select().from(incidentTypes).where(eq(incidentTypes.id, route.incidentTypeId))
        : await tx
            .select()
            .from(incidentTypes)
            .where(and(eq(incidentTypes.tenantId, tenantId), eq(incidentTypes.isDefault, true)));
      if (type) {
        const sevs = await tx
          .select()
          .from(severities)
          .where(eq(severities.tenantId, tenantId))
          .orderBy(severities.rank);
        const sev = priority
          ? (sevs.find((s) => s.rank === priority.rank) ?? sevs[sevs.length - 1])
          : null;
        const custom: Record<string, unknown> = {};
        if (attributes.region) custom.region = attributes.region;
        const created = await declareIncidentCore(
          tx,
          tenantId,
          { kind: "system", memberId: null, name: source.name },
          {
            name: parsed.title,
            summary: parsed.description ?? undefined,
            mode: "live",
            typeId: type.id,
            severityId: route.incidentMode === "always" ? (sev?.id ?? null) : null,
            serviceEntryId: attributes.service_id ?? null,
            customFields: await coerceCustomFields(tx, tenantId, custom),
            source: "alert",
            phase: route.incidentMode === "always" ? "active" : "triage",
            alertRef: { id: alertId, source: source.name, title: parsed.title },
          },
        );
        incidentId = created.id;
        incidentNumber = created.number;
        await tx.update(alerts).set({ incidentId }).where(eq(alerts.id, alertId));
        await tx.insert(alertEvents).values({
          tenantId,
          alertId,
          kind: "incident_created",
          actorKind: "system",
          payload: {
            number: created.number,
            phase: route.incidentMode === "always" ? "active" : "triage",
          },
          occurredAt: now,
        });
      }
    }
    return {
      outcome: { alertId, action: "created" as const, incidentNumber },
      incidentId,
      escalation:
        !testMode && route.escalationMode !== "none" && pathId
          ? {
              pathId,
              deferMinutes: route.deferMinutes,
              urgency,
              priorityRank: priority?.rank ?? null,
              alertId,
              incidentId,
            }
          : null,
      webhook: { event: "alert.created" as const, alertId },
      deferredMinutes: route.deferMinutes,
    };
  });

  // After the commit: escalation, webhooks, announcements.
  if ("cancel" in result && result.cancel)
    await cancelEscalation(tenantId, result.cancel, "alert_resolved").catch(() => {});
  if ("escalation" in result && result.escalation) {
    const e = result.escalation;
    const started = await startEscalation(tenantId, {
      pathId: e.pathId,
      alertId: e.alertId,
      incidentId: e.incidentId,
      urgency: e.urgency,
      priorityRank: e.priorityRank,
      deferMinutes: e.deferMinutes,
      triggeredBy: { kind: "system", name: source.name },
    }).catch((err: unknown) => {
      console.error("[alerts] escalation start failed", err);
      return null;
    });
    if (!started) {
      await withTenant(tenantId, (tx) =>
        tx.insert(alertEvents).values({
          tenantId,
          alertId: e.alertId,
          kind: "routed",
          actorKind: "system",
          payload: { warning: "path_unpublished", pathId: e.pathId },
          occurredAt: new Date(),
        }),
      ).catch(() => {});
    } else if (e.deferMinutes > 0) {
      await withTenant(tenantId, (tx) =>
        tx.insert(alertEvents).values({
          tenantId,
          alertId: e.alertId,
          kind: "deferred",
          actorKind: "system",
          payload: { minutes: e.deferMinutes },
          occurredAt: new Date(),
        }),
      ).catch(() => {});
    }
  }
  if ("incidentId" in result && result.incidentId)
    await afterIncidentChange(tenantId, result.incidentId, ["incident.created"]);
  if ("webhook" in result && result.webhook) {
    const payload = await withTenant(tenantId, (tx) =>
      alertPayload(tx, tenantId, result.webhook!.alertId),
    ).catch(() => null);
    if (payload)
      await dispatchWebhookEvent(tenantId, result.webhook.event, { alert: payload }).catch(
        () => {},
      );
  }
  return result.outcome;
}

/** The alert as webhooks and the API describe it. */
export async function alertPayload(tx: Tx, tenantId: string, alertId: string) {
  const [a] = await tx
    .select()
    .from(alerts)
    .where(and(eq(alerts.tenantId, tenantId), eq(alerts.id, alertId)));
  if (!a) return null;
  const [src] = await tx
    .select({ name: alertSources.name, kind: alertSources.kind })
    .from(alertSources)
    .where(eq(alertSources.id, a.sourceId));
  const [inc] = a.incidentId
    ? await tx
        .select({ number: incidents.number })
        .from(incidents)
        .where(eq(incidents.id, a.incidentId))
    : [];
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    status: a.status,
    source: src ? { name: src.name, kind: src.kind } : null,
    priority: a.attributes.priority ?? null,
    urgency: a.urgency,
    attributes: a.attributes,
    dedup_key: a.dedupKey,
    group_count: a.groupCount,
    incident_reference: inc ? `INC-${inc.number}` : null,
    external_url: a.externalUrl,
    test_mode: a.testMode,
    first_at: a.firstAt.toISOString(),
    last_at: a.lastAt.toISOString(),
    resolved_at: a.resolvedAt?.toISOString() ?? null,
    acked_at: a.ackedAt?.toISOString() ?? null,
  };
}
