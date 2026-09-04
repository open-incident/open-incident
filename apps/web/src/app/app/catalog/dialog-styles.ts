/** Shared look of the catalog dialogs — the design's 540 px modal. */
export const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};
export const control: React.CSSProperties = {
  height: 38,
  padding: "0 12px",
  border: "1px solid var(--line)",
  borderRadius: 10,
  outline: "none",
  fontSize: 13,
  background: "var(--panel)",
  width: "100%",
};
export const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 12 };
export const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(13,18,19,.52)",
  display: "grid",
  placeItems: "center",
  padding: 24,
  zIndex: 60,
};
export const sheet: React.CSSProperties = {
  width: 540,
  maxWidth: "100%",
  maxHeight: "calc(100vh - 48px)",
  overflow: "auto",
  background: "var(--panel)",
  borderRadius: 18,
  boxShadow: "var(--shadow-modal)",
};
export const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "16px 20px",
  borderBottom: "1px solid var(--line)",
};
export const title: React.CSSProperties = {
  fontFamily: "var(--font-title)",
  fontSize: 16.5,
  fontWeight: 600,
};
export const body: React.CSSProperties = {
  padding: "18px 20px",
  display: "flex",
  flexDirection: "column",
  gap: 13,
};
export const footer: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "14px 20px",
  borderTop: "1px solid var(--line)",
};
export const primary: React.CSSProperties = {
  height: 34,
  padding: "0 16px",
  borderRadius: 9,
  background: "var(--brand)",
  color: "#fff",
  border: 0,
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
export const secondary: React.CSSProperties = {
  height: 34,
  padding: "0 13px",
  border: "1px solid var(--line)",
  borderRadius: 9,
  background: "var(--panel)",
  fontSize: 12.5,
  cursor: "pointer",
};
export const danger: React.CSSProperties = {
  ...secondary,
  color: "var(--dang)",
  borderColor: "var(--dang)",
};
export const toolbarButton: React.CSSProperties = {
  height: 34,
  padding: "0 14px",
  borderRadius: 9,
  background: "var(--panel)",
  color: "var(--ink-2)",
  border: "1px solid var(--line)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
export const alert: React.CSSProperties = {
  margin: 0,
  padding: "10px 12px",
  borderRadius: 10,
  background: "var(--dang-t)",
  border: "1px solid var(--dang)",
  color: "var(--dang)",
  fontSize: 13,
  whiteSpace: "pre-wrap",
};
export const closeButton: React.CSSProperties = {
  marginLeft: "auto",
  width: 30,
  height: 30,
  borderRadius: 8,
  border: 0,
  background: "transparent",
  color: "var(--ink-3)",
  cursor: "pointer",
  fontSize: 14,
};
