/**
 * The reasoning behind a setting, folded.
 *
 * A settings screen used to explain every field in a paragraph under it,
 * which is right the first time and noise every time after. The label and the
 * field stay; the paragraph waits behind "Why this setting" for the reader who
 * wants it. Plain <details>: no script, and the text is still on the page for
 * search and for the guide's screenshots.
 */
export function Why({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
      <summary
        style={{
          cursor: "pointer",
          listStyle: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontWeight: 600,
          color: "var(--ink-3)",
          userSelect: "none",
        }}
      >
        <span aria-hidden style={{ fontSize: 9 }}>
          ▸
        </span>
        {label}
      </summary>
      <div style={{ marginTop: 6, maxWidth: 640 }}>{children}</div>
    </details>
  );
}
