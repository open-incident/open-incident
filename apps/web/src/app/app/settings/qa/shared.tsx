import type { QaStatus, QaSuite } from "@openincident/db";
import type { Tone } from "@/components/settings/template";

export const SUITE_ORDER: QaSuite[] = ["smoke", "unit", "typecheck", "lint", "format"];

/** The chip of a run's state, in the template's tones. */
export function statusTone(status: QaStatus): Tone {
  switch (status) {
    case "passed":
      return "ok";
    case "failed":
    case "error":
      return "dang";
    case "queued":
    case "running":
      return "open";
    default:
      return "mute";
  }
}

/** The row's dot: green, red, blue while it waits or runs, grey when stopped. */
export function statusDot(status: QaStatus | null): string {
  if (!status) return "var(--line)";
  const tone = statusTone(status);
  return tone === "ok"
    ? "var(--ok)"
    : tone === "dang"
      ? "var(--dang)"
      : tone === "open"
        ? "var(--open)"
        : "var(--ink-3)";
}

export function isAlive(status: QaStatus): boolean {
  return status === "queued" || status === "running";
}

/** "38 s", "6 min 12 s". */
export function durationLabel(start: Date | null, end: Date | null): string {
  if (!start) return "—";
  const ms = (end ?? new Date()).getTime() - start.getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(s % 60).padStart(2, "0")} s`;
}
