/**
 * What a run's journal says, computed — pure functions over the rows of
 * `atlas_actions`, safe on both sides. Nothing here guesses: a figure that
 * cannot be read off the rows is absent, and the screen hides its sentence.
 */
import type { AtlasActionRow } from "@/lib/atlas/queries";

/** Undone and not redone since — the row is struck through and offers Redo. */
export function isUndone(a: Pick<AtlasActionRow, "undoneAt" | "redoneAt">): boolean {
  if (!a.undoneAt) return false;
  return !a.redoneAt || a.redoneAt.getTime() < a.undoneAt.getTime();
}

/** Something Atlas did — a step a person can take back (reversible, executed). */
export function canUndo(a: AtlasActionRow): boolean {
  // An Open Incident write is done when written; a system action when executed.
  const done = a.executedAt ?? (a.kind === "oi_write" ? a.at : null);
  return a.reversible && a.kind !== "read" && a.kind !== "human" && Boolean(done);
}

/** Minutes between two moments, rounded, or null when either is missing. */
export function minutesBetween(from: Date | null, to: Date | null): number | null {
  if (!from || !to) return null;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
}

/** What the run cost, step by step: the engine's own step label, else the action. */
export function costSteps(
  actions: AtlasActionRow[],
): Array<{ label: string; tokens: number; eur: number }> {
  const out = new Map<string, { label: string; tokens: number; eur: number }>();
  for (const a of actions) {
    if (a.costEur <= 0 && a.tokens <= 0) continue;
    const step = typeof a.payload.step === "string" && a.payload.step ? a.payload.step : a.title;
    const row = out.get(step) ?? { label: step, tokens: 0, eur: 0 };
    row.tokens += a.tokens;
    row.eur += a.costEur;
    out.set(step, row);
  }
  return [...out.values()];
}

/**
 * The gain one level up, from the run's own timings: at level 2 a reversible
 * system action waited for a person; at level 3 Atlas would have run it the
 * moment it proposed it. Null when the run gives no such measure — a level
 * other than 2, nothing proposed, nothing executed, or no wait to speak of.
 */
export function gainAtNextLevel(
  actions: AtlasActionRow[],
  levelAtRun: number | null,
): { action: AtlasActionRow; minutes: number; at: Date } | null {
  if (levelAtRun !== 2) return null;
  let best: { action: AtlasActionRow; minutes: number; at: Date } | null = null;
  for (const a of actions) {
    if (a.kind !== "system" || !a.reversible || a.approvalState !== "approved") continue;
    const m = minutesBetween(a.approvalRequestedAt, a.executedAt);
    if (m == null || m < 1 || !a.approvalRequestedAt) continue;
    if (!best || m > best.minutes) best = { action: a, minutes: m, at: a.approvalRequestedAt };
  }
  return best;
}

/** The steps worth naming in a sentence: what Atlas wrote or changed, not what it read. */
export function namedSteps(actions: AtlasActionRow[]): AtlasActionRow[] {
  return actions.filter((a) => a.kind === "oi_write" || a.kind === "system");
}
