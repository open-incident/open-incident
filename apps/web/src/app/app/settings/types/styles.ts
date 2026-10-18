import type { CSSProperties } from "react";

/**
 * Small styles shared by the incident settings screens (types, severities,
 * fields, announcements) — plain values, usable on the server and the client.
 */

/** A list inside a ListModal: a bordered block of rows. */
export const listBoxStyle: CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 12,
  overflow: "hidden",
};

/** One row of such a list. */
export function listRowStyle(first: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 12px",
    borderTop: first ? undefined : "1px solid var(--line-2)",
    fontSize: 13,
  };
}

/** The small square icon buttons of a list row — ▲ ▼ ✕. */
export function iconButtonStyle(disabled: boolean, danger?: boolean): CSSProperties {
  return {
    width: 26,
    height: 26,
    borderRadius: 7,
    border: "1px solid var(--line)",
    background: "var(--panel)",
    display: "grid",
    placeItems: "center",
    fontSize: 11,
    color: disabled ? "var(--line)" : danger ? "var(--dang)" : "var(--ink-2)",
    cursor: disabled ? "default" : "pointer",
    flex: "none",
    padding: 0,
  };
}

/** A danger text button at the foot of an edit dialog — "Delete this field". */
export const dangerLinkStyle: CSSProperties = {
  alignSelf: "flex-start",
  background: "transparent",
  border: 0,
  padding: 0,
  fontSize: 12.5,
  fontWeight: 600,
  color: "var(--dang)",
  cursor: "pointer",
  fontFamily: "inherit",
};
