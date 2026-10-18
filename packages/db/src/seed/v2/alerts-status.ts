/**
 * Demo rows the V2 design shows for alerts-status — idempotent: running it twice
 * leaves the same rows. Called by the demo seed and by `run.ts --part alerts-status`.
 * Owner: alerts-status.
 *
 * What it sets, on the demo's own sources and status page:
 *  - each source's three choices, as the design's cards read them (Datadog
 *    pages the service owner and opens an incident from P2, Prometheus from
 *    P1, Grafana hands Payments its alerts, Sentry pages nobody and never
 *    opens one, HTTP opens every alert in triage);
 *  - CloudWatch connected but silent for twelve days — the "Quiet" state a
 *    broken SNS subscription looks like — with the last alert it did send;
 *  - Uptime Kuma on trial: its alerts logged and routed, nobody paged, with
 *    the test alerts that trial produced;
 *  - an internal status page next to the public one, with the same
 *    components plus two only the team needs to see.
 *
 * The alerts Atlas resolved come from atlas-core; nothing here touches them.
 */
import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  alertEvents,
  alertPriorities,
  alertSources,
  alerts,
  statusPageComponents,
  statusPages,
  teams,
  type EscalationRule,
} from "../../schema/app";
import type { SeedTx } from "./types";

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** A UUID derived from the workspace and a key — the same on every run. */
function sid(tenantId: string, key: string): string {
  const h = createHash("sha256").update(`alerts-status:${tenantId}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const OWNER: EscalationRule[] = [{ kind: "attribute", attribute: "service", fallbackPathId: null }];

export async function seed(tx: SeedTx, tenantId: string): Promise<void> {
  const now = Date.now();
  const sources: Array<typeof alertSources.$inferSelect> = await tx
    .select()
    .from(alertSources)
    .where(and(eq(alertSources.tenantId, tenantId), eq(alertSources.managed, false)));
  const byKind = (kind: string) => sources.find((s) => s.kind === kind) ?? null;
  const prios: Array<{ id: string; name: string; rank: number }> = await tx
    .select({ id: alertPriorities.id, name: alertPriorities.name, rank: alertPriorities.rank })
    .from(alertPriorities)
    .where(eq(alertPriorities.tenantId, tenantId))
    .orderBy(asc(alertPriorities.rank));
  const rankOf = (name: string) => prios.find((p) => p.name === name)?.rank ?? null;
  const [payments]: Array<{ pathId: string | null }> = await tx
    .select({ pathId: teams.policyPathId })
    .from(teams)
    .where(and(eq(teams.tenantId, tenantId), eq(teams.name, "Payments")));

  /* ---------- The three choices of each source ---------- */
  const choices: Array<{
    kind: string;
    escalations: EscalationRule[];
    incidentOpens: "never" | "always" | "conditional";
    from: string | null;
    autoResolve: boolean;
  }> = [
    {
      kind: "datadog",
      escalations: OWNER,
      incidentOpens: "conditional",
      from: "P2",
      autoResolve: true,
    },
    {
      kind: "prometheus",
      escalations: OWNER,
      incidentOpens: "conditional",
      from: "P1",
      autoResolve: true,
    },
    {
      kind: "grafana",
      escalations: payments?.pathId ? [{ kind: "path", pathId: payments.pathId }] : OWNER,
      incidentOpens: "conditional",
      from: "P2",
      autoResolve: true,
    },
    { kind: "sentry", escalations: [], incidentOpens: "never", from: null, autoResolve: false },
    {
      kind: "cloudwatch",
      escalations: OWNER,
      incidentOpens: "conditional",
      from: "P2",
      autoResolve: true,
    },
    { kind: "uptime_kuma", escalations: [], incidentOpens: "never", from: null, autoResolve: true },
    { kind: "http", escalations: OWNER, incidentOpens: "always", from: null, autoResolve: false },
  ];
  for (const c of choices) {
    const s = byKind(c.kind);
    if (!s) continue;
    await tx
      .update(alertSources)
      .set({
        escalations: c.escalations,
        incidentOpens: c.incidentOpens,
        incidentFromRank: c.from ? rankOf(c.from) : null,
        autoResolve: c.autoResolve,
        testMode: c.kind === "uptime_kuma",
        active: true,
      })
      .where(eq(alertSources.id, s.id));
  }

  /* ---------- Alerts that make the states true ---------- */
  const p3 = prios.find((p) => p.name === "P3") ?? prios[prios.length - 1] ?? null;
  const put = async (
    source: typeof alertSources.$inferSelect,
    key: string,
    a: { title: string; at: number; test: boolean; service: string; payload: unknown },
  ) => {
    const id = sid(tenantId, key);
    const [found] = await tx.select({ id: alerts.id }).from(alerts).where(eq(alerts.id, id));
    const at = new Date(a.at);
    const resolvedAt = new Date(a.at + 20 * 60_000);
    if (found) {
      // Re-anchored on "now" so the demo stays as recent as the design.
      await tx.update(alerts).set({ firstAt: at, lastAt: at, resolvedAt }).where(eq(alerts.id, id));
      await tx.delete(alertEvents).where(eq(alertEvents.alertId, id));
    } else {
      await tx.insert(alerts).values({
        id,
        tenantId,
        sourceId: source.id,
        dedupKey: key,
        status: "resolved",
        title: a.title,
        payload: a.payload,
        attributes: {
          service: a.service,
          environment: "production",
          priority: p3?.name ?? "P3",
          source: source.kind,
          source_name: source.name,
        },
        priorityId: p3?.id ?? null,
        urgency: "low",
        testMode: a.test,
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
        payload: { source: source.name, priority: p3?.name ?? "P3", test: a.test },
        occurredAt: at,
      },
      ...(a.test
        ? [{ tenantId, alertId: id, kind: "test_mode" as const, payload: {}, occurredAt: at }]
        : []),
      {
        tenantId,
        alertId: id,
        kind: "resolved",
        payload: { by: "source" },
        occurredAt: resolvedAt,
      },
    ]);
  };

  const cloudwatch = byKind("cloudwatch");
  if (cloudwatch) {
    const at = now - 12 * DAY - 3 * HOUR;
    await put(cloudwatch, "cloudwatch-quiet", {
      title: "CPU credit balance low on batch-runner",
      at,
      test: false,
      service: "payments-worker",
      payload: {
        Message: JSON.stringify({
          AlarmName: "CPU credit balance low on batch-runner",
          NewStateValue: "ALARM",
          AlarmArn: "arn:aws:cloudwatch:eu-west-3:000000000000:alarm:batch-runner-cpu-credits",
          Region: "EU (Paris)",
        }),
      },
    });
    await tx
      .update(alertSources)
      .set({ lastAlertAt: new Date(at) })
      .where(eq(alertSources.id, cloudwatch.id));
  }

  const kuma = byKind("uptime_kuma");
  if (kuma) {
    const trial = [
      { key: "kuma-trial-1", title: "storefront /health down", hours: 5 },
      { key: "kuma-trial-2", title: "checkout /health down", hours: 29 },
      { key: "kuma-trial-3", title: "status.skylark.dev slow to answer", hours: 52 },
    ];
    for (const x of trial)
      await put(kuma, x.key, {
        title: x.title,
        at: now - x.hours * HOUR,
        test: true,
        service: x.title.startsWith("checkout") ? "checkout-api" : "web-storefront",
        payload: { heartbeat: { status: 0, msg: x.title }, monitor: { id: x.key, name: x.title } },
      });
    await tx
      .update(alertSources)
      .set({ lastAlertAt: new Date(now - 5 * HOUR) })
      .where(eq(alertSources.id, kuma.id));
  }

  /* ---------- The internal status page ---------- */
  const pages: Array<typeof statusPages.$inferSelect> = await tx
    .select()
    .from(statusPages)
    .where(eq(statusPages.tenantId, tenantId))
    .orderBy(asc(statusPages.createdAt));
  const main = pages.find((p) => p.visibility === "public") ?? null;
  if (main) {
    const internalId = sid(tenantId, "internal-page");
    const slug = `${main.slug}-internal`.slice(0, 40);
    const [taken] = await tx
      .select({ id: statusPages.id, tenantId: statusPages.tenantId })
      .from(statusPages)
      .where(eq(statusPages.slug, slug));
    if (!taken) {
      await tx.insert(statusPages).values({
        id: internalId,
        tenantId,
        name: "Skylark Internal",
        slug,
        locale: main.locale,
        accentColor: main.accentColor,
        noindex: true,
        visibility: "internal",
        minSeverityRank: 2,
      });
    }
    if (!taken || taken.id === internalId) {
      const comps: Array<typeof statusPageComponents.$inferSelect> = await tx
        .select()
        .from(statusPageComponents)
        .where(eq(statusPageComponents.pageId, main.id))
        .orderBy(asc(statusPageComponents.position));
      const wanted = [
        ...comps.map((c) => ({
          key: `internal-${c.id}`,
          name: c.name,
          description: c.description,
          serviceId: c.serviceId,
        })),
        { key: "internal-backoffice", name: "Back-office", description: null, serviceId: null },
        { key: "internal-batch", name: "Nightly batch", description: null, serviceId: null },
      ];
      const ids = wanted.map((w) => sid(tenantId, w.key));
      const have = new Set(
        (
          await tx
            .select({ id: statusPageComponents.id })
            .from(statusPageComponents)
            .where(inArray(statusPageComponents.id, ids))
        ).map((r: { id: string }) => r.id),
      );
      let position = 0;
      for (const w of wanted) {
        const id = sid(tenantId, w.key);
        position++;
        if (have.has(id)) continue;
        await tx.insert(statusPageComponents).values({
          id,
          tenantId,
          pageId: internalId,
          name: w.name,
          description: w.description,
          serviceId: w.serviceId,
          position,
        });
      }
    }
  }
}
