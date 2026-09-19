/**
 * The alert pipeline: source → parse → attributes → filter → priority → route →
 * grouping → incident → escalation → channel. Two halves: `planAlert` decides,
 * reading only; `ingestOne` applies the plan. The "what would happen to this
 * payload" preview runs the first half alone, so it tells the truth about the
 * second. A test alert takes the same road with `testMode`, which logs
 * everything and pages nobody.
 */
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import {
  alertAttributes,
  alertEvents,
  alertPriorities,
  alertRoutes,
  alertSources,
  alerts,
  escalationPaths,
  incidentEvents,
  incidentTypes,
  incidents,
  services,
  severities,
  teams,
  withTenant,
  type EscalationRule,
  type GroupingRule,
  type IncidentTemplate,
  type RouteFilter,
  type Tx,
} from "@openincident/db";
import {
  applyMappingsWith,
  cancelEscalation,
  conditionsHold,
  groupingKey,
  legacyFiltersAsConditions,
  mergeAttributes,
  parsePayload,
  priorityByLabel,
  resolveAttributePath,
  startEscalation,
  valueAt,
  type ConditionContext,
  type ParsedAlert,
} from "@openincident/oncall";
import { postAlertToChannel } from "@openincident/chat";
import { getTenantById } from "@openincident/db";
import { tenantOrigin } from "@openincident/oncall";
import { dispatchWebhookEvent } from "@openincident/webhooks";
import {
  afterIncidentChange,
  coerceCustomFields,
  declareIncidentCore,
} from "@/lib/incident-writes";
import { observeService } from "./services";

export type IngestOutcome = {
  alertId: string;
  action: "created" | "deduplicated" | "grouped" | "resolved" | "ignored" | "filtered";
  incidentNumber?: number | null;
};

type SourceRow = typeof alertSources.$inferSelect;
type RouteRow = typeof alertRoutes.$inferSelect;
type PriorityRow = typeof alertPriorities.$inferSelect;
type AttributeDef = typeof alertAttributes.$inferSelect;

/** Kept for callers of the legacy shape; routes now carry `conditions`. */
export function routeMatches(filters: RouteFilter[], attributes: Record<string, string>): boolean {
  return conditionsHold(legacyFiltersAsConditions(filters), {
    attributes,
    source: { kind: attributes.source ?? "", name: attributes.source_name ?? "", id: "" },
    priority: attributes.priority ?? null,
    title: "",
  });
}

/* ---------- The plan ---------- */

export type EscalationDecision = {
  rule: EscalationRule;
  pathId: string | null;
  pathName: string | null;
  via: string | null;
  skipped: "condition" | "unresolved" | "unpublished" | null;
};

export type AlertPlan = {
  parsed: ParsedAlert;
  attributes: Record<string, string>;
  /** Dropped by the source's own filter: nothing is stored. */
  filtered: boolean;
  priority: PriorityRow | null;
  urgency: "high" | "low";
  route: RouteRow | null;
  routeConditions: ReturnType<typeof legacyFiltersAsConditions>;
  testMode: boolean;
  escalations: EscalationDecision[];
  incident: {
    template: IncidentTemplate | null;
    wants: boolean;
    typeId: string | null;
    typeName: string | null;
    severityId: string | null;
    severityName: string | null;
  };
  grouping: {
    rule: GroupingRule | null;
    key: string | null;
    leader: {
      id: string;
      title: string;
      priorityRank: number | null;
      incidentId: string | null;
    } | null;
  };
  registry: AttributeDef[];
  priorities: PriorityRow[];
  /** Required attributes this alert does not carry. */
  missingRequired: string[];
};

/** What a legacy route meant, expressed in today's rules. */
function legacyEscalations(route: RouteRow): EscalationRule[] {
  if (route.escalationMode === "static")
    return route.escalationPathId ? [{ kind: "path", pathId: route.escalationPathId }] : [];
  if (route.escalationMode === "dynamic")
    return [{ kind: "attribute", attribute: "service", fallbackPathId: route.escalationPathId }];
  return [];
}

