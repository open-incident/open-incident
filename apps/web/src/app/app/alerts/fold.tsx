"use client";

import { useState } from "react";

/**
 * A card that opens: the payload of an alert, the advanced settings of a
 * source. The header is the whole control, and the right-hand word says which
 * way it will go — the design's "show raw" / "hide".
 */
export function Fold({
  title,
  hint,
  showLabel,
  hideLabel,
  padding,
  children,
}: {
  title: string;
  hint?: string;
  showLabel: string;
  hideLabel: string;
  /** The header's padding — 12px 16px on the alert, 12px 18px on the source. */
  padding: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          padding,
          cursor: "pointer",
          fontSize: 13.5,
          fontWeight: 600,
          background: "none",
          border: 0,
          textAlign: "left",
          color: "inherit",
        }}
      >
        {title}
        {hint && (
          <span
            style={{
              fontSize: 12,
              color: "var(--ink-3)",
              fontWeight: 500,
              marginLeft: 10,
            }}
          >
            {hint}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 500 }}>
          {open ? hideLabel : showLabel}
        </span>
      </button>
      {open && children}
    </div>
  );
}
