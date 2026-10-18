/**
 * A rule as the design writes it — "If label service = billing-db" and, under
 * it, "→ page Payments · open an incident at SEV2" — and the few shapes the
 * "New rule" dialog can hold.
 *
 * Pure: no database, no server import. The page builds the sentences on the
 * server; the dialog's server action reuses the same reading to decide what a
 * choice changes. What a rule *does* is read exactly as the ingest pipeline
 * reads it (`apps/web/src/lib/alert-ingest.ts`): the escalation rules, or the
 * legacy columns they replaced; the incident template, or the legacy mode.
 */
import type {
  ConditionGroup,
  EscalationRule,
  IncidentTemplate,
  alertRoutes,
} from "@openincident/db";
import type { MessageKey } from "@/i18n/dictionaries/en";
import type { MessageParams } from "@/i18n/dictionary";
import { sourceKindMeta } from "@/lib/alert-sources";

export type RouteRow = typeof alertRoutes.$inferSelect;
export type T = (key: MessageKey, params?: MessageParams) => string;

export type RuleRefs = {
  sources: Array<{ id: string; name: string; kind: string }>;
  paths: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string; policyPathId: string | null }>;
  severities: Array<{ id: string; name: string }>;
  priorities: Array<{ id: string; name: string; rank: number }>;
};

/** One piece of the "→ …" line; Atlas's parts are drawn in violet. */
export type ThenPart = { text: string; atlas?: boolean };

/**
 * A route is a rule when somebody wrote it to apply to something: a
 * condition, or a chosen set of sources — the pipeline's own test. Anything
 * else is the shared fallback the sources' three choices are laid over.
 */
export function isRule(r: Pick<RouteRow, "sourceIds" | "conditions" | "filters">): boolean {
  return (
    r.sourceIds.length > 0 || r.conditions.some((g) => g.all.length > 0) || r.filters.length > 0
  );
}

export function conditionsOf(r: Pick<RouteRow, "conditions" | "filters">): ConditionGroup[] {
  const groups: ConditionGroup[] =
    r.conditions.length > 0 ? r.conditions : r.filters.length ? [{ all: r.filters }] : [];
  return groups.filter((g) => g.all.length > 0);
}

/** Who a route pages — its rules, or what its legacy columns meant. */
export function escalationsOf(r: RouteRow): EscalationRule[] {
  if (r.escalations.length > 0) return r.escalations;
  if (r.escalationMode === "static")
    return r.escalationPathId ? [{ kind: "path", pathId: r.escalationPathId }] : [];
  if (r.escalationMode === "dynamic")
    return [{ kind: "attribute", attribute: "service", fallbackPathId: r.escalationPathId }];
  return [];
}

export const DEFAULT_INCIDENT: IncidentTemplate = {
  mode: "conditional",
  typeId: null,
  startPhase: "triage",
  severity: { mode: "priority" },
  visibility: "public",
  customFields: {},
  declineOnResolve: true,
};

/** The incident a route opens — its template, or what the legacy mode meant. */
export function incidentOf(r: RouteRow): IncidentTemplate {
  if (r.incident) return r.incident;
  const always = r.incidentMode === "always";
  return {
    ...DEFAULT_INCIDENT,
    mode: r.incidentMode,
    typeId: r.incidentTypeId,
    startPhase: always ? "active" : "triage",
    severity: always ? { mode: "priority" } : { mode: "none" },
    declineOnResolve: false,
  };
}

/* ---------- The sentence ---------- */