function legacyIncident(route: RouteRow): IncidentTemplate {
  const always = route.incidentMode === "always";
  return {
    mode: route.incidentMode,
    typeId: route.incidentTypeId,
    startPhase: always ? "active" : "triage",
    severity: always ? { mode: "priority" } : { mode: "none" },
    visibility: "public",
    customFields: { region: "region" },
    declineOnResolve: false,
  };
}

const LEGACY_GROUPING: GroupingRule = {
  enabled: true,
  by: ["service"],
  windowMinutes: 5,
  extending: false,
  escalate: "never",
  graceMinutes: 0,
};

/**
 * The attributes that name something the product owns, canonicalised against
 * it: a service against `app.services`, a team against `app.teams`. A signal
 * that writes "Checkout API" and one that writes "checkout-api" then group and
 * route as the same service.
 *
 * When the alert names a service and not a team, the service's owner team is
 * filled in — that is what lets a rule page "the owner" without anyone writing
 * the team on every payload.
 */
async function bindRegistry(
  tx: Tx,
  tenantId: string,
  registry: AttributeDef[],
  prios: PriorityRow[],
  attributes: Record<string, string>,
): Promise<Record<string, string>> {
  const out = { ...attributes };

  if (out.service) {
    const [svc] = await tx
      .select({ id: services.id, key: services.key, ownerTeamId: services.ownerTeamId })
      .from(services)
      .where(
        and(eq(services.tenantId, tenantId), sql`lower(${services.key}) = lower(${out.service})`),
      );
    if (svc) {
      out.service = svc.key;
      out.service_id = svc.id;
      if (!out.team && svc.ownerTeamId) {
        const [team] = await tx
          .select({ id: teams.id, name: teams.name })
          .from(teams)
          .where(and(eq(teams.tenantId, tenantId), eq(teams.id, svc.ownerTeamId)));
        if (team) {
          out.team = team.name;
          out.team_id = team.id;
        }
      }
    }
  }

  if (out.team && !out.team_id) {
    const [team] = await tx
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(and(eq(teams.tenantId, tenantId), sql`lower(${teams.name}) = lower(${out.team})`));
    if (team) {
      out.team = team.name;
      out.team_id = team.id;
    }
  }

  for (const def of registry.filter((d) => d.type === "priority")) {
    const p = priorityByLabel(prios, out[def.key]);
    if (p) out[def.key] = p.name;
  }
  return out;
}

/** The source's priority rule, then the payload's own label, then nothing yet. */
function priorityFromSource(
  source: SourceRow,
  prios: PriorityRow[],
  parsed: ParsedAlert,
  attributes: Record<string, string>,
): PriorityRow | null {
  const rule = source.priorityRule;
  if (rule?.mode === "static") return prios.find((p) => p.id === rule.priorityId) ?? null;
  if (rule?.mode === "field") {
    const raw = valueAt(parsed.payload, rule.path);
    if (raw) {
      const mapped = rule.map[raw.toLowerCase()];
      const byMap = mapped ? prios.find((p) => p.id === mapped) : null;
      const found = byMap ?? priorityByLabel(prios, raw);
      if (found) return found;
    }
    if (rule.fallbackPriorityId) return prios.find((p) => p.id === rule.fallbackPriorityId) ?? null;
  }
  return priorityByLabel(prios, attributes.priority);
}

