/**
 * settings-v2 demo rows — alerts screens (Rules, Alert severities, Labels).
 * Idempotent: running it twice leaves the same rows. Called by
 * ../settings-v2.ts inside the seed's transaction, the tenant context set.
 *
 * What it sets:
 *  - the four alert severities' labels in the design's words (P1 — Critical…),
 *    only where they still hold the demo's original text;
 *  - two rules in front of the existing ones, the design's Atlas states: one
 *    on `service = billing-db` that never lets Atlas act and pages Payments,
 *    written by Nadia; one on `service = payments-worker` that lets Atlas
 *    handle it, written by Karim — each with the audit line that says who;
 *  - a week of resolved alerts decided by the rules, carrying the labels the
 *    design lists (service, environment, region, team, and a customer contact
 *    the redaction before Atlas rewrites).
 * Existing rules are left as they are.
 */
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, min } from "drizzle-orm";
import {
  alertEvents,
  alertPriorities,
  alertRoutes,
  alertSources,
  alerts,
  auditEvents,
  members,
  teams,
  type EscalationRule,
  type IncidentTemplate,
} from "../../../schema/app";
import type { SeedTx } from "../types";

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** A UUID derived from the workspace and a key — the same on every run. */
function sid(tenantId: string, key: string): string {
  const h = createHash("sha256").update(`settings-v2-alerts:${tenantId}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const LABELS: Record<string, { from: RegExp; to: string }> = {
  P1: { from: /^Critique/, to: "Critical" },
  P2: { from: /^Élevée/, to: "High" },
  P3: { from: /^Normale/, to: "Medium" },
  P4: { from: /^Basse/, to: "Low" },
};

const INCIDENT: IncidentTemplate = {
  mode: "conditional",
  typeId: null,
  startPhase: "triage",
  severity: { mode: "priority" },
  visibility: "public",
  customFields: {},
  declineOnResolve: true,
};

export async function seed(tx: SeedTx, tenantId: string): Promise<void> {
  const now = Date.now();

  /* ---------- Alert severities, in the design's words ---------- */
  const prios: Array<typeof alertPriorities.$inferSelect> = await tx
    .select()
    .from(alertPriorities)
    .where(eq(alertPriorities.tenantId, tenantId))
    .orderBy(asc(alertPriorities.rank));
  for (const p of prios) {
    const l = LABELS[p.name];
    if (l && (!p.description || l.from.test(p.description)))
      await tx
        .update(alertPriorities)
        .set({ description: l.to })
        .where(eq(alertPriorities.id, p.id));
  }
  const prio = (name: string) => prios.find((p) => p.name === name) ?? null;

  /* ---------- Two rules with an Atlas directive ---------- */
  const [payments]: Array<{ pathId: string | null }> = await tx
    .select({ pathId: teams.policyPathId })
    .from(teams)
    .where(and(eq(teams.tenantId, tenantId), eq(teams.name, "Payments")));
  const people: Array<{ id: string; name: string; email: string }> = await tx
    .select({ id: members.id, name: members.name, email: members.email })
    .from(members)
    .where(eq(members.tenantId, tenantId));
  const person = (prefix: string) => people.find((m) => m.email.startsWith(`${prefix}@`)) ?? null;
  const page: EscalationRule[] = payments?.pathId
    ? [{ kind: "path", pathId: payments.pathId }]
    : [{ kind: "attribute", attribute: "service", fallbackPathId: null }];
  const [first]: Array<{ p: number | null }> = await tx
    .select({ p: min(alertRoutes.position) })
    .from(alertRoutes)
    .where(eq(alertRoutes.tenantId, tenantId));
  const top = first?.p ?? 0;

  const rules = [
    {
      key: "rule-billing-db",
      name: "Billing database — Atlas never acts",
      service: "billing-db",
      directive: "never" as const,
      by: person("nadia"),
      daysAgo: 15,
      position: top - 2,
    },
    {
      key: "rule-payments-worker",
      name: "Payments worker — Atlas handles it",
      service: "payments-worker",
      directive: "handle" as const,
      by: person("karim"),
      daysAgo: 41,
      position: top - 1,
    },
  ];
  for (const r of rules) {
    const id = sid(tenantId, r.key);
    const [found] = await tx
      .select({ id: alertRoutes.id })
      .from(alertRoutes)
      .where(eq(alertRoutes.id, id));
    if (found) continue;
    const [named] = await tx
      .select({ id: alertRoutes.id })
      .from(alertRoutes)
      .where(and(eq(alertRoutes.tenantId, tenantId), eq(alertRoutes.name, r.name)));
    if (named) continue;
    const at = new Date(now - r.daysAgo * DAY);
    await tx.insert(alertRoutes).values({
      id,
      tenantId,
      name: r.name,
      conditions: [{ all: [{ attribute: "service", op: "eq", value: r.service }] }],
      escalations: page,
      incident: INCIDENT,
      escalationMode: page[0]!.kind === "path" ? "static" : "dynamic",
      escalationPathId: page[0]!.kind === "path" ? page[0]!.pathId : null,
      incidentMode: "conditional",
      atlasDirective: r.directive,
      position: r.position,
      createdAt: at,
      updatedAt: at,
    });
    if (r.by)
      await tx
        .insert(auditEvents)
        .values({
          id: sid(tenantId, `${r.key}-audit`),
          tenantId,
          actorMemberId: r.by.id,
          actorName: r.by.name,
          category: "config",
          action: "alert_route.created",
          target: { id, name: r.name },
          createdAt: at,
        })
        .onConflictDoNothing();
  }

  /* ---------- A week of alerts the rules decided, with their labels ---------- */
  const sources: Array<typeof alertSources.$inferSelect> = await tx
    .select()
    .from(alertSources)
    .where(and(eq(alertSources.tenantId, tenantId), eq(alertSources.managed, false)));
  const byKind = (kind: string) => sources.find((s) => s.kind === kind) ?? sources[0] ?? null;
  const routes: Array<{ id: string; name: string; conditions: unknown }> = await tx
    .select({ id: alertRoutes.id, name: alertRoutes.name, conditions: alertRoutes.conditions })
    .from(alertRoutes)
    .where(eq(alertRoutes.tenantId, tenantId));
  const routeOn = (attribute: string, value: string) =>
    routes.find(
      (r) =>
        JSON.stringify(r.conditions).includes(`"attribute":"${attribute}"`) &&
        JSON.stringify(r.conditions).includes(`"value":"${value}"`),
    )?.id ?? null;
  const handled = sid(tenantId, "rule-payments-worker");
  const handledExists = routes.some((r) => r.id === handled);

  const week: Array<{
    key: string;
    kind: string;
    title: string;
    hours: number;
    prio: string;
    route: string | null;
    labels: Record<string, string>;
  }> = [
    {
      key: "pw-queue-lag",
      kind: "datadog",
      title: "payments-worker queue lag above 5 min",
      hours: 20,
      prio: "P2",
      route: handledExists ? handled : null,
      labels: {
        service: "payments-worker",
        environment: "production",
        region: "eu-west-1",
        team: "Payments",
        customer: "billing@northwind.example",
      },
    },
    {
      key: "pw-retries",
      kind: "prometheus",
      title: "payments-worker retries above 3 % on card captures",
      hours: 58,
      prio: "P3",
      route: handledExists ? handled : null,
      labels: {
        service: "payments-worker",
        environment: "production",
        region: "eu-west-1",
        team: "Payments",
        customer: "it-ops@acme-retail.example",
      },
    },
    {
      key: "pw-dlq",
      kind: "datadog",
      title: "payments-worker dead-letter queue not empty",
      hours: 101,
      prio: "P3",
      route: handledExists ? handled : null,
      labels: {
        service: "payments-worker",
        environment: "production",
        region: "us-east-1",
        team: "Payments",
        customer: "noc@globex.example",
      },
    },
    {
      key: "checkout-p95",
      kind: "datadog",
      title: "checkout-api p95 latency above 800 ms",
      hours: 31,
      prio: "P2",
      route: routeOn("environment", "production"),
      labels: {
        service: "checkout-api",
        environment: "production",
        region: "eu-west-1",
        team: "Platform",
      },
    },
    {
      key: "storefront-5xx",
      kind: "grafana",
      title: "web-storefront 5xx above 1 %",
      hours: 77,
      prio: "P2",
      route: routeOn("environment", "production"),
      labels: {
        service: "web-storefront",
        environment: "production",
        region: "us-east-1",
        team: "Storefront",
        customer: "support@initech.example",
      },
    },
    {
      key: "staging-disk",
      kind: "prometheus",
      title: "staging-db disk above 85 %",
      hours: 44,
      prio: "P4",
      route: routeOn("environment", "staging"),
      labels: { service: "orders-db", environment: "staging", region: "eu-west-1" },
    },
  ];

  const ids = week.map((w) => sid(tenantId, `alert-${w.key}`));
  const existing: Array<{ id: string }> = await tx
    .select({ id: alerts.id })
    .from(alerts)
    .where(inArray(alerts.id, ids));
  for (const w of week) {
    const source = byKind(w.kind);
    if (!source) continue;
    const id = sid(tenantId, `alert-${w.key}`);
    const p = prio(w.prio);
    const at = new Date(now - w.hours * HOUR);
    const resolvedAt = new Date(at.getTime() + 25 * 60_000);
    if (existing.some((e) => e.id === id)) {
      // Re-anchored on "now" so the week stays this week.
      await tx
        .update(alerts)
        .set({ firstAt: at, lastAt: at, resolvedAt, routeId: w.route })
        .where(eq(alerts.id, id));
      await tx.delete(alertEvents).where(eq(alertEvents.alertId, id));
    } else {
      await tx.insert(alerts).values({
        id,
        tenantId,
        sourceId: source.id,
        routeId: w.route,
        dedupKey: `settings-v2-${w.key}`,
        status: "resolved",
        title: w.title,
        payload: { title: w.title, ...w.labels, priority: w.prio },
        attributes: {
          ...w.labels,
          priority: p?.name ?? w.prio,
          source: source.kind,
          source_name: source.name,
        },
        priorityId: p?.id ?? null,
        urgency: p?.urgency ?? "low",
        firstAt: at,
        lastAt: at,
        resolvedAt,
      });
    }
    await tx.insert(alertEvents).values([
      {
        tenantId,
        alertId: id,
        kind: "triggered",
        payload: { source: source.name, priority: p?.name ?? w.prio },
        occurredAt: at,
      },
      {
        tenantId,
        alertId: id,
        kind: "resolved",
        payload: { by: "source" },
        occurredAt: resolvedAt,
      },
    ]);
  }
}
