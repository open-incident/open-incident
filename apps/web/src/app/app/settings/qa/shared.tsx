import type { QaStatus, QaSuite } from "@openincident/db";

export const SUITE_ORDER: QaSuite[] = ["smoke", "unit", "typecheck", "lint", "format"];

export function statusTone(status: QaStatus): { bg: string; ink: string } {
  switch (status) {
    case "passed":
      return { bg: "var(--ok-t)", ink: "var(--ok)" };
    case "failed":
    case "error":
      return { bg: "var(--dang-t)", ink: "var(--dang)" };
    case "running":
      return { bg: "var(--brand-t)", ink: "var(--brand)" };
    case "cancelled":
      return { bg: "var(--sunk)", ink: "var(--ink-3)" };
    default:
      return { bg: "var(--wait-t)", ink: "var(--wait)" };
  }
}

export function durationLabel(start: Date | null, end: Date | null): string {
  if (!start) return "—";
  const ms = (end ?? new Date()).getTime() - start.getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(s % 60).padStart(2, "0")} s`;
}

export const chip = (tone: { bg: string; ink: string }): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "2px 9px",
  borderRadius: 999,
  background: tone.bg,
  color: tone.ink,
  fontSize: 11.5,
  fontWeight: 700,
  whiteSpace: "nowrap",
});

export const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 14,
  padding: "14px 16px",
  boxShadow: "var(--shadow-card)",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

export const button = (tone: "primary" | "plain" | "danger"): React.CSSProperties => ({
  height: 32,
  padding: "0 13px",
  borderRadius: 9,
  border: tone === "primary" ? 0 : `1px solid ${tone === "danger" ? "var(--dang)" : "var(--line)"}`,
  background: tone === "primary" ? "var(--brand)" : "var(--panel)",
  color: tone === "primary" ? "#fff" : tone === "danger" ? "var(--dang)" : "var(--ink)",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
});
