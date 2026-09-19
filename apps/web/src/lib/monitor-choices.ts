/**
 * The three choices a monitor carries, applied for real.
 *
 * A monitor is asked, at creation, who to page when it goes down, whether an
 * incident opens, and whether it closes itself when the check passes again.
 * Those answers were stored on the monitor and read by nobody: the sweep
 * posted its alert and left the routing to whatever rule happened to match.
 * "Page the owner" worked by accident, because the alert names the service;
 * "page me" and "page nobody" did nothing at all.
 *
 * They are applied the way a source's choices are: through a rule dedicated to
 * this monitor, matching on `monitor_id`. Not by having the sweep decide for
 * itself — that would put the routing decision in a second place, and one road
 * whatever the signal is the whole point of sending monitor alerts through the
 * ingest endpoint.
 *
 * The rule carries a condition, so a rule written by a person still sits above
 * it and still wins: a monitor's choices are a default, not an exception.
 */

import { and, asc, eq } from "drizzle-orm";
import {
  alertRoutes,
  alertSources,
  escalationPaths,
  type EscalationRule,
  type IncidentTemplate,
  type Tx,
} from "@openincident/db";
import { ensureQuickPath } from "@/lib/alerting-setup";
import { getT } from "@/i18n/server";

export type MonitorPage =
  { kind: "owner" } | { kind: "member"; memberId: string } | { kind: "nobody" };
/** Whether the alert opens an incident: in triage, only when urgent, never. */
export type MonitorIncident = "triage" | "urgent" | "never";

export type MonitorChoices = {
  page: MonitorPage;
  incident: MonitorIncident;
  autoResolve: boolean;
};

export const DEFAULT_MONITOR_CHOICES: MonitorChoices = {
  page: { kind: "owner" },
  incident: "urgent",
  autoResolve: true,
};

const TEMPLATE: IncidentTemplate = {
  mode: "never",
  typeId: null,
  startPhase: "triage",
  severity: { mode: "priority" },
  visibility: "public",
  customFields: {},
  declineOnResolve: true,
};

/** True when nothing about these choices differs from what the pipeline already does. */
export function isDefaultChoices(c: MonitorChoices): boolean {
  return (
    c.page.kind === DEFAULT_MONITOR_CHOICES.page.kind &&
    c.incident === DEFAULT_MONITOR_CHOICES.incident &&
    c.autoResolve === DEFAULT_MONITOR_CHOICES.autoResolve
  );
}

async function rulesFor(
  tx: Tx,
  tenantId: string,
  actor: { memberId: string; name: string },
  page: MonitorPage,
): Promise<{ rules: EscalationRule[]; pathId: string | null }> {
  if (page.kind === "nobody") return { rules: [], pathId: null };
  if (page.kind === "owner") {
    // The service the alert names, resolved to the team that owns it.
    return {
      rules: [{ kind: "attribute", attribute: "service", fallbackPathId: null }],
      pathId: null,
    };
  }
  const t = await getT();
  const path = await ensureQuickPath(
    tx,
    tenantId,
    { memberId: actor.memberId },
    { kind: "member", memberId: page.memberId },
    t("setup.quickPath.member", { name: actor.name }),
  );
  return { rules: [{ kind: "path", pathId: path.id }], pathId: path.id };
}

/** The rule that carries this monitor's choices, if it has one. */
export async function monitorRoute(tx: Tx, tenantId: string, monitorId: string) {
  const rows = await tx
    .select()
    .from(alertRoutes)
    .where(eq(alertRoutes.tenantId, tenantId))
    .orderBy(asc(alertRoutes.position), asc(alertRoutes.createdAt));
  return (
    rows.find((r) =>
      r.conditions.some(
        (g) =>
          g.all.length === 1 &&
          g.all[0]?.attribute === "monitor_id" &&
          g.all[0]?.value === monitorId,
      ),
    ) ?? null
  );
}

/**
 * Writes the monitor's choices into its own rule, creating it on first use.
 *
 * Placed just above the first rule that catches everything it sees — the
 * catch-all, or a source's own row — so it decides before those and after any
 * rule a person wrote.
 */
