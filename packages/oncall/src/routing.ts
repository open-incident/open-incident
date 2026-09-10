/**
 * The routing arithmetic, without a database: conditions, mapping transforms,
 * priority matching by name or alias, the grouping key, attribute merging.
 * Every function here is pure, so the tests pin them down and the "what would
 * happen to this payload" preview reuses them unchanged.
 */
import type {
  AlertAttributeType,
  AttributeMapping,
  Condition,
  ConditionGroup,
  GroupingRule,
  MappingTransform,
  MergeStrategy,
} from "@openincident/db";
import { readPath } from "./parsers";

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim()
    ? v.trim()
    : typeof v === "number" || typeof v === "boolean"
      ? String(v)
      : null;

/* ---------- Mappings ---------- */

export function transformValue(value: string, transform: MappingTransform | undefined): string {
  switch (transform) {
    case "lower":
      return value.toLowerCase();
    case "upper":
      return value.toUpperCase();
    case "after_colon":
      return value.includes(":") ? value.slice(value.indexOf(":") + 1).trim() : value;
    case "before_colon":
      return value.includes(":") ? value.slice(0, value.indexOf(":")).trim() : value;
    case "first_word":
      return value.split(/\s+/)[0] ?? value;
    case "trim":
    default:
      return value.trim();
  }
}

/** A regular expression guard: no match drops the value; a capture group replaces it. */
export function matchValue(value: string, pattern: string | undefined): string | null {
  if (!pattern) return value;
  try {
    const m = new RegExp(pattern, "i").exec(value);
    if (!m) return null;
    return m[1] !== undefined ? m[1] : value;
  } catch {
    return value;
  }
}

/** A payload value as one string; arrays join, objects are not attributes. */
export function valueAt(payload: unknown, path: string): string | null {
  const raw = readPath(payload, path);
  if (Array.isArray(raw)) {
    const items = raw.map(str).filter((x): x is string => Boolean(x));
    return items.length ? items.join(", ") : null;
  }
  return str(raw);
}

/** One mapping resolved against a payload: the value the attribute would get, or null. */
export function resolveMapping(payload: unknown, m: AttributeMapping): string | null {
  const extracted = m.path ? valueAt(payload, m.path) : null;
  const base = extracted ?? m.value ?? null;
  if (!base) return null;
  const matched = matchValue(base, m.match);
  if (matched === null) return null;
  return transformValue(matched, m.transform) || null;
}

/** The parser's attributes, then the source's mappings on top; empty values are dropped. */
export function applyMappingsWith(
  base: Record<string, string>,
  payload: unknown,
  mappings: AttributeMapping[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v) out[k] = v;
  for (const m of mappings) {
    if (!m.attribute) continue;
    const value = resolveMapping(payload, m);
    if (value) out[m.attribute] = value;
  }
  return out;
}

/* ---------- Conditions ---------- */

export type ConditionContext = {
  attributes: Record<string, string>;
  source: { kind: string; name: string; id: string };
  priority: string | null;
  title: string;
};

function subject(c: Condition, ctx: ConditionContext): string {
  switch (c.attribute) {
    case "source":
      return ctx.source.kind;
    case "source_name":
      return ctx.source.name;
    case "source_id":
      return ctx.source.id;
    case "priority":
      return ctx.priority ?? ctx.attributes.priority ?? "";
    case "title":
      return ctx.title;
    default:
      return ctx.attributes[c.attribute] ?? "";
  }
}

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

export function conditionHolds(c: Condition, ctx: ConditionContext): boolean {
  const v = subject(c, ctx);
  const lv = v.toLowerCase();
  const want = (c.value ?? "").trim().toLowerCase();
  switch (c.op) {
    case "exists":
      return v !== "";
    case "missing":
      return v === "";
    case "eq":
      return lv === want;
    case "neq":
      return lv !== want;
    case "in":
      return list(c.value).includes(lv);
    case "not_in":
      return !list(c.value).includes(lv);
    case "contains":
      return want !== "" && lv.includes(want);
    case "matches":
      try {
        return new RegExp(c.value ?? "", "i").test(v);
      } catch {
        return false;
      }
  }
}

/** Groups are ORed, their conditions ANDed; no group at all means "everything". */
export function conditionsHold(groups: ConditionGroup[], ctx: ConditionContext): boolean {
  const real = groups.filter((g) => g.all.length > 0);
  if (real.length === 0) return true;
  return real.some((g) => g.all.every((c) => conditionHolds(c, ctx)));
}

/** Legacy route filters, read as one AND group. */
export function legacyFiltersAsConditions(
  filters: Array<{ attribute: string; op: "eq" | "neq" | "in" | "exists"; value?: string }>,
): ConditionGroup[] {
  return filters.length ? [{ all: filters.map((f) => ({ ...f })) }] : [];
}

