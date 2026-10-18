/**
 * Opsgenie's routing, replayed: which of a team's rules an alert matches —
 * criteria and time restriction — the way Opsgenie decides it. Shadow mode
 * uses it for the Opsgenie side of the comparison; the Open Incident side
 * goes through the imported rules and the product's own matcher.
 */
import { restrictionWindows } from "./og-timeline";
import type { OgCondition, OgCriteria, OgRoutingRule, OgWebhookPayload } from "./types";

/** An alert as both sides read it. */
export type AlertView = {
  id: string;
  message: string;
  alias: string;
  description: string;
  source: string;
  entity: string;
  tags: string[];
  priority: string;
  details: Record<string, string>;
  teams: string[];
  createdAt: Date;
};

export function alertFromWebhook(p: OgWebhookPayload, receivedAt = new Date()): AlertView | null {
  const a = p.alert;
  if (!a?.alertId) return null;
  const teams = [
    ...(a.teams ?? []),
    ...(a.responders ?? []).filter((r) => r.type === "team").map((r) => r.id),
  ];
  return {
    id: a.alertId,
    message: String(a.message ?? ""),
    alias: String(a.alias ?? ""),
    description: String(a.description ?? ""),
    source: String(a.source ?? p.source?.name ?? ""),
    entity: String(a.entity ?? ""),
    tags: (a.tags ?? []).map(String),
    priority: String(a.priority ?? "P3").toUpperCase(),
    details: Object.fromEntries(Object.entries(a.details ?? {}).map(([k, v]) => [k, String(v)])),
    teams: [...new Set(teams)],
    createdAt: a.createdAt ? new Date(a.createdAt) : receivedAt,
  };
}

function fieldValue(c: OgCondition, a: AlertView): string | string[] | Record<string, string> {
  switch (c.field) {
    case "message":
      return a.message;
    case "alias":
      return a.alias;
    case "description":
      return a.description;
    case "source":
      return a.source;
    case "entity":
      return a.entity;
    case "priority":
      return a.priority;
    case "tags":
      return a.tags;
    case "teams":
      return a.teams;
    case "details":
    case "extra-properties":
      return c.key ? (a.details[c.key] ?? "") : a.details;
    default:
      return "";
  }
}

function test(op: OgCondition["operation"], value: string, expected: string): boolean {
  const v = value.toLowerCase();
  const e = expected.toLowerCase();
  switch (op) {
    case "equals":
      return v === e;
    case "equals-ignore-whitespace":
      return v.replace(/\s+/g, "") === e.replace(/\s+/g, "");
    case "contains":
      return v.includes(e);
    case "starts-with":
      return v.startsWith(e);
    case "ends-with":
      return v.endsWith(e);
    case "matches":
      try {
        return new RegExp(expected).test(value);
      } catch {
        return false;
      }
    case "is-empty":
      return value.trim() === "";
    case "greater-than":
    case "less-than": {
      const a = Number(value.replace(/\D/g, ""));
      const b = Number(expected.replace(/\D/g, ""));
      return op === "greater-than" ? a > b : a < b;
    }
    default:
      return false;
  }
}

export function ogConditionHolds(c: OgCondition, a: AlertView): boolean {
  const raw = fieldValue(c, a);
  const expected = c.expectedValue ?? "";
  let holds: boolean;
  if (Array.isArray(raw)) {
    holds =
      c.operation === "is-empty"
        ? raw.length === 0
        : raw.some((x) => test(c.operation, x, expected));
  } else if (typeof raw === "object") {
    holds =
      c.operation === "contains-key"
        ? expected in raw
        : c.operation === "contains-value"
          ? Object.values(raw).some((x) => x.toLowerCase() === expected.toLowerCase())
          : false;
  } else {
    holds = test(c.operation, raw, expected);
  }
  return c.not ? !holds : holds;
}

export function ogCriteriaHold(c: OgCriteria, a: AlertView): boolean {
  if (c.type === "match-all") return true;
  const conds = c.conditions ?? [];
  if (c.type === "match-any-condition") return conds.some((x) => ogConditionHolds(x, a));
  return conds.every((x) => ogConditionHolds(x, a));
}

/** The rule Opsgenie applies to an alert of this team: the first, in order, that matches. */
export function ogMatchRule(rules: OgRoutingRule[], a: AlertView): OgRoutingRule | null {
  const ordered = rules.slice().sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
  for (const r of ordered) {
    if (!ogCriteriaHold(r.criteria, a)) continue;
    if (r.timeRestriction) {
      const at = a.createdAt;
      const windows = restrictionWindows(
        r.timeRestriction,
        new Date(at.getTime() - 1),
        new Date(at.getTime() + 1),
        r.timezone ?? "UTC",
      );
      if (windows && !windows.some((w) => w.start <= at.getTime() && w.end > at.getTime()))
        continue;
    }
    return r;
  }
  return null;
}

/** The labels an Opsgenie alert carries here: what the imported rules read. */
export function attributesOf(a: AlertView, p5ToP4: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(a.details)) if (v) out[k] = v;
  for (const t of a.tags) {
    const m = t.match(/^([\w.-]+):(.+)$/);
    if (m && !out[m[1]!]) out[m[1]!] = m[2]!;
  }
  if (a.tags.length) out.tags = a.tags.join(", ");
  if (a.alias) out.alias = a.alias;
  if (a.entity) out.entity = a.entity;
  if (a.description) out.description = a.description;
  if (a.source) out.source_name = a.source;
  out.priority = p5ToP4 && a.priority === "P5" ? "P4" : a.priority;
  if (!out.environment && out.env) out.environment = out.env;
  return out;
}
