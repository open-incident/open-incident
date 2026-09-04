/**
 * Uptime and the 30-day bars, from the impact history — pure functions.
 * An interval is a stretch during which a component was not operational.
 */
export type ImpactInterval = { state: string; fromAt: Date; toAt: Date | null };

const DAY = 86_400_000;
const WEIGHT: Record<string, number> = {
  operational: 0,
  maintenance: 0,
  degraded: 1,
  partial_outage: 2,
  major_outage: 3,
};

/** Share of the window during which the component was up, as a percentage with two decimals. */
export function computeUptime(intervals: ImpactInterval[], from: Date, to: Date): number {
  const window = to.getTime() - from.getTime();
  if (window <= 0) return 100;
  let down = 0;
  for (const i of intervals) {
    if ((WEIGHT[i.state] ?? 0) === 0) continue;
    const a = Math.max(i.fromAt.getTime(), from.getTime());
    const b = Math.min((i.toAt ?? to).getTime(), to.getTime());
    if (b > a) down += b - a;
  }
  return Math.round((1 - down / window) * 10_000) / 100;
}

/** One entry per day, oldest first: the worst state seen that day ("operational" when none). */
export function dayTicks(intervals: ImpactInterval[], days: number, now: Date): string[] {
  const out: string[] = [];
  const endOfToday = new Date(now.getTime());
  endOfToday.setUTCHours(23, 59, 59, 999);
  for (let d = days - 1; d >= 0; d--) {
    const dayEnd = endOfToday.getTime() - d * DAY;
    const dayStart = dayEnd - DAY + 1;
    let worst = "operational";
    for (const i of intervals) {
      const a = i.fromAt.getTime();
      const b = (i.toAt ?? now).getTime();
      if (b < dayStart || a > dayEnd) continue;
      if ((WEIGHT[i.state] ?? 0) > (WEIGHT[worst] ?? 0)) worst = i.state;
    }
    out.push(worst);
  }
  return out;
}

/** The overall state of a page from its components: the worst one wins. */
export function overallState(
  states: string[],
): "operational" | "degraded" | "partial_outage" | "major_outage" | "maintenance" {
  const order = [
    "operational",
    "maintenance",
    "degraded",
    "partial_outage",
    "major_outage",
  ] as const;
  let worst: (typeof order)[number] = "operational";
  for (const s of states) {
    const idx = order.indexOf(s as (typeof order)[number]);
    if (idx > order.indexOf(worst)) worst = order[idx]!;
  }
  return worst;
}

/** Severity rank → public impact: SEV1 is an outage, SEV2/SEV3 degrade, below is informational. */
export function impactForSeverityRank(
  rank: number | null,
): "none" | "degraded" | "partial_outage" | "major_outage" {
  if (rank === null) return "degraded";
  if (rank === 0) return "major_outage";
  if (rank <= 2) return "degraded";
  return "none";
}

export function componentStateForImpact(
  impact: string,
): "operational" | "degraded" | "partial_outage" | "major_outage" {
  return impact === "major_outage"
    ? "major_outage"
    : impact === "partial_outage"
      ? "partial_outage"
      : impact === "degraded"
        ? "degraded"
        : "operational";
}