/* ---------- Priorities ---------- */

export type PriorityLike = {
  id: string;
  name: string;
  rank: number;
  aliases: string[];
  isDefault: boolean;
};

/** A priority by name or alias, case-insensitively. */
export function priorityByLabel<P extends PriorityLike>(
  prios: P[],
  label: string | null | undefined,
): P | null {
  if (!label) return null;
  const l = label.trim().toLowerCase();
  if (!l) return null;
  return (
    prios.find((p) => p.name.toLowerCase() === l) ??
    prios.find((p) => p.aliases.some((a) => a.toLowerCase() === l)) ??
    null
  );
}

/* ---------- Grouping ---------- */

/** The key a route groups alerts by: the values of the chosen attributes, or "*" for all. */
export function groupingKey(rule: GroupingRule, attributes: Record<string, string>): string {
  if (rule.by.length === 0) return "*";
  return rule.by.map((k) => `${k}=${(attributes[k] ?? "").toLowerCase()}`).join("|");
}

/* ---------- Merging ---------- */

/** Rankable: lower rank = more important, so "max" keeps the smallest rank. */
export function mergeAttribute(
  strategy: MergeStrategy,
  type: AlertAttributeType,
  previous: string | undefined,
  next: string | undefined,
  rankOf: (value: string) => number | null = () => null,
): string | undefined {
  if (!next) return previous;
  if (!previous) return next;
  switch (strategy) {
    case "first":
      return previous;
    case "last":
      return next;
    case "accumulate": {
      if (type !== "list") return next;
      const seen = new Set(
        previous
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      );
      for (const x of next.split(",")) if (x.trim()) seen.add(x.trim());
      return [...seen].join(", ");
    }
    case "max": {
      const a = rankOf(previous);
      const b = rankOf(next);
      if (a === null) return next;
      if (b === null) return previous;
      return b < a ? next : previous;
    }
  }
}

/** The attributes a repeat of the same alert leaves, strategy by strategy; unknown attributes replace. */
export function mergeAttributes(
  previous: Record<string, string>,
  next: Record<string, string>,
  registry: Array<{ key: string; type: AlertAttributeType; mergeStrategy: MergeStrategy }>,
  rankOf: (value: string) => number | null = () => null,
): Record<string, string> {
  const out: Record<string, string> = { ...previous };
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    const def = registry.find((r) => r.key === key);
    const merged = def
      ? mergeAttribute(def.mergeStrategy, def.type, previous[key], next[key], rankOf)
      : (next[key] ?? previous[key]);
    if (merged) out[key] = merged;
  }
  return out;
}

/* ---------- Discovery ---------- */

/** The string-valued paths of a payload, for the "click a field" mapping UI. */
export function payloadPaths(
  payload: unknown,
  prefix = "",
  depth = 0,
  out: Array<{ path: string; value: string }> = [],
): Array<{ path: string; value: string }> {
  if (depth > 5 || out.length > 200) return out;
  if (Array.isArray(payload)) {
    payload
      .slice(0, 10)
      .forEach((v, i) => payloadPaths(v, `${prefix}${prefix ? "." : ""}${i}`, depth + 1, out));
    return out;
  }
  if (payload && typeof payload === "object") {
    for (const [k, v] of Object.entries(payload as Record<string, unknown>))
      payloadPaths(v, `${prefix}${prefix ? "." : ""}${k}`, depth + 1, out);
    return out;
  }
  const s = str(payload);
  if (s && prefix) out.push({ path: prefix, value: s.slice(0, 120) });
  return out;
}

/** Attribute suggestions from a payload: field names people use for the same idea. */
const HINTS: Record<string, RegExp> = {
  service: /(^|[._])(service|svc|app|application|component)$/i,
  team: /(^|[._])(team|owner|squad)$/i,
  environment: /(^|[._])(env|environment|stage)$/i,
  region: /(^|[._])(region|zone|datacenter|dc|az)$/i,
  severity: /(^|[._])(severity|sev|level|urgency|priority|prio)$/i,
  cluster: /(^|[._])(cluster|namespace|host|hostname|instance|node)$/i,
};

export function suggestMappings(
  payload: unknown,
  attributeKeys: string[],
): Array<{ attribute: string; path: string; value: string }> {
  const paths = payloadPaths(payload);
  const out: Array<{ attribute: string; path: string; value: string }> = [];
  for (const key of attributeKeys) {
    const re = HINTS[key] ?? new RegExp(`(^|[._])${key.replace(/[^a-z0-9_]/gi, "")}$`, "i");
    const hit = paths.find((p) => re.test(p.path));
    if (hit) out.push({ attribute: key, path: hit.path, value: hit.value });
  }
  return out;
}
