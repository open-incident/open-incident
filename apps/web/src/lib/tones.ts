/**
 * The design's colour vocabulary for the product's states, as token pairs
 * [fill, ink]. Statuses are configurable per workspace, so the mapping goes
 * through what the product knows — the phase, the public status a status maps
 * to, the rank of a severity or a priority — never through a label.
 */
export type Tone = { bg: string; ink: string };

export const TONES = {
  triage: { bg: "var(--viol-t)", ink: "var(--viol)" },
  investigating: { bg: "var(--open-t)", ink: "var(--open)" },
  monitoring: { bg: "var(--wait-t)", ink: "var(--wait)" },
  postIncident: { bg: "var(--brand-t)", ink: "var(--brand)" },
  closed: { bg: "var(--sunk)", ink: "var(--ink-2)" },
  resolved: { bg: "var(--ok-t)", ink: "var(--ok)" },
  danger: { bg: "var(--dang-t)", ink: "var(--dang)" },
  neutral: { bg: "var(--sunk)", ink: "var(--ink-2)" },
} as const satisfies Record<string, Tone>;

export function phaseTone(
  phase: "triage" | "active" | "post_incident" | "closed",
  publicStatus?: string | null,
  statusRank?: number | null,
  statusCount?: number,
): Tone {
  if (phase === "triage") return TONES.triage;
  if (phase === "post_incident") return TONES.postIncident;
  if (phase === "closed") return TONES.closed;
  if (publicStatus === "monitoring") return TONES.monitoring;
  if (publicStatus) return TONES.investigating;
  // A status with no public mapping: the last of the lifecycle is the watching one.
  if (
    statusRank !== null &&
    statusRank !== undefined &&
    statusCount &&
    statusRank === statusCount - 1
  )
    return TONES.monitoring;
  return TONES.investigating;
}

/** SEV1 danger, SEV2 wait, SEV3 open, SEV4 muted — by rank, so a renamed level keeps its colour. */
export function severityInk(rank: number | null | undefined): string {
  if (rank === null || rank === undefined) return "var(--ink-3)";
  return ["var(--dang)", "var(--wait)", "var(--open)", "var(--ink-3)"][Math.min(rank, 3)]!;
}

/** P1 danger, P2 wait, P3+ muted. */
export function priorityTone(rank: number | null | undefined): Tone {
  if (rank === 0) return TONES.danger;
  if (rank === 1) return TONES.monitoring;
  return TONES.neutral;
}
