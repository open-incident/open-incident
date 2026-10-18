import type { ReactNode } from "react";

/*
 * The settings template of the V2 design lives in template.tsx (page header,
 * form cards and rows, list cards, notes, the honest unavailable state),
 * controls.tsx (switches, segments, copy, toast), settings-form.tsx (the one
 * save bar, shown only when something changed) and dialog.tsx (creation
 * dialogs, secrets shown once). They are re-exported here so a screen can
 * import the whole template from one place.
 *
 * `Section` and `SaveBar` below are the previous layout — numbered sections,
 * an always-visible Save. No settings screen of the V2 design uses them; they
 * stay for the screens that have not moved yet.
 */
export * from "./template";
export { SettingsForm, markChanged } from "./settings-form";
export type { FormResult, SettingsAction } from "./settings-form";
export {
  SettingsDialog,
  DialogField,
  DialogReadOnly,
  DialogToggle,
  DialogSegmented,
  dialogInputStyle,
  dialogSelectStyle,
  dialogTextareaStyle,
} from "./dialog";
export type { DialogResult, DialogAction } from "./dialog";
export {
  Toggle,
  Switch,
  Segmented,
  CopyValue,
  CodeLine,
  CodeCard,
  flash,
  SettingsToaster,
} from "./controls";

/**
 * The reading layout of a settings form (previous design).
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
  marker,
  title,
  hint,
  more,
  children,
  testId,
  id,
}: {
  n?: number;
  /** A phase of the lifecycle in place of a number: its name, in its colour. */
  marker?: { label: string; color: string };
  /** Anchor, so a link can land on the section. */
  id?: string;
  title: string;
  hint?: ReactNode;
  /** Folded reasoning, under the hint — usually a <Why>. */
  more?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="oi-section" data-testid={testId} id={id}>
      <div className="oi-section-side">
        {n !== undefined && <span className="oi-section-n">{String(n).padStart(2, "0")}</span>}
        {marker && (
          <span className="oi-section-marker" style={{ color: marker.color }}>
            <span aria-hidden className="oi-section-dot" style={{ background: marker.color }} />
            {marker.label}
          </span>
        )}
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
  form,
}: {
  /** The id of the form this bar saves, when it sits outside it. */
  form?: string;
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
      <button type="submit" form={form} className="oi-btn oi-btn-primary" data-testid={testId}>
        {label}
      </button>
    </div>
  );
}
