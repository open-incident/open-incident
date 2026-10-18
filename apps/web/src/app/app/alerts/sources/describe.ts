/**
 * The words the three choices are shown with, on the cards, on the source page
 * and in the connect dialog — written once so the chip and the card can never
 * disagree.
 */
import type { MessageParams } from "@/i18n/dictionary";
import type { MessageKey } from "@/i18n/dictionaries/en";
import type { IncidentChoice, PageChoice } from "./choices";

/** Enough of `t` for a label: the server's and the client's both satisfy it. */
export type Labeller = (key: MessageKey, params?: MessageParams) => string;

/** An alert severity as the chips need it. */
export type Level = { rank: number; name: string; urgent: boolean };

export function describePage(t: Labeller, page: PageChoice, readerId: string): string {
  switch (page.kind) {
    case "owner":
      return t("alt2.choice.page.owner");
    case "member":
      return page.memberId === readerId ? t("alt2.choice.page.me") : page.name;
    case "team":
    case "schedule":
    case "path":
      return page.name;
    case "nobody":
      return t("alt2.choice.page.nobody");
  }
}

/** The least important severity the workspace marked urgent — where "only when urgent" starts. */
export function urgentLevel(levels: Level[]): Level | null {
  const urgent = levels.filter((l) => l.urgent);
  return urgent.length ? urgent.reduce((a, b) => (b.rank > a.rank ? b : a)) : null;
}

/** "when an alert P1/P2 arrives" — the urgent severities, which are the ones that page. */
export function pageNote(t: Labeller, levels: Level[]): string {
  const urgent = levels.filter((l) => l.urgent).map((l) => l.name);
  return urgent.length
    ? t("alst.choice.pageNoteFor", { priorities: urgent.join("/") })
    : t("alt2.choice.pageNote");
}

/** The rank an "only from …" answer really opens from: its own, else the urgent one. */
function effectiveRank(fromRank: number | null, levels: Level[]): number | null {
  return fromRank ?? urgentLevel(levels)?.rank ?? null;
}

function fromLabel(t: Labeller, rank: number | null, levels: Level[]): string {
  const level = levels.find((l) => l.rank === rank);
  return level
    ? t("alt2.choice.incident.urgentFrom", { priority: level.name })
    : t("alt2.choice.incident.urgent");
}

export function describeIncident(
  t: Labeller,
  incident: IncidentChoice,
  fromRank: number | null,
  levels: Level[],
): string {
  if (incident === "triage") return t("alt2.choice.incident.triage");
  if (incident === "never") return t("alt2.choice.incident.never");
  return fromLabel(t, effectiveRank(fromRank, levels), levels);
}

/**
 * The chips of "Open an incident": in triage, from the second severity, from
 * the first, never — the design's four. A source that still follows the
 * workspace's urgency from another severity keeps a chip saying so, selected,
 * rather than a selection that silently moved.
 */
export function incidentOptions(
  t: Labeller,
  incident: IncidentChoice,
  fromRank: number | null,
  levels: Level[],
): Array<{ value: string; label: string; on: boolean }> {
  const rank = incident === "urgent" ? effectiveRank(fromRank, levels) : null;
  const top = levels.filter((l) => l.rank <= 1).sort((a, b) => b.rank - a.rank);
  const out = [
    { value: "triage", label: t("alt2.choice.incident.triage"), on: incident === "triage" },
  ];
  for (const l of top)
    out.push({
      value: `from:${l.rank}`,
      label: t("alt2.choice.incident.urgentFrom", { priority: l.name }),
      on: incident === "urgent" && rank === l.rank,
    });
  if (incident === "urgent" && !top.some((l) => l.rank === rank))
    out.push({ value: "urgent", label: fromLabel(t, rank, levels), on: true });
  out.push({ value: "never", label: t("alt2.choice.incident.never"), on: incident === "never" });
  return out;
}
