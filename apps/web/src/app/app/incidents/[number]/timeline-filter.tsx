"use client";

import { useEffect, useState } from "react";

/**
 * All · Updates · Pinned — three pills that filter the rendered list in place
 * by the `data-kind` each event carries; nothing is refetched.
 */
export function TimelineFilterClient({
  labels,
  counts,
}: {
  labels: { all: string; updates: string; pinned: string };
  counts: { all: number; updates: number; pinned: number };
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
  const pill = (id: typeof mode, label: string, count: number) => {
    const on = mode === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => setMode(id)}
        aria-pressed={on}
        style={{
          height: 24,
          padding: "0 10px",
          borderRadius: 999,
          border: 0,
          background: on ? "var(--sunk)" : "transparent",
          fontSize: 11.5,
          fontWeight: on ? 600 : 500,
          color: on ? "var(--ink)" : "var(--ink-3)",
          display: "flex",
          alignItems: "center",
          cursor: "pointer",
        }}
      >
        {label}
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, marginLeft: 5, opacity: 0.7 }}>
          {count}
        </span>
      </button>
    );
  };
  return (
    <div role="group" style={{ display: "flex", gap: 2 }}>
      {pill("all", labels.all, counts.all)}
      {pill("updates", labels.updates, counts.updates)}
      {pill("pinned", labels.pinned, counts.pinned)}
    </div>
  );
}