export async function applyMonitorChoices(
  tx: Tx,
  tenantId: string,
  actor: { memberId: string; name: string },
  monitor: { id: string; name: string },
  choices: MonitorChoices,
): Promise<void> {
  const t = await getT();
  const { rules, pathId } = await rulesFor(tx, tenantId, actor, choices.page);
  const mode =
    choices.incident === "never"
      ? "never"
      : choices.incident === "triage"
        ? "always"
        : "conditional";
  const incident: IncidentTemplate = {
    ...TEMPLATE,
    mode,
    declineOnResolve: choices.autoResolve,
  };

  const existing = await monitorRoute(tx, tenantId, monitor.id);
  if (existing) {
    await tx
      .update(alertRoutes)
      .set({
        name: t("monitors.routeName", { name: monitor.name }).slice(0, 80),
        escalations: rules,
        escalationMode:
          rules.length === 0 ? "none" : choices.page.kind === "owner" ? "dynamic" : "static",
        escalationPathId: pathId,
        incident,
        incidentMode: mode,
        resolveClosesEscalation: choices.autoResolve,
        updatedAt: new Date(),
      })
      .where(eq(alertRoutes.id, existing.id));
    return;
  }

  const rows = await tx
    .select()
    .from(alertRoutes)
    .where(eq(alertRoutes.tenantId, tenantId))
    .orderBy(asc(alertRoutes.position), asc(alertRoutes.createdAt));
  const blanket = rows.find(
    (r) =>
      r.sourceIds.length <= 1 &&
      !r.conditions.some((g) => g.all.length > 0) &&
      r.filters.length === 0,
  );
  await tx.insert(alertRoutes).values({
    tenantId,
    name: t("monitors.routeName", { name: monitor.name }).slice(0, 80),
    description: t("monitors.routeDesc", { name: monitor.name }).slice(0, 300),
    active: true,
    sourceIds: [],
    conditions: [{ all: [{ attribute: "monitor_id", op: "eq", value: monitor.id }] }],
    escalations: rules,
    escalationMode:
      rules.length === 0 ? "none" : choices.page.kind === "owner" ? "dynamic" : "static",
    escalationPathId: pathId,
    incident,
    incidentMode: mode,
    resolveClosesEscalation: choices.autoResolve,
    position: blanket ? blanket.position - 1 : 900,
  });
}

/** The rule a monitor alert falls under when the monitor has none of its own. */
async function governingRoute(tx: Tx, tenantId: string) {
  const [source] = await tx
    .select({ id: alertSources.id })
    .from(alertSources)
    .where(
      and(
        eq(alertSources.tenantId, tenantId),
        eq(alertSources.managed, true),
        eq(alertSources.name, "Monitors"),
      ),
    );
  const rows = await tx
    .select()
    .from(alertRoutes)
    .where(and(eq(alertRoutes.tenantId, tenantId), eq(alertRoutes.active, true)))
    .orderBy(asc(alertRoutes.position), asc(alertRoutes.createdAt));
  return (
    rows.find(
      (r) =>
        !r.conditions.some((g) => g.all.length > 0) &&
        r.filters.length === 0 &&
        (r.sourceIds.length === 0 || (source ? r.sourceIds.includes(source.id) : false)),
    ) ?? null
  );
}

/** Drops the rule when its monitor is deleted, so no orphan keeps deciding. */
export async function dropMonitorRoute(tx: Tx, tenantId: string, monitorId: string): Promise<void> {
  const existing = await monitorRoute(tx, tenantId, monitorId);
  if (existing) await tx.delete(alertRoutes).where(eq(alertRoutes.id, existing.id));
}

/**
 * Reads the choices back — what the next alert from this monitor will really do.
 *
 * From the monitor's own rule when it has one, and otherwise from whatever rule
 * governs a monitor alert today. Not from a constant: "the default" is whatever
 * the workspace's own catch-all says, and a screen that guesses it is a screen
 * that can be wrong.
 */
export async function readMonitorChoices(
  tx: Tx,
  tenantId: string,
  monitorId: string,
): Promise<{ choices: MonitorChoices; own: boolean; pageName: string | null }> {
  const route =
    (await monitorRoute(tx, tenantId, monitorId)) ?? (await governingRoute(tx, tenantId));
  if (!route) return { choices: DEFAULT_MONITOR_CHOICES, own: false, pageName: null };
  const own = Boolean(await monitorRoute(tx, tenantId, monitorId));
  const rule = route.escalations[0];
  const page: MonitorPage =
    route.escalations.length === 0
      ? { kind: "nobody" }
      : rule?.kind === "attribute"
        ? { kind: "owner" }
        : { kind: "member", memberId: "" };
  const mode = route.incident?.mode ?? route.incidentMode;
  const incident: MonitorIncident =
    mode === "never" ? "never" : mode === "always" ? "triage" : "urgent";
  let pageName: string | null = null;
  if (rule?.kind === "path") {
    const [p] = await tx
      .select({ name: escalationPaths.name })
      .from(escalationPaths)
      .where(and(eq(escalationPaths.tenantId, tenantId), eq(escalationPaths.id, rule.pathId)));
    pageName = p?.name ?? null;
  }
  return {
    choices: {
      page,
      incident,
      autoResolve: route.incident?.declineOnResolve ?? route.resolveClosesEscalation,
    },
    own,
    pageName,
  };
}