/** Everything the pipeline decides about one parsed alert, without writing a row. */
export async function planAlert(
  tx: Tx,
  tenantId: string,
  source: SourceRow,
  parsed: ParsedAlert,
  opts: { test?: boolean; now?: Date } = {},
): Promise<AlertPlan> {
  const now = opts.now ?? new Date();
  const registry = await tx
    .select()
    .from(alertAttributes)
    .where(eq(alertAttributes.tenantId, tenantId))
    .orderBy(alertAttributes.position);
  const prios = await tx
    .select()
    .from(alertPriorities)
    .where(eq(alertPriorities.tenantId, tenantId))
    .orderBy(alertPriorities.rank);

  let attributes = applyMappingsWith(parsed.attributes, parsed.payload, source.mappings);
  attributes = await bindRegistry(tx, tenantId, registry, prios, attributes);
  attributes.source = source.kind;
  attributes.source_name = source.name;

  let priority = priorityFromSource(source, prios, parsed, attributes);
  const ctx: ConditionContext = {
    attributes,
    source: { kind: source.kind, name: source.name, id: source.id },
    priority: priority?.name ?? null,
    title: parsed.title,
  };
  const filtered = parsed.status === "firing" && !conditionsHold(source.filter ?? [], ctx);

  const routes = await tx
    .select()
    .from(alertRoutes)
    .where(and(eq(alertRoutes.tenantId, tenantId), eq(alertRoutes.active, true)))
    .orderBy(alertRoutes.position, alertRoutes.createdAt);
  const conditionsOf = (r: RouteRow) =>
    r.conditions.length > 0 ? r.conditions : legacyFiltersAsConditions(r.filters);
  const route =
    routes.find(
      (r) =>
        (r.sourceIds.length === 0 || r.sourceIds.includes(source.id)) &&
        conditionsHold(conditionsOf(r), ctx),
    ) ?? null;

  priority =
    priority ??
    (route?.priorityId ? (prios.find((p) => p.id === route.priorityId) ?? null) : null) ??
    prios.find((p) => p.isDefault) ??
    null;
  if (priority) attributes.priority = priority.name;
  ctx.priority = priority?.name ?? null;
  const urgency = route?.urgencyOverride ?? priority?.urgency ?? "high";
  const testMode = Boolean(opts.test) || Boolean(route?.testMode);

  // Escalation rules, each resolved to a path — or to the reason it did not.
  const escalations: EscalationDecision[] = [];
  if (route) {
    const rules = route.escalations.length > 0 ? route.escalations : legacyEscalations(route);
    for (const rule of rules) {
      if (rule.when && rule.when.length > 0 && !conditionsHold(rule.when, ctx)) {
        escalations.push({ rule, pathId: null, pathName: null, via: null, skipped: "condition" });
        continue;
      }
      let pathId: string | null = null;
      let via: string | null = null;
      if (rule.kind === "path") pathId = rule.pathId;
      else {
        const dyn = await resolveAttributePath(
          tx,
          tenantId,
          rule.attribute,
          attributes[rule.attribute],
        );
        pathId = dyn?.pathId ?? rule.fallbackPathId;
        via = dyn?.via ?? (pathId ? "fallback" : null);
      }
      if (!pathId) {
        escalations.push({ rule, pathId: null, pathName: null, via, skipped: "unresolved" });
        continue;
      }
      const [path] = await tx
        .select({ name: escalationPaths.name, current: escalationPaths.currentVersionId })
        .from(escalationPaths)
        .where(and(eq(escalationPaths.tenantId, tenantId), eq(escalationPaths.id, pathId)));
      escalations.push({
        rule,
        pathId: path ? pathId : null,
        pathName: path?.name ?? null,
        via,
        skipped: !path ? "unresolved" : path.current ? null : "unpublished",
      });
    }
  }

  // The incident the route would open.
  const template = route ? (route.incident ?? legacyIncident(route)) : null;
  let typeId: string | null = null;
  let typeName: string | null = null;
  let severityId: string | null = null;
  let severityName: string | null = null;
  const wants =
    Boolean(template) &&
    !testMode &&
    (template!.mode === "always" || (template!.mode === "conditional" && urgency === "high"));
  if (template && template.mode !== "never") {
    const [type] = template.typeId
      ? await tx.select().from(incidentTypes).where(eq(incidentTypes.id, template.typeId))
      : await tx
          .select()
          .from(incidentTypes)
          .where(and(eq(incidentTypes.tenantId, tenantId), eq(incidentTypes.isDefault, true)));
    typeId = type?.id ?? null;
    typeName = type?.name ?? null;
    if (template.severity.mode !== "none") {
      const sevs = await tx
        .select()
        .from(severities)
        .where(eq(severities.tenantId, tenantId))
        .orderBy(severities.rank);
      const sev =
        template.severity.mode === "static"
          ? sevs.find(
              (s) => s.id === (template.severity as { severityId: string | null }).severityId,
            )
          : priority
            ? (sevs.find((s) => s.rank === priority.rank) ?? sevs[sevs.length - 1])
            : undefined;
      severityId = sev?.id ?? null;
      severityName = sev?.name ?? null;
    }
  }

  // Grouping: the route's rule; legacy routes group by service within five minutes.
  // A test alert never joins a group nor leads one: it must show what a real
  // alert would do on its own, and a real alert grouped under a test one would
  // never page.
  let groupingRule: GroupingRule | null = null;
  let key: string | null = null;
  let leader: AlertPlan["grouping"]["leader"] = null;
  if (route && parsed.status === "firing") {
    groupingRule = route.grouping ?? (attributes.service ? LEGACY_GROUPING : null);
    if (groupingRule?.enabled && !testMode) {
      key = groupingKey(groupingRule, attributes);
      const since = new Date(now.getTime() - groupingRule.windowMinutes * 60_000);
      const [row] = await tx
        .select({
          id: alerts.id,
          title: alerts.title,
          incidentId: alerts.incidentId,
          priorityRank: alertPriorities.rank,
        })
        .from(alerts)
        .leftJoin(alertPriorities, eq(alertPriorities.id, alerts.priorityId))
        .where(
          and(
            eq(alerts.routeId, route.id),
            eq(alerts.status, "firing"),
            eq(alerts.testMode, false),
            isNull(alerts.groupId),
            eq(alerts.groupKey, key),
            groupingRule.extending ? gte(alerts.lastAt, since) : gte(alerts.firstAt, since),
          ),
        )
        .orderBy(desc(alerts.firstAt))
        .limit(1);
      leader = row ?? null;
    }
  }

  const missingRequired = registry
    .filter((d) => d.required && !attributes[d.key])
    .map((d) => d.key);

  return {
    parsed,
    attributes,
    filtered,
    priority,
    urgency,
    route,
    routeConditions: route ? conditionsOf(route) : [],
    testMode,
    escalations,
    incident: { template, wants, typeId, typeName, severityId, severityName },
    grouping: { rule: groupingRule, key, leader },
    registry,
    priorities: prios,
    missingRequired,
  };
}

