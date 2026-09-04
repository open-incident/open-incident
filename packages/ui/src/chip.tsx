import type { CSSProperties, ReactNode } from "react";

/** Tones map to the token pairs of tokens.css: `--<tone>` for ink, `--<tone>-t` for the fill. */
export type ChipTone = "brand" | "ok" | "open" | "wait" | "dang" | "viol" | "mute";

/** Status / severity pill — 11.5px 600, tinted fill, never a border. */
export function Chip({
  tone = "mute",
  children,
  mono = false,
  style,
}: {
  tone?: ChipTone;
  children: ReactNode;
  mono?: boolean;
  style?: CSSProperties;
}) {
  const ink = tone === "mute" ? "var(--ink-2)" : `var(--${tone})`;
  const fill = tone === "mute" ? "var(--sunk)" : `var(--${tone}-t)`;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 22,
        padding: "0 8px",
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 600,
        color: ink,
        background: fill,
        fontFamily: mono ? "var(--font-mono)" : undefined,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
