/**
 * What a draft rule would change, read off the alerts that already arrived.
 *
 * The rules screen promises that nothing is sent: this evaluates, it never
 * acts. It also promises the truth, so it does not re-implement the matcher —
 * it replays exactly what `deliverAlert` does to pick a route (active routes in
 * position order, source filter then `conditionsHold`, escalation rules
 * resolved through the service and its owner) against the alerts as they were
 * stored, once
 * for the workspace as it stands and once with the draft in place. The
 * difference between the two is the answer.
 *
 * Two things it deliberately does not reproduce, because they depend on the
 * moment an alert arrives rather than on the rule: grouping (an alert that
 * joins a group is handled by its leader) and deferral. A row therefore says
 * which rule would decide and what that rule does — not whether a page would
 * have been suppressed by a burst that has since ended.
 */
import { desc, eq } from "drizzle-orm";
import {
  alertPriorities,
  alertRoutes,
  alertSources,
  alerts,
  escalationPaths,
  type ConditionGroup,
  type EscalationRule,
  type Tx,
} from "@openincident/db";
import {
  conditionsHold,
  legacyFiltersAsConditions,
  resolveAttributePath,
} from "@openincident/oncall";
import type { Translate } from "@/i18n/server";
import { PREVIEW_ALERTS, type RulePreview, type RulePreviewRow } from "./settings-rule-shape";

export { PREVIEW_ALERTS, type RulePreview, type RulePreviewRow };

type RouteRow = typeof alertRoutes.$inferSelect;

/** The draft the editor holds, in the only terms that change which alerts are caught. */
export type RuleDraft = {
  /** The route being edited, or null for a new one. */
  id: string | null;
  sourceIds: string[];
  conditions: ConditionGroup[];
  escalations: EscalationRule[];
  incidentMode: "never" | "always" | "conditional";
  testMode: boolean;
  active: boolean;
};

const hasCondition = (r: { conditions: ConditionGroup[]; filters: unknown[] }) =>
  r.conditions.some((g) => g.all.length > 0) || r.filters.length > 0;

/**
 * A route that carries no condition and at most one source is not a rule: it
 * is either the catch-all or the three choices a source makes for itself. A
 * new rule belongs above every one of them, since a rule is by definition the
 * exception to what a source already decided.
 */
export function isDefaultsRoute(r: {
  sourceIds: string[];
  conditions: ConditionGroup[];
  filters: unknown[];
}): boolean {
  return !hasCondition(r) && r.sourceIds.length <= 1;
}

/** Where a new rule goes in the order: above the first route that is only a default. */
export function insertionIndex(
  rows: Array<{ sourceIds: string[]; conditions: ConditionGroup[]; filters: unknown[] }>,
): number {
  const i = rows.findIndex(isDefaultsRoute);
  return i < 0 ? rows.length : i;
}

const conditionsOf = (r: RouteRow) =>
  r.conditions.length > 0 ? r.conditions : legacyFiltersAsConditions(r.filters);

/** What the ingest path would do with these rules, for this one alert. */
type Ctx = Parameters<typeof conditionsHold>[1];

function routeCatches(r: RouteRow, sourceId: string, ctx: Ctx): boolean {
  return (
    (r.sourceIds.length === 0 || r.sourceIds.includes(sourceId)) &&
    conditionsHold(conditionsOf(r), ctx)
  );
}

