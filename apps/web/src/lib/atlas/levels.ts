/**
 * The autonomy ladder (spec delta §15.1) — pure data, safe on both sides.
 *
 * CONTRACT shared by the Atlas engine and every screen that shows a level.
 * Owner: atlas-core. Readers: everyone. Change a name here, not in a screen.
 */
import type { AutonomyLevel } from "@openincident/db";

export type { AutonomyLevel };

export type LevelDef = {
  level: AutonomyLevel;
  /** "Observe", "Investigate", "Propose", "Act & tell", "Resolve" — dictionary key atlas.level.<n>.name */
  key: "observe" | "investigate" | "propose" | "act" | "resolve";
  /** Defaults to reach this level from the one below. */
  reach: {
    incidentsSeen?: number;
    gradedRuns?: number;
    rightPct?: number;
    backtestPct?: number;
    proposalsOk?: number;
    l3FixesOk?: number;
    /** No Miss in the last N days. */
    noMissDays?: number;
  };
};

export const LEVELS: readonly LevelDef[] = [
  { level: 0, key: "observe", reach: {} },
  { level: 1, key: "investigate", reach: { incidentsSeen: 5 } },
  { level: 2, key: "propose", reach: { gradedRuns: 10, rightPct: 80 } },
  {
    level: 3,
    key: "act",
    reach: { gradedRuns: 20, rightPct: 90, backtestPct: 85, proposalsOk: 5 },
  },
  {
    level: 4,
    key: "resolve",
    reach: { gradedRuns: 40, rightPct: 95, l3FixesOk: 10, noMissDays: 30 },
  },
] as const;

/** An admin can only cap: the level that applies is the lower of the two. */
export function effectiveLevel(level: number, cap: number | null | undefined): AutonomyLevel {
  const l = Math.max(0, Math.min(4, level));
  return (cap == null ? l : Math.min(l, Math.max(0, Math.min(4, cap)))) as AutonomyLevel;
}

/** Undo of an autonomous action, or a Miss: one level down. Nowhere near, or a reopen: back to L1. */
export function levelAfter(
  level: number,
  cause: "undo" | "miss" | "nowhere_near" | "reopen",
): AutonomyLevel {
  if (cause === "undo" || cause === "miss") return Math.max(0, level - 1) as AutonomyLevel;
  return Math.min(level, 1) as AutonomyLevel;
}

/** Undo stays possible this long after an autonomous resolution. */
export const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

export type Criterion = {
  key: keyof LevelDef["reach"];
  target: number;
  current: number | null;
  met: boolean;
};

/** What separates a service from the next level — the ✓ / … list of the service card. */
export function nextLevelCriteria(row: {
  level: number;
  incidentsSeen: number;
  gradedRuns: number;
  rightPct: number | null;
  backtestPct: number | null;
  proposalsOk: number;
  l3FixesOk: number;
  lastMissAt: Date | null;
}): { next: LevelDef | null; criteria: Criterion[] } {
  const next = LEVELS[row.level + 1] ?? null;
  if (!next) return { next: null, criteria: [] };
  const daysSinceMiss = row.lastMissAt
    ? (Date.now() - row.lastMissAt.getTime()) / 86_400_000
    : Infinity;
  const values: Record<keyof LevelDef["reach"], number | null> = {
    incidentsSeen: row.incidentsSeen,
    gradedRuns: row.gradedRuns,
    rightPct: row.rightPct,
    backtestPct: row.backtestPct,
    proposalsOk: row.proposalsOk,
    l3FixesOk: row.l3FixesOk,
    noMissDays: Number.isFinite(daysSinceMiss) ? Math.floor(daysSinceMiss) : null,
  };
  const criteria = (Object.entries(next.reach) as Array<[keyof LevelDef["reach"], number]>).map(
    ([key, target]) => {
      const current = values[key];
      const met =
        key === "noMissDays"
          ? current == null || current >= target
          : current != null && current >= target;
      return { key, target, current, met };
    },
  );
  return { next, criteria };
}