function joinOr(items: string[], t: T): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${t("settingsV2.rules.s.or")} ${items[items.length - 1]}`;
}

const listOf = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * "P1 or P2", "P3 or lower": a set of severities in the words a person uses.
 * Names keep the workspace's spelling; unknown ones are said as they are.
 */
export function severityList(names: string[], refs: RuleRefs, t: T): string {
  const byName = (n: string) =>
    refs.priorities.find((p) => p.name.toLowerCase() === n.toLowerCase());
  const known = names.map(byName);
  if (known.every(Boolean) && names.length >= 2) {
    const ranks = known.map((p) => p!.rank).sort((a, b) => a - b);
    const all = [...refs.priorities].sort((a, b) => a.rank - b.rank);
    const first = ranks[0]!;
    const tail = all.filter((p) => p.rank >= first);
    const contiguous = ranks.length === tail.length && ranks.every((r, i) => r === tail[i]!.rank);
    if (contiguous && first > 0)
      return t("settingsV2.rules.s.orLower", { name: all.find((p) => p.rank === first)!.name });
    return joinOr(
      [...known].sort((a, b) => a!.rank - b!.rank).map((p) => p!.name),
      t,
    );
  }
  return joinOr(
    names.map((n) => byName(n)?.name ?? n),
    t,
  );
}

function opText(op: string, value: string | undefined, t: T): string {
  const v = value ?? "";
  switch (op) {
    case "eq":
      return `= ${v}`;
    case "neq":
      return `≠ ${v}`;
    case "in":
      return t("settingsV2.rules.s.oneOf", { list: listOf(v).join(", ") });
    case "not_in":
      return t("settingsV2.rules.s.noneOf", { list: listOf(v).join(", ") });
    case "contains":
      return `${t("settingsV2.rules.s.contains")} ${v}`;
    case "matches":
      return `${t("settingsV2.rules.s.matches")} ${v}`;
    case "exists":
      return t("settingsV2.rules.s.isSet");
    case "missing":
      return t("settingsV2.rules.s.isMissing");
    default:
      return `${op} ${v}`;
  }
}

/** "If source is Datadog and severity is P1 or P2 and env = production". */
export function whenSentence(
  r: Pick<RouteRow, "sourceIds" | "conditions" | "filters">,
  refs: RuleRefs,
  t: T,
): string {
  const and = ` ${t("settingsV2.rules.s.and")} `;
  const head: string[] = [];
  if (r.sourceIds.length > 0)
    head.push(
      t("settingsV2.rules.s.sourceIs", {
        name: joinOr(
          r.sourceIds.map((id) => refs.sources.find((s) => s.id === id)?.name ?? "?"),
          t,
        ),
      }),
    );
  const groups = conditionsOf(r).map((g) => {
    // "label" is said once, before the first label of the sentence.
    let labelSaid = false;
    return g.all
      .map((c) => {
        switch (c.attribute) {
          case "source":
            if (c.op === "eq" || c.op === "in")
              return t("settingsV2.rules.s.sourceIs", {
                name: joinOr(
                  listOf(c.value).map((k) => sourceKindMeta(k)?.short ?? k),
                  t,
                ),
              });
            break;
          case "source_name":
            if (c.op === "eq") return t("settingsV2.rules.s.sourceIs", { name: c.value ?? "" });
            break;
          case "source_id":
            if (c.op === "eq")
              return t("settingsV2.rules.s.sourceIs", {
                name: refs.sources.find((s) => s.id === c.value)?.name ?? "?",
              });
            break;
          case "priority":
            if (c.op === "eq" || c.op === "in")
              return t("settingsV2.rules.s.severityIs", {
                list: severityList(listOf(c.value), refs, t),
              });
            break;
          case "title":
            return t("settingsV2.rules.s.title", { condition: opText(c.op, c.value, t) });
        }
        const text = `${c.attribute} ${opText(c.op, c.value, t)}`;
        if (labelSaid) return text;
        labelSaid = true;
        return t("settingsV2.rules.s.label", { condition: text });
      })
      .join(and);
  });
  const body =
    groups.length > 1
      ? groups.map((g) => `(${g})`).join(` ${t("settingsV2.rules.s.or")} `)
      : (groups[0] ?? "");
  const all = [...head, ...(body ? [body] : [])];
  return `${t("settingsV2.rules.s.if")} ${all.length ? all.join(and) : t("settingsV2.rules.s.anySource")}`;
}

/** The team a path is the policy of, when exactly one team uses it; the path's own name otherwise. */
export function pathWho(pathId: string | null, refs: RuleRefs): string {
  if (!pathId) return "?";
  const teams = refs.teams.filter((x) => x.policyPathId === pathId);
  if (teams.length === 1) return teams[0]!.name;
  return refs.paths.find((p) => p.id === pathId)?.name ?? "?";
}

/** "→ ✦ never let Atlas act · page Payments" — in pieces, Atlas's marked. */
export function thenParts(r: RouteRow, refs: RuleRefs, t: T): ThenPart[] {
  const out: ThenPart[] = [];
  if (r.atlasDirective === "never")
    out.push({ text: t("settingsV2.rules.s.atlasNever"), atlas: true });
  if (r.atlasDirective === "handle")
    out.push({ text: t("settingsV2.rules.s.atlasHandle"), atlas: true });
  const esc = escalationsOf(r);
  const inc = incidentOf(r);
  if (esc.length === 0 && inc.mode === "never") {
    out.push({ text: t("settingsV2.rules.s.mute") });
    return out;
  }
  const pages = esc.map((e) =>
    e.kind === "path"
      ? t("settingsV2.rules.s.page", { who: pathWho(e.pathId, refs) })
      : e.attribute === "service"
        ? t("settingsV2.rules.s.pageOwner")
        : e.attribute === "team"
          ? t("settingsV2.rules.s.pageTeam")
          : t("settingsV2.rules.s.pageFrom", { key: e.attribute }),
  );
  const sev =
    inc.severity.mode === "static"
      ? (refs.severities.find(
          (s) => s.id === (inc.severity as { severityId: string | null }).severityId,
        )?.name ?? null)
      : null;
  const incident =
    inc.mode === "always"
      ? sev
        ? t("settingsV2.rules.s.incidentAt", { severity: sev })
        : t("settingsV2.rules.s.incident")
      : inc.mode === "conditional"
        ? t("settingsV2.rules.s.incidentIfWakes")
        : null;
  if (pages.length === 0) {
    if (incident) out.push({ text: incident });
    out.push({ text: t("settingsV2.rules.s.pageNobody") });
  } else {
    for (const p of pages) out.push({ text: p });
    if (incident) out.push({ text: incident });
  }
  return out;
}

/* ---------- What the dialog holds ---------- */

export type Option = { value: string; label: string };

/** The design's four severity choices, generalised to the workspace's own levels. */
export function severityOptions(refs: RuleRefs, t: T): Option[] {
  const ps = [...refs.priorities].sort((a, b) => a.rank - b.rank);
  const opt = (names: string[]): Option => ({
    value: `in:${names.join(",")}`,
    label: severityList(names, refs, t),
  });
  const out: Option[] = [{ value: "any", label: t("settingsV2.rules.o.any") }];
  ps.forEach((p, i) => {
    out.push(opt([p.name]));
    if (i === 0 && ps.length >= 2) out.push(opt([ps[0]!.name, ps[1]!.name]));
    if (i === 2 && ps.length >= 4) out.push(opt(ps.slice(2).map((x) => x.name)));
  });
  return out;
}

/** Page each team, page the paths no team uses, the owner, an incident per severity, Atlas, mute. */
export function thenOptions(refs: RuleRefs, t: T): Option[] {
  const out: Option[] = [];
  for (const team of refs.teams)
    if (team.policyPathId)
      out.push({
        value: `team:${team.id}`,
        label: t("settingsV2.rules.o.page", { who: team.name }),
      });
  for (const p of refs.paths)
    if (!refs.teams.some((x) => x.policyPathId === p.id))
      out.push({ value: `path:${p.id}`, label: t("settingsV2.rules.o.page", { who: p.name }) });
  out.push({ value: "owner", label: t("settingsV2.rules.o.pageOwner") });
  for (const s of refs.severities)
    out.push({
      value: `incident:${s.id}`,
      label: t("settingsV2.rules.o.incidentAt", { severity: s.name }),
    });
  out.push({ value: "atlas:handle", label: t("settingsV2.rules.o.atlasHandle") });
  out.push({ value: "atlas:never", label: t("settingsV2.rules.o.atlasNever") });
  out.push({ value: "mute", label: t("settingsV2.rules.o.mute") });
  return out;
}

export type DialogValues = {
  source: string;
  severity: string;
  label: string;
  then: string;
};

/**
 * The rule as the dialog's four fields, or null when it says more than they
 * can hold — several groups of conditions, several sources, a condition on
 * the title, two people to page… Those open the full editor instead, so
 * nothing a rule says is lost by saving it from a smaller form.
 */
export function dialogValues(r: RouteRow, refs: RuleRefs): DialogValues | null {
  const groups = conditionsOf(r);
  if (groups.length > 1 || r.sourceIds.length > 1) return null;
  let severity = "any";
  let label = "";
  for (const c of groups[0]?.all ?? []) {
    if (c.attribute === "priority") {
      if (severity !== "any" || (c.op !== "eq" && c.op !== "in")) return null;
      const names = listOf(c.value);
      if (names.length === 0) return null;
      const ranked = names
        .map((n) => refs.priorities.find((p) => p.name.toLowerCase() === n.toLowerCase()))
        .filter(Boolean)
        .sort((a, b) => a!.rank - b!.rank)
        .map((p) => p!.name);
      severity = `in:${(ranked.length === names.length ? ranked : names).join(",")}`;
      continue;
    }
    if (["source", "source_name", "source_id", "title"].includes(c.attribute)) return null;
    if (label || (c.op !== "eq" && c.op !== "neq")) return null;
    label = `${c.attribute} ${c.op === "eq" ? "=" : "!="} ${c.value ?? ""}`;
  }
  let then: string | null = null;
  const esc = escalationsOf(r);
  const inc = incidentOf(r);
  if (esc.some((e) => e.when && e.when.length > 0) || esc.length > 1) return null;
  if (r.atlasDirective) then = `atlas:${r.atlasDirective}`;
  else if (esc.length === 0 && inc.mode === "never") then = "mute";
  else if (esc[0]?.kind === "path") {
    const pathId = esc[0].pathId;
    const team = refs.teams.find((x) => x.policyPathId === pathId);
    then = team ? `team:${team.id}` : `path:${pathId}`;
  } else if (esc[0]?.kind === "attribute" && esc[0].attribute === "service") then = "owner";
  else if (esc.length === 0 && inc.mode === "always" && inc.severity.mode === "static")
    then = inc.severity.severityId ? `incident:${inc.severity.severityId}` : null;
  if (!then) return null;
  return { source: r.sourceIds[0] ?? "", severity, label, then };
}

/** "env = production", "env != staging" — the dialog's one label. */
export function parseLabel(text: string): { key: string; op: "eq" | "neq"; value: string } | null {
  const m = /^\s*([A-Za-z0-9_.-]{1,60})\s*(=|!=|≠)\s*(.{1,300}?)\s*$/.exec(text);
  if (!m) return null;
  return { key: m[1]!, op: m[2] === "=" ? "eq" : "neq", value: m[3]! };
}