/** The preview: one plan per alert the payload holds, nothing written. */
export async function simulateIngest(
  tenantId: string,
  source: SourceRow,
  rawPayload: unknown,
): Promise<AlertPlan[]> {
  const parsed = parsePayload(source.kind, rawPayload);
  return withTenant(tenantId, async (tx) => {
    const out: AlertPlan[] = [];
    for (const p of parsed) out.push(await planAlert(tx, tenantId, source, p));
    return out;
  });
}

/* ---------- Applying it ---------- */

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

type Escalate = {
  pathId: string;
  deferMinutes: number;
  urgency: "high" | "low";
  priorityRank: number | null;
  alertId: string;
  incidentId: string | null;
};

async function event(
  tx: Tx,
  tenantId: string,
  alertId: string,
  kind: (typeof alertEvents.$inferInsert)["kind"],
  payload: Record<string, unknown>,
  now: Date,
  actorName: string | null = null,
) {
  await tx.insert(alertEvents).values({
    tenantId,
    alertId,
    kind,
    actorKind: actorName ? "member" : "system",
    actorName,
    payload,
    occurredAt: now,
  });
}

/** A triage incident opened by an alert that has just resolved is declined, in the system's name. */
async function declineTriageIncident(
  tx: Tx,
  tenantId: string,
  incidentId: string,
  reason: string,
  now: Date,
): Promise<boolean> {
  const [inc] = await tx
    .select({ id: incidents.id, phase: incidents.phase })
    .from(incidents)
    .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, incidentId)));
  if (!inc || inc.phase !== "triage") return false;
  await tx
    .update(incidents)
    .set({ phase: "closed", closedAt: now, lastActivityAt: now, updatedAt: now })
    .where(eq(incidents.id, inc.id));
  await tx.insert(incidentEvents).values({
    tenantId,
    incidentId: inc.id,
    kind: "declined",
    actorKind: "system",
    payload: { reason, system: "alert_resolved" },
    occurredAt: now,
  });
  return true;
}

