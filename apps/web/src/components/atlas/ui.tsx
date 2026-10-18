/**
 * The small pieces every Atlas surface shares — pure presentation, safe on
 * both sides. Atlas is always violet with the ✦ glyph; the journal's four
 * kinds of step keep the same letter and tint wherever they appear.
 */
import type { CSSProperties } from "react";
import type { AtlasActionKind } from "@openincident/db";
import { LEVELS } from "@/lib/atlas/levels";

export const panel: CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};

export const eyebrow: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};

/** A source pill: "Datadog #4207231", "F1 · pool saturation". */
export const sourcePill: CSSProperties = {
  fontSize: 10.5,
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "1px 7px",
  color: "var(--ink-2)",
  whiteSpace: "nowrap",
  maxWidth: 260,
  overflow: "hidden",
  textOverflow: "ellipsis",
};

export type Tone = "ok" | "wait" | "viol" | "mute" | "dang" | "brand";

export const TONE: Record<Tone, { bg: string; ink: string }> = {
  ok: { bg: "var(--ok-t)", ink: "var(--ok)" },
  wait: { bg: "var(--wait-t)", ink: "var(--wait)" },
  viol: { bg: "var(--viol-t)", ink: "var(--viol)" },
  mute: { bg: "var(--sunk)", ink: "var(--ink-2)" },
  dang: { bg: "var(--dang-t)", ink: "var(--dang)" },
  brand: { bg: "var(--brand-t)", ink: "var(--brand)" },
};

/** The journal's chips: autonomous, waiting for approval 38 min, reversible, verified 03:50… */
export function Chip({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        borderRadius: 999,
        padding: "1px 8px",
        background: TONE[tone].bg,
        color: TONE[tone].ink,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

/** R read · O written in Open Incident · S on your systems · ✎ a person. */
export const KIND: Record<AtlasActionKind, { letter: string; bg: string; ink: string }> = {
  read: { letter: "R", bg: "var(--sunk)", ink: "var(--ink-2)" },
  oi_write: { letter: "O", bg: "var(--brand-t)", ink: "var(--brand)" },
  system: { letter: "S", bg: "var(--wait-t)", ink: "var(--wait)" },
  human: { letter: "✎", bg: "var(--ok-t)", ink: "var(--ok)" },
};

export function KindBadge({ kind, size = 18 }: { kind: AtlasActionKind; size?: 16 | 18 }) {
  const k = KIND[kind];
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: size === 18 ? 6 : 5,
        background: k.bg,
        color: k.ink,
        display: "grid",
        placeItems: "center",
        fontSize: size === 18 ? 10 : 9,
        fontWeight: 700,
        marginTop: size === 18 ? 1 : 0,
      }}
    >
      {k.letter}
    </span>
  );
}

/** The ladder's key for a level, for the dictionary: atlas.level.<key>. */
export function levelKey(level: number) {
  return (LEVELS[Math.max(0, Math.min(4, level))] ?? LEVELS[0]!).key;
}

/** Five segments; the next one partly filled by the progress toward it (0–1). */
export function LevelBar({
  level,
  progress,
  height = 6,
}: {
  level: number;
  progress?: number | null;
  height?: number;
}) {
  return (
    <div style={{ display: "flex", gap: 4 }} aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => {
        const filled = i <= level;
        const partial = i === level + 1 && progress != null && progress > 0;
        const pct = Math.round(Math.min(1, Math.max(0, progress ?? 0)) * 100);
        return (
          <span
            key={i}
            style={{
              flex: 1,
              height,
              borderRadius: 999,
              background: filled
                ? "var(--viol)"
                : partial
                  ? `linear-gradient(90deg,var(--viol) ${pct}%,var(--line) ${pct}%)`
                  : "var(--line)",
            }}
          />
        );
      })}
    </div>
  );
}

/** "61 k tokens", "820 tokens" — the run's size, the way the bar writes it. */
export function tokensShort(n: number): { k: boolean; value: number } {
  return n >= 1000 ? { k: true, value: Math.round(n / 1000) } : { k: false, value: n };
}

/** The bottom-centre message of the design, after an action. */
export function toastStyle(): CSSProperties {
  return {
    position: "fixed",
    left: "50%",
    bottom: 24,
    transform: "translateX(-50%)",
    zIndex: 90,
    background: "var(--topbar-dark)",
    color: "#fff",
    borderRadius: 10,
    padding: "10px 16px",
    fontSize: 13,
    fontWeight: 500,
    boxShadow: "var(--shadow-pop)",
    maxWidth: "90vw",
  };
}
