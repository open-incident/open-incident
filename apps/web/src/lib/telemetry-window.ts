/**
 * The window a chart board reads, and the resolution it reads it at.
 *
 * One rule for Metrics and for a monitor's charts: a named range ("1h",
 * "24h") ending now, or — when somebody dragged one out — the two instants in
 * the address. The step is chosen so a chart carries about eighty points
 * whatever the width, which is what makes a zoom worth doing: four minutes
 * dragged out of a day come back at ten seconds a point, not at the day's
 * fifteen minutes cut into four.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The steps a bucket may have, finest first. Every one divides a day. */
const STEPS = [
  10 * SECOND,
  15 * SECOND,
  30 * SECOND,
  MINUTE,
  2 * MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
];

/** The smallest step that keeps the window under `points` buckets, and not under `min`. */
export function pickStep(spanMs: number, opts: { points?: number; min?: number } = {}): number {
  const want = spanMs / (opts.points ?? 80);
  const floor = opts.min ?? 0;
  return STEPS.find((s) => s >= want && s >= floor) ?? DAY;
}

export type Window = {
  /** The named range the bar shows as selected (still set when zoomed). */
  range: string;
  from: number;
  to: number;
  /** A dragged window is in the address. */
  zoomed: boolean;
};

/**
 * Reads `range`, `from` and `to` from the address. A zoom narrower than a
 * minute is widened to one: a window of nothing is a screen of nothing.
 */
export function resolveWindow(
  sp: { range?: string; from?: string; to?: string },
  ranges: Record<string, number>,
  fallback: string,
  anchor = Date.now(),
): Window {
  const range = sp.range && sp.range in ranges ? sp.range : fallback;
  const a = Number(sp.from);
  const b = Number(sp.to);
  if (Number.isFinite(a) && Number.isFinite(b) && b > a && a > 0) {
    const span = Math.max(MINUTE, b - a);
    return { range, from: a, to: a + span, zoomed: true };
  }
  return { range, from: anchor - ranges[range]!, to: anchor, zoomed: false };
}

/** Bucket starts covering [from, to], aligned on the step from the epoch. */
export function bucketStarts(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let t = Math.floor(from / step) * step; t <= to; t += step) out.push(t);
  return out;
}

/** Puts values on the grid: a bucket nobody reported is a hole, not a zero. */
export function onGrid(
  grid: number[],
  values: Map<number, number>,
): Array<[number, number | null]> {
  return grid.map((t) => [t, values.has(t) ? values.get(t)! : null]);
}

export const RANGE_MS = { SECOND, MINUTE, HOUR, DAY };
