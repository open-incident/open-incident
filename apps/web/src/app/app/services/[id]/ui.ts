/** The card and the eyebrow every block of the service page is built from — the design's. */
import type { CSSProperties } from "react";

export const CARD: CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
  padding: "14px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

export const EYEBROW: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".08em",
  color: "var(--ink-3)",
};