export async function previewRuleAgainstAlerts(
  tx: Tx,
  tenantId: string,
  draft: RuleDraft,
  t: Translate,
  limit: number = PREVIEW_ALERTS,
): Promise<RulePreview> {
  const rows = await tx
    .select({
      id: alerts.id,
      title: alerts.title,
      attributes: alerts.attributes,
      lastAt: alerts.lastAt,
      sourceId: alerts.sourceId,
      sourceName: alertSources.name,
      sourceKind: alertSources.kind,
      priorityName: alertPriorities.name,
      priorityColor: alertPriorities.color,
    })
    .from(alerts)
    .innerJoin(alertSources, eq(alertSources.id, alerts.sourceId))
    .leftJoin(alertPriorities, eq(alertPriorities.id, alerts.priorityId))
    .where(eq(alerts.tenantId, tenantId))
    .orderBy(desc(alerts.lastAt))
    .limit(limit);

  const saved = await tx
    .select()
    .from(alertRoutes)
    .where(eq(alertRoutes.tenantId, tenantId))
    .orderBy(alertRoutes.position, alertRoutes.createdAt);
  const paths = await tx
    .select({ id: escalationPaths.id, name: escalationPaths.name })
    .from(escalationPaths)
    .where(eq(escalationPaths.tenantId, tenantId));

  // The order the pipeline would see once this draft is saved: the edited row
  // replaced in place, or a new one inserted where `saveRoute` will put it.
  const edited = draft.id ? (saved.find((r) => r.id === draft.id) ?? null) : null;
  const asDraft = {
    // An edited rule keeps the columns the editor does not carry (its Slack
    // channel, its grouping). A new one starts from nothing, never from
    // whichever rule happens to sit first.
    ...(edited ?? {}),
    id: draft.id ?? "draft",
    sourceIds: draft.sourceIds,
    conditions: draft.conditions,
    filters: [],
    escalations: draft.escalations,
    escalationMode: "none",
    escalationPathId: null,
    incident: edited?.incident ? { ...edited.incident, mode: draft.incidentMode } : null,
    incidentMode: draft.incidentMode,
    testMode: draft.testMode,
    active: draft.active,
  } as unknown as RouteRow;
  const after: RouteRow[] = draft.id
    ? saved.map((r) => (r.id === draft.id ? asDraft : r))
    : (() => {
        const next = [...saved];
        next.splice(insertionIndex(saved), 0, asDraft);
        return next;
      })();
  // Today's behaviour: the workspace as it stands, with the edited route as it
  // is currently saved. A brand-new draft changes nothing on this side.
  const before = saved;

  const activeOf = (list: RouteRow[]) => list.filter((r) => r.active);
  const beforeActive = activeOf(before);
  const afterActive = activeOf(after);

  const pathName = (id: string | null) =>
    id ? (paths.find((p) => p.id === id)?.name ?? "?") : null;
  // The same question for every alert sharing a value, asked once. The key
  // joins on a newline rather than a raw NUL: a control byte in the source made
  // the whole file read as binary to grep, diff and every editor.
  const attributeCache = new Map<string, string | null>();
  const resolveAttribute = async (attribute: string, value: string | undefined) => {
    const key = `${attribute}\n${value ?? ""}`;
    if (attributeCache.has(key)) return attributeCache.get(key)!;
    const found = await resolveAttributePath(tx, tenantId, attribute, value);
    attributeCache.set(key, found?.pathId ?? null);
    return found?.pathId ?? null;
  };

  /** One route's decision for one alert, in the words the screen shows. */
  const outcome = async (r: RouteRow | null, ctx: Ctx, attrs: Record<string, string>) => {
    if (!r) return t("set2.ed.noRule");
    if (r.testMode) return t("set2.ed.outcomeTest");
    const rules =
      r.escalations.length > 0
        ? r.escalations
        : r.escalationMode === "static" && r.escalationPathId
          ? [{ kind: "path" as const, pathId: r.escalationPathId }]
          : r.escalationMode === "dynamic"
            ? [
                {
                  kind: "attribute" as const,
                  attribute: "service",
                  fallbackPathId: r.escalationPathId,
                },
              ]
            : [];
    const names: string[] = [];
    for (const rule of rules) {
      if (rule.when && rule.when.length > 0 && !conditionsHold(rule.when, ctx)) continue;
      if (rule.kind === "path") {
        const n = pathName(rule.pathId);
        if (n) names.push(n);
        continue;
      }
      const n = pathName(
        (await resolveAttribute(rule.attribute, attrs[rule.attribute])) ?? rule.fallbackPathId,
      );
      if (n) names.push(n);
    }
    const paging = names.length
      ? t("set2.ed.outcomePages", { paths: names.join(", ") })
      : t("set2.ed.outcomeNobody");
    const mode = r.incident?.mode ?? r.incidentMode;
    const incident =
      mode === "never"
        ? t("routes.incidentNever")
        : mode === "always"
          ? t("routes.incidentAlways")
          : t("routes.incidentConditional");
    return `${paging} · ${incident}`;
  };

  const out: RulePreviewRow[] = [];
  let matches = 0;
  let changes = 0;
  for (const a of rows) {
    const ctx: Ctx = {
      attributes: a.attributes,
      source: { kind: a.sourceKind, name: a.sourceName, id: a.sourceId },
      priority: a.priorityName ?? a.attributes.priority ?? null,
      title: a.title,
    };
    const matched = draft.active && routeCatches(asDraft, a.sourceId, ctx);
    if (matched) matches += 1;
    const chosenBefore = beforeActive.find((r) => routeCatches(r, a.sourceId, ctx)) ?? null;
    const chosenAfter = afterActive.find((r) => routeCatches(r, a.sourceId, ctx)) ?? null;
    const beforeText = await outcome(chosenBefore, ctx, a.attributes);
    const afterText = await outcome(chosenAfter, ctx, a.attributes);
    const changed = beforeText !== afterText;
    if (changed) changes += 1;
    out.push({
      id: a.id,
      title: a.title,
      source: a.sourceName,
      when: a.lastAt.toISOString(),
      priority: a.priorityName ?? a.attributes.priority ?? null,
      priorityColor: a.priorityColor ?? null,
      matched,
      changed,
      before: beforeText,
      after: afterText,
    });
  }
  return { rows: out, matches, changes };
}
