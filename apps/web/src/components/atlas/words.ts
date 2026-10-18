/**
 * The sentences the ladder's criteria turn into — one place, so the service
 * card's ✓ / … list and the "needs … to get there" of the Atlas tab say the
 * same thing the same way.
 */
import type { Translate } from "@/i18n/server";
import { journalTitle } from "@/lib/atlas/text";
import type { Criterion } from "@/lib/atlas/levels";
import type { AtlasActionRow } from "@/lib/atlas/queries";

/** The engine's sentence key of a journal row ("atlas.j.paged"…) and its parameters. */
export function journalText(a: Pick<AtlasActionRow, "payload">): {
  key: string | null;
  params: Record<string, string | number>;
} {
  const text = a.payload?.text as { key?: unknown; params?: unknown } | undefined;
  return {
    key: typeof text?.key === "string" ? text.key : null,
    params:
      text?.params && typeof text.params === "object"
        ? (text.params as Record<string, string | number>)
        : {},
  };
}

/** The fix itself, without the journal's verb: what was proposed, or what was done. */
export function fixName(a: Pick<AtlasActionRow, "title" | "payload" | "executedAt">): string {
  const p = a.payload ?? {};
  if (a.executedAt && typeof p.done === "string" && p.done) return p.done;
  if (typeof p.todo === "string" && p.todo) return p.todo;
  return a.title;
}

/**
 * A journal row in the reader's language: the engine stores its fixed
 * sentences as a dictionary key (`payload.text`), and an English `title` for
 * the API and the chat. What the model wrote is shown as it was written.
 */
export function actionTitle(t: Translate, a: Pick<AtlasActionRow, "title" | "payload">): string {
  return journalTitle(a, t);
}

const pct = (t: Translate, n: number | null) => (n == null ? "—" : t.fmt.decimal(n, 0));

/** "18 of 20 graded runs", "94 % right (≥ 90 %)", "Backtest 88 % (≥ 85 %)"… */
export function criterionLine(t: Translate, c: Criterion): string {
  switch (c.key) {
    case "gradedRuns":
      return t("atlas.ui.crit.gradedRuns", { current: c.current ?? 0, target: c.target });
    case "rightPct":
      return t("atlas.ui.crit.rightPct", { current: pct(t, c.current), target: c.target });
    case "backtestPct":
      return t("atlas.ui.crit.backtestPct", { current: pct(t, c.current), target: c.target });
    case "proposalsOk":
      return t("atlas.ui.crit.proposalsOk", { current: c.current ?? 0, target: c.target });
    case "l3FixesOk":
      return t("atlas.ui.crit.l3FixesOk", { current: c.current ?? 0, target: c.target });
    case "noMissDays":
      return t("atlas.ui.crit.noMissDays", { target: c.target });
    case "incidentsSeen":
      return t("atlas.ui.crit.incidentsSeen", { current: c.current ?? 0, target: c.target });
    case "rightSinceDrop":
      return t("atlas.ui.crit.rightSinceDrop", { current: c.current ?? 0, target: c.target });
    default:
      return String(c.key);
  }
}

/** What is still missing: "3 more graded runs", "90 % right (now 84 %)"… */
export function criterionNeed(t: Translate, c: Criterion): string {
  const gap = Math.max(1, Math.ceil(c.target - (c.current ?? 0)));
  switch (c.key) {
    case "gradedRuns":
      return t("atlas.ui.need.gradedRuns", { count: gap });
    case "rightPct":
      return t("atlas.ui.need.rightPct", { current: pct(t, c.current), target: c.target });
    case "backtestPct":
      return c.current == null
        ? t("atlas.ui.need.backtestNone", { target: c.target })
        : t("atlas.ui.need.backtestPct", { current: pct(t, c.current), target: c.target });
    case "proposalsOk":
      return t("atlas.ui.need.proposalsOk", { count: gap });
    case "l3FixesOk":
      return t("atlas.ui.need.l3FixesOk", { count: gap });
    case "noMissDays":
      return t("atlas.ui.need.noMissDays", { target: c.target });
    case "incidentsSeen":
      return t("atlas.ui.need.incidentsSeen", { count: gap });
    case "rightSinceDrop":
      return t("atlas.ui.need.rightSinceDrop", { count: gap });
    default:
      return String(c.key);
  }
}

/**
 * Who approved a proposal: the member the row names, else the journal's own
 * "… approved: …" step that followed it.
 */
export function approverOf(
  actions: AtlasActionRow[],
  a: AtlasActionRow,
  names: Map<string, string>,
): string | null {
  if (a.approvedByMemberId) return names.get(a.approvedByMemberId) ?? null;
  if (a.approvalState !== "approved") return null;
  const step = actions.find(
    (x) =>
      x.kind === "human" &&
      x.at.getTime() >= a.at.getTime() &&
      journalText(x).key === "atlas.j.approved",
  );
  if (!step) return null;
  const member = journalText(step).params.member;
  if (typeof member === "string") return member;
  return step.decidedByMemberId ? (names.get(step.decidedByMemberId) ?? null) : null;
}
