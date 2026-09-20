/**
 * Service level objectives, and the arithmetic that decides when to page.
 *
 * The indicator is a ratio: how many events met the bar, over how many there
 * were. The objective says what fraction has to. What is left of the
 * difference is the **error budget**, and the rate at which it is being spent
 * is the **burn rate** — one meaning "at this pace the whole month's allowance
 * is gone in a day".
 *
 * Paging on the burn rate rather than on the objective is the point. An SLO of
 * 99.9 % over a month is still reading 99.9 % an hour into a total outage,
 * because one hour is a small part of a month: waiting for the monthly figure
 * to move is waiting for the month to end. The burn rate moves immediately.
 *
 * Two windows are used together, per the multi-window recipe every SRE team
 * ends up at. A short window alone is jumpy and pages for a blip; a long
 * window alone is slow and misses the first hour. Requiring both to agree
 * gives an alert that is fast and does not fire on noise.
 */
import { evalPromql } from "./promql/eval";
import { parsePromql, type Node } from "./promql/parse";

/**
 * How fast the budget has to burn to be worth waking somebody.
 *
 * 14.4 is the rate at which a 30-day budget is gone in about two days — it is
 * the conventional threshold, and the arithmetic behind it is that 1 hour at
 * 14.4× spends 2 % of a 30-day allowance. Six is the slower one: it spends 5 %
 * in six hours, which is not an emergency but is not a Tuesday either.
 */
export const FAST_BURN = 14.4;
export const SLOW_BURN = 6;

/** The pairs: a long window for the signal, a short one to confirm it is still true. */
export const FAST_WINDOWS = { long: 60, short: 5 } as const;
export const SLOW_WINDOWS = { long: 360, short: 30 } as const;

export type SloDefinition = {
  goodQuery: string;
  totalQuery: string;
  /** As a percentage: 99.9 allows one failure in a thousand. */
  objective: number;
  windowKind: "rolling" | "calendar";
  windowDays: number;
};

export type SloReading = {
  /** The ratio over the whole objective window, as a percentage. */
  sli: number;
  good: number;
  total: number;
  /** 1 means untouched, 0 means spent, below 0 means overspent. */
  budgetLeft: number;
  fastBurn: number;
  slowBurn: number;
  /** Null when the window held no events at all: an SLI of nothing is not 100 %. */
  empty: boolean;
};

export class SloError extends Error {}

/**
 * Reads one SLO: the window, and the two burn rates.
 *
 * Four evaluations rather than one, because the burn windows are not slices of
 * the objective window — they are their own questions asked of the same two
 * expressions.
 */
export async function readSlo(
  tenantId: string,
  slo: SloDefinition,
  at: Date = new Date(),
): Promise<SloReading> {
  const from = windowStart(slo, at);
  const [whole, fast, slow] = await Promise.all([
    ratio(tenantId, slo, from, at),
    ratio(tenantId, slo, new Date(at.getTime() - FAST_WINDOWS.long * 60_000), at),
    ratio(tenantId, slo, new Date(at.getTime() - SLOW_WINDOWS.long * 60_000), at),
  ]);

  const allowed = 1 - slo.objective / 100;
  if (allowed <= 0) {
    throw new SloError("an objective of 100 % allows no failure at all, so it has no budget");
  }

  // An empty window is not a perfect one. Reporting 100 % for a service that
  // sent nothing is the single most misleading thing an SLO can do: it is the
  // reading a broken exporter produces, and it is indistinguishable from
  // flawless.
  const empty = whole.total === 0;
  const sli = empty ? 0 : (whole.good / whole.total) * 100;
  const spent = empty ? 0 : (1 - whole.good / whole.total) / allowed;

  return {
    sli,
    good: whole.good,
    total: whole.total,
    budgetLeft: 1 - spent,
    fastBurn: burnOf(fast, allowed),
    slowBurn: burnOf(slow, allowed),
    empty,
  };
}

/** The short confirming windows, read only when a long one has already tripped. */
export async function confirmBurn(
  tenantId: string,
  slo: SloDefinition,
  minutes: number,
  at: Date = new Date(),
): Promise<number> {
  const allowed = 1 - slo.objective / 100;
  return burnOf(await ratio(tenantId, slo, new Date(at.getTime() - minutes * 60_000), at), allowed);
}

function burnOf(r: { good: number; total: number }, allowed: number): number {
  if (r.total === 0) return 0;
  return (1 - r.good / r.total) / allowed;
}

