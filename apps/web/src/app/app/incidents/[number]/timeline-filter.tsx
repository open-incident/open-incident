"use client";

import { useEffect, useState } from "react";

type Mode = "all" | "atlas" | "updates" | "pinned";

/**
 * All · ✦ By Atlas · Updates · Pinned — pills that filter the rendered list in
 * place by what each event carries (`data-atlas`, `data-kind`, its pin);
 * nothing is refetched, and a live refresh keeps the chosen filter.
 */
export function TimelineFilterClient({
  labels,
  counts,
}: {
  labels: Record<Mode, string>;
  counts: Record<Mode, number>;
}) {
  const [mode, setMode] = useState<Mode>("all");
  useEffect(() => {
    const list = document.querySelector<HTMLElement>('[data-testid="timeline"]');
    if (!list) return;
    for (const li of list.querySelectorAll<HTMLElement>('[data-testid="timeline-event"]')) {
      const kind = li.dataset.kind;
      li.hidden =
        mode === "all"
          ? false
          : mode === "atlas"
            ? li.dataset.atlas !== "1"
            : mode === "updates"
              ? kind !== "update"
              : kind !== "pinned" && li.querySelector("[aria-pressed='true']") === null;
    }
  }, [mode, counts]);
  const pill = (id: Mode) => {
    const on = mode === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => setMode(id)}
        aria-pressed={on}
        data-testid={`timeline-filter-${id}`}
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
        {labels[id]}
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, marginLeft: 5, opacity: 0.7 }}>
          {counts[id]}
        </span>
      </button>
    );
  };
  return (
    <div role="group" style={{ display: "flex", gap: 2 }}>
      {pill("all")}
      {pill("atlas")}
      {pill("updates")}
      {pill("pinned")}
    </div>
  );
}
