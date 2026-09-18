/**
 * The colour pairs the incident screens paint with — the design's, read by
 * rank rather than by label, so a renamed severity keeps its colour.
 */
import { phaseTone, type Tone } from "@/lib/tones";

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

/** The ink of the status column: the phase's tone, the status's when it has one. */
export function statusInk(
  phase: "triage" | "active" | "post_incident" | "closed",
  statusName: string | null,
  statuses?: Array<{ name: string; rank: number }>,
): string {
  const idx = statuses?.findIndex((s) => s.name === statusName) ?? -1;
  return phaseTone(phase, null, idx >= 0 ? idx : null, statuses?.length).ink;
}
