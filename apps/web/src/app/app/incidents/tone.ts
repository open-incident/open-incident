/**
 * The colour pairs the incident screens paint with — the design's, read by
 * rank rather than by label, so a renamed severity or status keeps its colour.
 */
import type { Tone } from "@/lib/tones";

const SEVERITY: Tone[] = [
  { bg: "var(--dang-t)", ink: "var(--dang)" },
  { bg: "var(--wait-t)", ink: "var(--wait)" },
  { bg: "var(--viol-t)", ink: "var(--viol)" },
  { bg: "var(--sunk)", ink: "var(--ink-2)" },
];

/** SEV1 danger, SEV2 wait, SEV3 violet, SEV4 muted; no severity at all: nothing to paint. */
export function severityTone(rank: number | null | undefined): Tone {
  if (rank === null || rank === undefined) return { bg: "transparent", ink: "var(--ink-3)" };
  return SEVERITY[Math.min(rank, SEVERITY.length - 1)]!;
}

/**
 * The status of an incident as the design paints it: triage waits, the first
 * status of the lifecycle (investigating) is danger, the ones in between
 * (fixing) violet, the last one (monitoring) green, post-incident blue and a
 * closed incident muted. Statuses are the workspace's own, so the position in
 * the type's lifecycle decides, never the word.
 */
export function statusTone(
  phase: "triage" | "active" | "post_incident" | "closed",
  status?: { rank: number | null; last: boolean } | null,
): Tone {
  if (phase === "triage") return { bg: "var(--wait-t)", ink: "var(--wait)" };
  if (phase === "post_incident") return { bg: "var(--open-t)", ink: "var(--open)" };
  if (phase === "closed") return { bg: "var(--sunk)", ink: "var(--ink-3)" };
  if (status?.last && (status.rank ?? 0) > 0) return { bg: "var(--ok-t)", ink: "var(--ok)" };
  if (status && status.rank !== null && status.rank > 0)
    return { bg: "var(--viol-t)", ink: "var(--viol)" };
  return { bg: "var(--dang-t)", ink: "var(--dang)" };
}

/** The ink of the status column. */
export function statusInk(
  phase: "triage" | "active" | "post_incident" | "closed",
  status?: { rank: number | null; last: boolean } | null,
): string {
  return statusTone(phase, status).ink;
}