/**
 * Both expressions over one range, summed.
 *
 * Summed rather than read as an instant value: an SLI counts events over a
 * period, and `sum_over_time` is what the author would have had to write
 * otherwise. Every series the expression returns is added together — an SLI
 * split by route is still one ratio, and leaving the reader to write the
 * aggregation is how two of the three SLOs in a workspace end up wrong.
 */
async function ratio(
  tenantId: string,
  slo: SloDefinition,
  from: Date,
  to: Date,
): Promise<{ good: number; total: number }> {
  const [good, total] = await Promise.all([
    sumOver(tenantId, slo.goodQuery, from, to),
    sumOver(tenantId, slo.totalQuery, from, to),
  ]);
  if (good > total) {
    throw new SloError(
      `the good count (${round(good)}) is above the total (${round(total)}); the two expressions are not counting the same thing`,
    );
  }
  return { good, total };
}

/**
 * The most points an objective window is read at.
 *
 * Above it the query is refused rather than quietly coarsened, because
 * coarsening is what makes an SLI wrong: `increase(x[5m])` sampled every hour
 * counts five minutes out of every sixty and reports a twelfth of the traffic
 * as the whole of it.
 */
export const MAX_POINTS = 20_000;

async function sumOver(tenantId: string, query: string, from: Date, to: Date): Promise<number> {
  /*
   * The step is the expression's own range, and that is not a detail.
   *
   * An SLI sums a counter's increase over a window, so the slices have to
   * tile it: consecutive, no gap, no overlap. A step finer than the range
   * counts the same events several times; a step coarser than it skips the
   * gaps between samples. Either way the ratio is wrong by a factor nobody
   * would spot, because it still looks like a plausible percentage.
   */
  const step = rangeOf(query) ?? 60_000;
  const points = Math.ceil((to.getTime() - from.getTime()) / step) + 1;
  if (points > MAX_POINTS) {
    throw new SloError(
      `reading ${Math.round((to.getTime() - from.getTime()) / 86_400_000)} days at the ` +
        `${Math.round(step / 60_000)}-minute range of this expression would take ${points} points. ` +
        `Widen the range in the expression, or shorten the window.`,
    );
  }
  const series = await evalPromql(tenantId, query, {
    start: from.getTime(),
    end: to.getTime(),
    stepMs: step,
    maxPoints: MAX_POINTS,
  });
  let sum = 0;
  for (const s of series) {
    for (const p of s.points) if (Number.isFinite(p.v)) sum += p.v;
  }
  return sum;
}

/** Where the objective window begins. */
export function windowStart(slo: SloDefinition, at: Date): Date {
  if (slo.windowKind === "calendar") {
    return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  }
  return new Date(at.getTime() - slo.windowDays * 86_400_000);
}

/**
 * What a reading means, in one word.
 *
 * `fast` and `slow` are separate because they are different instructions: drop
 * what you are doing, versus look at this today. Collapsing them would make
 * the second as loud as the first, and within a month nobody would answer
 * either.
 */
export function burnVerdict(reading: {
  fastBurn: number;
  slowBurn: number;
  empty: boolean;
}): "ok" | "slow" | "fast" {
  if (reading.empty) return "ok";
  if (reading.fastBurn >= FAST_BURN) return "fast";
  if (reading.slowBurn >= SLOW_BURN) return "slow";
  return "ok";
}

/** How long the remaining budget lasts at the current pace, in hours. */
export function hoursLeft(budgetLeft: number, burn: number, windowDays: number): number | null {
  if (burn <= 0 || budgetLeft <= 0) return null;
  return (budgetLeft * windowDays * 24) / burn;
}

function round(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : String(n);
}

/**
 * The narrowest range vector in an expression, in milliseconds.
 *
 * The narrowest rather than the first, because a query can carry more than
 * one, and stepping at the widest would skip part of what the narrowest was
 * counting. Null when the expression has no range at all — a gauge, say —
 * in which case a minute is the grid the storage itself has.
 */
export function rangeOf(query: string): number | null {
  let narrowest: number | null = null;
  const walk = (node: Node): void => {
    if (node.kind === "selector" && node.range !== undefined) {
      narrowest = narrowest === null ? node.range : Math.min(narrowest, node.range);
    }
    for (const child of children(node)) walk(child);
  };
  walk(parsePromql(query));
  return narrowest;
}

function children(node: Node): Node[] {
  const n = node as Record<string, unknown>;
  const out: Node[] = [];
  for (const value of Object.values(n)) {
    if (Array.isArray(value)) {
      for (const v of value) if (isNode(v)) out.push(v);
    } else if (isNode(value)) {
      out.push(value);
    }
  }
  return out;
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && "kind" in value;
}
