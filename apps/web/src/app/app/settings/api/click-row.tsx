"use client";

import type { CSSProperties, ReactNode } from "react";
import { Chip, type ChipSpec } from "@/components/settings/template";

/**
 * A list row on the settings template that opens something when clicked —
 * the design's `it.click`. The template's ListItem only links; a row that
 * opens a dialog (an endpoint, a browser application) needs a click, and a
 * button inside it (Send test) must not trigger the row.
 */
export function ClickRow({
  glyph,
  dot,
  title,
  titleMono,
  sub,
  chips,
  right,
  button,
  onOpen,
  testId,
  data,
}: {
  glyph?: { text: string; bg?: string; ink?: string };
  dot?: string;
  title: ReactNode;
  titleMono?: boolean;
  sub?: ReactNode;
  chips?: ChipSpec[];
  right?: ReactNode;
  button?: ReactNode;
  onOpen?: () => void;
  testId?: string;
  data?: Record<string, string>;
}) {
  const style: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "11px 18px",
    borderTop: "1px solid var(--line-2)",
    cursor: onOpen ? "pointer" : "default",
    flexWrap: "wrap",
  };
  const dataAttrs = Object.fromEntries(
    Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]),
  );
  return (
    <div
      data-testid={testId}
      {...dataAttrs}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (onOpen && (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen();
        }
      }}
      className="oi-hover"
      style={style}
    >
      {glyph && (
        <span
          aria-hidden
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: glyph.bg ?? "var(--sunk)",
            color: glyph.ink ?? "var(--ink)",
            display: "grid",
            placeItems: "center",
            fontSize: 11,
            fontWeight: 700,
            flex: "none",
            letterSpacing: "-.02em",
          }}
        >
          {glyph.text}
        </span>
      )}
      {dot && (
        <span
          aria-hidden
          style={{ width: 9, height: 9, borderRadius: "50%", background: dot, flex: "none" }}
        />
      )}
      <div style={{ flex: "1 1 240px", minWidth: 0 }}>
        <div
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            fontFamily: titleMono ? "var(--mono)" : "inherit",
            lineHeight: 1.45,
            overflowWrap: "anywhere",
          }}
        >
          {title}
        </div>
        {sub && (
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 1, lineHeight: 1.45 }}>
            {sub}
          </div>
        )}
      </div>
      {chips && chips.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
          {chips.map((c, i) => (
            <Chip key={i} tone={c.tone} testId={c.testId}>
              {c.label}
            </Chip>
          ))}
        </div>
      )}
      {right && (
        <span style={{ fontSize: 12, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{right}</span>
      )}
      {button && (
        <span
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          style={{ display: "flex", gap: 6, alignItems: "center" }}
        >
          {button}
        </span>
      )}
    </div>
  );
}
