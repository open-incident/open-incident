"use client";

import { useEffect, useState } from "react";

/**
 * Tout · Mises à jour · Épinglés — filters the rendered list in place by the
 * `data-kind` each event carries; nothing is refetched.
 */
export function TimelineFilterClient({
  labels,
}: {
  labels: { all: string; updates: string; pinned: string };
}) {
  const [mode, setMode] = useState<"all" | "updates" | "pinned">("all");
  useEffect(() => {
    const list = document.querySelector<HTMLElement>('[data-testid="timeline"]');
    if (!list) return;
    for (const li of list.querySelectorAll<HTMLElement>('[data-testid="timeline-event"]')) {
      const kind = li.dataset.kind;
      li.hidden =
        mode === "all"
          ? false
          : mode === "updates"
            ? kind !== "update"
            : kind !== "pinned" && li.querySelector("[aria-pressed='true']") === null;
    }
  }, [mode]);
  const seg = (id: typeof mode, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setMode(id)}
      aria-pressed={mode === id}
      style={{
        padding: "4px 11px",
        borderRadius: 7,
        border: 0,
        background: mode === id ? "var(--panel)" : "transparent",
        fontSize: 12,
        fontWeight: mode === id ? 600 : 500,
        color: mode === id ? "var(--ink)" : "var(--ink-3)",
        boxShadow: mode === id ? "var(--shadow-card)" : "none",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
  return (
    <div
      role="group"
      style={{ display: "flex", gap: 2, background: "var(--sunk)", borderRadius: 9, padding: 3 }}
    >
      {seg("all", labels.all)}
      {seg("updates", labels.updates)}
      {seg("pinned", labels.pinned)}
    </div>
  );
}
