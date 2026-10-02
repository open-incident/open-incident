import type { ReactNode } from "react";

/**
 * The reading layout of a settings form.
 *
 * One form, numbered sections, one Save. A section explains itself on the
 * left — number, title, one sentence, and the longer reasoning folded under
 * it — and holds its fields on the right, so a screen is read top to bottom
 * like a document rather than as a stack of cards each asking to be saved.
 * The save bar sticks to the bottom of the viewport while the form is on
 * screen and scrolls away with it.
 */
export function Section({
  n,
  title,
  hint,
  more,
  children,
  testId,
}: {
  n?: number;
  title: string;
  hint?: ReactNode;
  /** Folded reasoning, under the hint — usually a <Why>. */
  more?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="oi-section" data-testid={testId}>
      <div className="oi-section-side">
        {n !== undefined && <span className="oi-section-n">{String(n).padStart(2, "0")}</span>}
        <h2 className="oi-section-title">{title}</h2>
        {hint && <p className="oi-section-hint">{hint}</p>}
        {more}
      </div>
      <div className="oi-section-body">{children}</div>
    </section>
  );
}

export function SaveBar({
  label,
  status,
  error,
  children,
  testId,
}: {
  label: string;
  /** "Saved." — shown after a successful round trip. */
  status?: ReactNode;
  error?: ReactNode;
  /** Other actions beside Save, left of it. */
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="oi-savebar">
      {error && (
        <span role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--dang)" }}>
          {error}
        </span>
      )}
      {status && (
        <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
          {status}
        </span>
      )}
      <span style={{ flex: 1 }} />
      {children}
      <button type="submit" className="oi-btn oi-btn-primary" data-testid={testId}>
        {label}
      </button>
    </div>
  );
}
