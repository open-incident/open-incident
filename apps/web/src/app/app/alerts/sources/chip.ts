/** The chip the three choices are picked with — selected carries the brand, the rest a hairline. */
export function chipStyle(on: boolean): React.CSSProperties {
  return {
    height: 32,
    padding: "0 12px",
    border: on ? "1.5px solid var(--brand)" : "1px solid var(--line)",
    borderRadius: 9,
    background: on ? "var(--brand-t)" : "var(--panel)",
    color: on ? "var(--brand)" : "var(--ink-2)",
    display: "flex",
    alignItems: "center",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  };
}
