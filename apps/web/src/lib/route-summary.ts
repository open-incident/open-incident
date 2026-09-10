/**
 * A route in one line — what it catches, what it does — for lists and the
 * setup screen. Words come from the dictionaries; ids become names.
 */
import type { alertRoutes, Condition, ConditionGroup } from "@openincident/db";
import type { Translate } from "@/i18n/server";

type RouteRow = typeof alertRoutes.$inferSelect;
type Named = { id: string; name: string };

export function describeCondition(c: Condition, t: Translate): string {
  const subject =
    c.attribute === "source"
      ? t("routes.subject.source")
      : c.attribute === "source_name"
        ? t("routes.subject.sourceName")
        : c.attribute === "title"
          ? t("routes.subject.title")
          : c.attribute;
  const op = t(`routes.op.${c.op}`);
  return c.op === "exists" || c.op === "missing"
    ? `${subject} ${op}`
    : `${subject} ${op} ${c.value ?? ""}`.trim();
}

export function describeConditions(groups: ConditionGroup[], t: Translate): string {
  const real = groups.filter((g) => g.all.length > 0);
  if (real.length === 0) return t("routes.everyAlert");
  return real
    .map((g) => g.all.map((c) => describeCondition(c, t)).join(` ${t("routes.and")} `))
    .join(` ${t("routes.or")} `);
}

export function describeRoute(
  r: RouteRow,
  t: Translate,
  refs: { paths: Named[]; sources: Named[] },
): { when: string; then: string } {
  const conditions =
    r.conditions.length > 0
      ? r.conditions
      : r.filters.length > 0
        ? [{ all: r.filters.map((f) => ({ ...f })) }]
        : [];
  const sources =
    r.sourceIds.length > 0
      ? r.sourceIds.map((id) => refs.sources.find((s) => s.id === id)?.name ?? "?").join(", ")
      : null;
  const when = [
    sources ? t("routes.fromSources", { sources }) : null,
    describeConditions(conditions, t),
  ]
    .filter(Boolean)
    .join(" · ");
  const pathName = (id: string | null) =>
    id ? (refs.paths.find((p) => p.id === id)?.name ?? "?") : null;
  const rules = r.escalations.length
    ? r.escalations
    : r.escalationMode === "static" && r.escalationPathId
      ? [{ kind: "path" as const, pathId: r.escalationPathId }]
      : r.escalationMode === "dynamic"
        ? [{ kind: "attribute" as const, attribute: "service", fallbackPathId: r.escalationPathId }]
        : [];
  const paging = rules.length
    ? rules
        .map((e) =>
          e.kind === "path"
            ? t("routes.pagePath", { path: pathName(e.pathId) ?? "?" })
            : t("routes.pageAttribute", {
                attribute: e.attribute,
                fallback: pathName(e.fallbackPathId) ?? t("routes.noFallback"),
              }),
        )
        .join(", ")
    : t("routes.pageNobody");
  const mode = r.incident?.mode ?? r.incidentMode;
  const incident =
    mode === "never"
      ? t("routes.incidentNever")
      : mode === "always"
        ? t("routes.incidentAlways")
        : t("routes.incidentConditional");
  return { when, then: `${paging} · ${incident}` };
}
