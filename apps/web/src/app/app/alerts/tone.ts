/**
 * The priority chip of the alert screens.
 *
 * `priorityTone` in `lib/tones` greys everything below P2; the alerts design
 * keeps P3 blue and only mutes P4 and below, so the chip has its own table —
 * by rank, never by label, so a renamed priority keeps its colour.
 */
export type Chip = { bg: string; ink: string };

const BY_RANK: Chip[] = [
  { bg: "var(--dang-t)", ink: "var(--dang)" },
  { bg: "var(--wait-t)", ink: "var(--wait)" },
  { bg: "var(--open-t)", ink: "var(--open)" },
];

export function priorityChip(rank: number | null | undefined): Chip {
  if (rank === null || rank === undefined) return { bg: "var(--sunk)", ink: "var(--ink-2)" };
  return BY_RANK[rank] ?? { bg: "var(--sunk)", ink: "var(--ink-2)" };
}