async function ingestOne(
  tenantId: string,
  source: SourceRow,
  parsed: ParsedAlert,
  opts: { test?: boolean; actorName?: string },
): Promise<IngestOutcome> {
  const now = new Date();
  const result = await withTenant(tenantId, async (tx) => {
    const plan = await planAlert(tx, tenantId, source, parsed, { test: opts.test, now });
    const { attributes, priority, urgency, route, testMode } = plan;
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

    // Resolution from the source — never filtered, so nothing stays firing forever.
    if (parsed.status === "resolved") {
      if (!existing) return { outcome: { alertId: "", action: "ignored" as const } };
      await tx
        .update(alerts)
        .set({ status: "resolved", resolvedAt: now, lastAt: now })
        .where(eq(alerts.id, existing.id));
      await event(
        tx,
        tenantId,
        existing.id,
        "resolved",
        { by: "source", title: parsed.title },
        now,
      );
      const [existingRoute] = existing.routeId
        ? await tx.select().from(alertRoutes).where(eq(alertRoutes.id, existing.routeId))
        : [];
      let declined = false;
      if (existing.incidentId) {
        await tx.insert(incidentEvents).values({
          tenantId,
          incidentId: existing.incidentId,
          kind: "note",
          actorKind: "system",
          payload: { system: "alert_resolved", alertId: existing.id, title: existing.title },
          occurredAt: now,
        });
        const template = existingRoute
          ? (existingRoute.incident ?? legacyIncident(existingRoute))
          : null;
        if (template?.declineOnResolve)
          declined = await declineTriageIncident(
            tx,
            tenantId,
            existing.incidentId,
            `alert resolved: ${existing.title}`,
            now,
          );
      }
      return {
        outcome: { alertId: existing.id, action: "resolved" as const },
        cancel: existingRoute?.resolveClosesEscalation !== false ? existing.escalationId : null,
        declinedIncidentId: declined ? existing.incidentId : null,
        webhook: { event: "alert.resolved" as const, alertId: existing.id },
        notify:
          existingRoute?.notify?.slackChannelId && !existing.testMode
            ? { channelId: existingRoute.notify.slackChannelId, alertId: existing.id }
            : null,
      };
    }

    // The source's own filter drops what it does not want — before anything is stored.
    if (plan.filtered) return { outcome: { alertId: "", action: "filtered" as const } };

    // Deduplication: the same key firing again is one more occurrence, merged per attribute.
    if (existing) {
      // Locked once it paged or opened an incident: the record keeps the state action was taken on.
      const locked = Boolean(existing.escalationId || existing.incidentId);
      const rankOf = (v: string) => priorityByLabel(plan.priorities, v)?.rank ?? null;
      const merged = locked
        ? existing.attributes
        : mergeAttributes(existing.attributes, attributes, plan.registry, rankOf);
      const previousRank = plan.priorities.find((p) => p.id === existing.priorityId)?.rank ?? null;
      const nextPriority =
        !locked && priority && (previousRank === null || previousRank > priority.rank)
          ? priority
          : null;
      await tx
        .update(alerts)
        .set({
          lastAt: now,
          groupCount: existing.groupCount + 1,
          payload: parsed.payload,
          attributes: merged,
          ...(nextPriority ? { priorityId: nextPriority.id, urgency: nextPriority.urgency } : {}),
        })
        .where(eq(alerts.id, existing.id));
      await event(
        tx,
        tenantId,
        existing.id,
        "grouped",
        { reason: "dedup", title: parsed.title },
        now,
      );
      return { outcome: { alertId: existing.id, action: "deduplicated" as const } };
    }

    const leader = plan.grouping.leader;
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
        groupKey: plan.grouping.key,
        incidentId: leader?.incidentId ?? null,
        externalUrl: parsed.externalUrl,
        testMode,
        firstAt: now,
        lastAt: now,
      })
      .returning({ id: alerts.id });
    const alertId = row!.id;
    // The service learns it exists here: the first alert naming it is enough,
    // and nobody had to describe it anywhere first.
    if (attributes.service) {
      await observeService(tx, tenantId, attributes.service, source.name, now);
    }
    await event(
      tx,
      tenantId,
      alertId,
      "triggered",
      {
        source: source.name,
        priority: priority?.name ?? null,
        test: testMode,
        missing: plan.missingRequired.length ? plan.missingRequired : undefined,
      },
      now,
      opts.actorName ?? null,
    );
    if (route)
      await tx
        .update(alertRoutes)
        .set({ alertCount: route.alertCount + 1 })
        .where(eq(alertRoutes.id, route.id));

    const pathIds = [
      ...new Set(plan.escalations.filter((e) => e.pathId && !e.skipped).map((e) => e.pathId!)),
    ];
    const escalate = (incidentId: string | null, extraDefer = 0): Escalate[] =>
      testMode
        ? []
        : pathIds.map((pathId) => ({
            pathId,
            deferMinutes: (route?.deferMinutes ?? 0) + extraDefer,
            urgency,
            priorityRank: priority?.rank ?? null,
            alertId,
            incidentId,
          }));

    // Grouped under a leader: joins it; pages again only if the route says so.
    if (leader && route) {
      await tx
        .update(alerts)
        .set({ groupCount: sql`${alerts.groupCount} + 1`, lastAt: now })
        .where(eq(alerts.id, leader.id));
      await event(
        tx,
        tenantId,
        leader.id,
        "grouped",
        { reason: "window", title: parsed.title, alertId },
        now,
      );
      await event(
        tx,
        tenantId,
        alertId,
        "grouped",
        { reason: "window", leaderId: leader.id, leaderTitle: leader.title, route: route.name },
        now,
      );
      const policy = plan.grouping.rule?.escalate ?? "never";
      const risen =
        priority !== null && (leader.priorityRank === null || priority.rank < leader.priorityRank);
      const pages = policy === "every" || (policy === "increase" && risen);
      return {
        outcome: { alertId, action: "grouped" as const },
        escalations: pages ? escalate(leader.incidentId) : [],
        webhook: { event: "alert.created" as const, alertId },
        notify: null,
      };
    }

    if (!route) {
      await event(tx, tenantId, alertId, "routed", { route: null }, now);
      return {
        outcome: { alertId, action: "created" as const },
        webhook: { event: "alert.created" as const, alertId },
        notify: null,
      };
    }
    if (testMode) await event(tx, tenantId, alertId, "test_mode", { route: route.name }, now);

    await event(
      tx,
      tenantId,
      alertId,
      "routed",
      {
        route: route.name,
        routeId: route.id,
        escalation: plan.escalations.map((e) => ({
          path: e.pathName,
          via: e.via,
          skipped: e.skipped,
        })),
        incident: plan.incident.template?.mode ?? "never",
        urgency,
        missing: plan.missingRequired.length ? plan.missingRequired : undefined,
      },
      now,
    );

    // The incident, from the route's template.
    let incidentNumber: number | null = null;
    let incidentId: string | null = null;
    if (plan.incident.wants && plan.incident.typeId && plan.incident.template) {
      const template = plan.incident.template;
      const custom: Record<string, unknown> = {};
      for (const [fieldKey, attrKey] of Object.entries(template.customFields))
        if (attributes[attrKey]) custom[fieldKey] = attributes[attrKey];
      const created = await declareIncidentCore(
        tx,
        tenantId,
        { kind: "system", memberId: null, name: source.name },
        {
          name: parsed.title,
          summary: parsed.description ?? undefined,
          mode: "live",
          typeId: plan.incident.typeId,
          severityId: plan.incident.severityId,
          // The service the signal named — `observeService` created it at
          // ingestion, so the incident carries the same one the Services
          // screen and the Insights count.
          serviceId: attributes.service_id ?? null,
          customFields: await coerceCustomFields(tx, tenantId, custom),
          source: "alert",
          phase: template.startPhase,
          alertRef: { id: alertId, source: source.name, title: parsed.title },
        },
      );
      incidentId = created.id;
      incidentNumber = created.number;
      if (template.visibility === "private")
        await tx
          .update(incidents)
          .set({ visibility: "private" })
          .where(eq(incidents.id, created.id));
      await tx.update(alerts).set({ incidentId }).where(eq(alerts.id, alertId));
      await event(
        tx,
        tenantId,
        alertId,
        "incident_created",
        { number: created.number, phase: template.startPhase },
        now,
      );
    }
    return {
      outcome: { alertId, action: "created" as const, incidentNumber },
      incidentId,
      escalations: escalate(
        incidentId,
        plan.grouping.rule?.enabled ? plan.grouping.rule.graceMinutes : 0,
      ),
      webhook: { event: "alert.created" as const, alertId },
      notify:
        route.notify?.slackChannelId && !testMode
          ? { channelId: route.notify.slackChannelId, alertId }
          : null,
    };
  });

  // After the commit: escalations, incident side effects, the channel, webhooks.
  if ("cancel" in result && result.cancel)
    await cancelEscalation(tenantId, result.cancel, "alert_resolved").catch(() => {});
  if ("declinedIncidentId" in result && result.declinedIncidentId)
    await afterIncidentChange(tenantId, result.declinedIncidentId, ["incident.updated"]).catch(
      () => {},
    );
  if ("escalations" in result && result.escalations)
    for (const e of result.escalations) await startOne(tenantId, source, e);
  if ("incidentId" in result && result.incidentId)
    await afterIncidentChange(tenantId, result.incidentId, ["incident.created"]);
  if ("notify" in result && result.notify)
    await notifyChannel(tenantId, result.notify.channelId, result.notify.alertId).catch((err) =>
      console.error("[alerts] channel notification failed", err),
    );
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

