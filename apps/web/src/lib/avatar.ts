/**
 * Avatar tones — the design assigns each person one of five tinted pairs from
 * a hash of the name, so the same person is always the same colour.
 */
const TONES: Array<[string, string]> = [
  ["var(--brand-t)", "var(--brand)"],
  ["var(--viol-t)", "var(--viol)"],
  ["var(--open-t)", "var(--open)"],
  ["var(--wait-t)", "var(--wait)"],
  ["var(--ok-t)", "var(--ok)"],
];

export function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const letters = parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return letters || "—";
}

export function avatarTone(name: string): { bg: string; ink: string } {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997;
  const tone = TONES[h % TONES.length]!;
  return { bg: tone[0], ink: tone[1] };
}
