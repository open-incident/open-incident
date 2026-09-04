/**
 * Coverage — where a schedule has nobody. Pure: the schedule's rotations and
 * overrides are sampled every quarter hour over a horizon and the uncovered
 * samples are merged into gaps. Expected coverage is what the rotations
 * declare: a business-hours rotation is not expected at night, so its nights
 * are not gaps; an empty rotation, a turn with nobody, or a null-member
 * override inside the expected window are.
 */
import {
  sampleOnCall,
  type OverrideLike,
  type RotationLike,
  type ScheduleLike,
  type TurnCache,
} from "./rotation";

export type CoverageGap = { startAt: Date; endAt: Date; minutes: number };

export type Coverage = {
  from: Date;
  to: Date;
  /** Share of the expected horizon with at least one person on call, 0–1. */
  coveredRatio: number;
  gaps: CoverageGap[];
  /** Minutes without anyone, in total. */
  uncoveredMinutes: number;
};

export const COVERAGE_HORIZON_DAYS = 60;
const STEP_MINUTES = 15;

export function coverageOf(
  schedule: ScheduleLike,
  rotations: RotationLike[],
  overrides: OverrideLike[],
  from: Date,
  to: Date,
  stepMinutes = STEP_MINUTES,
): Coverage {
  const step = stepMinutes * 60_000;
  const gaps: CoverageGap[] = [];
  let open: { startAt: Date } | null = null;
  let covered = 0;
  let total = 0;
  const cache: TurnCache = new Map();
  for (let t = from.getTime(); t < to.getTime(); t += step) {
    const at = new Date(t);
    const sample = sampleOnCall(schedule, rotations, overrides, at, cache);
    if (!sample.expected) {
      if (open) {
        gaps.push({
          startAt: open.startAt,
          endAt: at,
          minutes: (t - open.startAt.getTime()) / 60_000,
        });
        open = null;
      }
      continue;
    }
    total++;
    if (sample.members.size > 0) {
      covered++;
      if (open) {
        gaps.push({
          startAt: open.startAt,
          endAt: at,
          minutes: (t - open.startAt.getTime()) / 60_000,
        });
        open = null;
      }
    } else if (!open) {
      open = { startAt: at };
    }
  }
  if (open)
    gaps.push({
      startAt: open.startAt,
      endAt: to,
      minutes: (to.getTime() - open.startAt.getTime()) / 60_000,
    });
  const uncoveredMinutes = gaps.reduce((n, g) => n + g.minutes, 0);
  return { from, to, coveredRatio: total ? covered / total : 1, gaps, uncoveredMinutes };
}

/** The gaps that start within the next `days` — what a reminder is about. */
export function upcomingGaps(coverage: Coverage, now: Date, days: number): CoverageGap[] {
  const limit = now.getTime() + days * 86_400_000;
  return coverage.gaps.filter(
    (g) => g.endAt.getTime() > now.getTime() && g.startAt.getTime() < limit,
  );
}