async function startOne(tenantId: string, source: SourceRow, e: Escalate): Promise<void> {
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
  const now = new Date();
  if (!started) {
    await withTenant(tenantId, (tx) =>
      event(
        tx,
        tenantId,
        e.alertId,
        "routed",
        { warning: "path_unpublished", pathId: e.pathId },
        now,
      ),
    ).catch(() => {});
  } else if (e.deferMinutes > 0) {
    await withTenant(tenantId, (tx) =>
      event(tx, tenantId, e.alertId, "deferred", { minutes: e.deferMinutes }, now),
    ).catch(() => {});
  }
}

/** The alert in the channel the route names. */
async function notifyChannel(tenantId: string, channelId: string, alertId: string): Promise<void> {
  const tenant = await getTenantById(tenantId);
  if (!tenant) return;
  const origin = tenantOrigin(tenant.slug, tenant.customDomain);
  const view = await withTenant(tenantId, async (tx) => {
    const p = await alertPayload(tx, tenantId, alertId);
    if (!p) return null;
    return {
      title: p.title,
      description: p.description,
      status: p.status,
      sourceName: p.source?.name ?? "—",
      priority: p.priority,
      attributes: p.attributes,
      url: `${origin}/app/alerts/${alertId}`,
      externalUrl: p.external_url,
      incidentReference: p.incident_reference,
      incidentUrl: p.incident_reference
        ? `${origin}/app/incidents/${p.incident_reference.replace(/^INC-/, "")}`
        : null,
      testMode: p.test_mode,
    };
  });
  if (view) await postAlertToChannel(tenantId, channelId, view);
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
