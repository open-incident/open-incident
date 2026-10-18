"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/client";
import { CodeLine, Segmented, flash } from "./controls";

/**
 * The creation dialog of the settings template: a title and one sentence,
 * the fields stacked — a 12 px label, the control, a line of help — then
 * Cancel and the primary verb on a sunk footer.
 *
 * Its action answers one of three ways: an error (the dialog stays, the
 * message in a toast), done (the dialog closes, the message in a toast), or
 * a secret (the dialog turns into the "shown once" panel: the value on a dark
 * line with Copy, the warning, and one button to close). A secret is never
 * kept anywhere else: closing the dialog drops it.
 */

export type DialogResult =
  | { ok: true; message?: string; secret?: string; secretNote?: string; secretDone?: string }
  | { ok: false; error: string }
  | null;

export type DialogAction = (prev: DialogResult, formData: FormData) => Promise<DialogResult>;

export function SettingsDialog({
  trigger,
  title,
  lead,
  primary,
  action,
  children,
  testId,
  open: controlledOpen,
  onOpenChange,
  danger,
  submitTestId,
}: {
  /** Renders the button that opens the dialog; omitted when `open` is controlled. */
  trigger?: (open: () => void) => ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  primary: ReactNode;
  action: DialogAction;
  /** The fields — DialogField, DialogToggle… — and any hidden inputs. */
  children?: ReactNode;
  testId?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The primary verb is destructive: red instead of brand. */
  danger?: boolean;
  /** Test id of the primary button; `<testId>-submit` by default. */
  submitTestId?: string;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (v: boolean) => {
    if (controlledOpen === undefined) setOwnOpen(v);
    onOpenChange?.(v);
  };
  // A new key per opening: fields, result and secret start blank every time.
  const [round, setRound] = useState(0);
  return (
    <>
      {trigger?.(() => {
        setRound((r) => r + 1);
        setOpen(true);
      })}
      {open && (
        <DialogBody
          key={round}
          title={title}
          lead={lead}
          primary={primary}
          action={action}
          testId={testId}
          submitTestId={submitTestId}
          danger={danger}
          onClose={() => setOpen(false)}
        >
          {children}
        </DialogBody>
      )}
    </>
  );
}

function DialogBody({
  title,
  lead,
  primary,
  action,
  children,
  testId,
  submitTestId,
  danger,
  onClose,
}: {
  title: ReactNode;
  lead?: ReactNode;
  primary: ReactNode;
  action: DialogAction;
  children?: ReactNode;
  testId?: string;
  submitTestId?: string;
  danger?: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [state, formAction, pending] = useActionState<DialogResult, FormData>(action, null);
  const seen = useRef<DialogResult>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (state === seen.current || !state) return;
    seen.current = state;
    if (!state.ok) flash(state.error);
    else if (!state.secret) {
      if (state.message) flash(state.message);
      onClose();
    }
  }, [state, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const secret = state && state.ok ? state.secret : undefined;
  const footer: CSSProperties = {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    padding: "12px 22px",
    borderTop: "1px solid var(--line)",
    background: "var(--sunk)",
  };
  const body = (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(13,22,28,.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "9vh 16px 16px",
        overflow: "auto",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        data-testid={testId}
        data-screen-label="Settings — dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          background: "var(--panel)",
          borderRadius: "var(--radius-modal)",
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
          animation: "oi-rise .16s ease backwards",
        }}
      >
        <div
          style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "18px 22px 4px" }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: "var(--title)",
                fontSize: 19,
                fontWeight: 600,
                letterSpacing: "-.01em",
              }}
            >
              {title}
            </div>
            {lead && (
              <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55, marginTop: 4 }}>
                {lead}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label={t("settingsV2.close")}
            onClick={onClose}
            className="oi-hover"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              display: "grid",
              placeItems: "center",
              color: "var(--ink-3)",
              cursor: "pointer",
              background: "transparent",
              border: 0,
              fontSize: 14,
            }}
          >
            ✕
          </button>
        </div>
        {secret ? (
          <>
            <div
              style={{
                padding: "14px 22px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <CodeLine code={secret} testId="settings-secret" padding="12px 14px" />
              <div
                style={{
                  display: "flex",
                  gap: 9,
                  alignItems: "flex-start",
                  background: "var(--wait-t)",
                  color: "var(--wait)",
                  borderRadius: 10,
                  padding: "9px 12px",
                  fontSize: 12.5,
                  lineHeight: 1.5,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--wait)",
                    marginTop: 7,
                    flex: "none",
                  }}
                />
                {state && state.ok ? state.secretNote : null}
              </div>
            </div>
            <div style={footer}>
              <button
                type="button"
                onClick={onClose}
                data-testid="settings-secret-done"
                className="oi-hover-brand-2"
                style={primaryStyle(false)}
              >
                {(state && state.ok && state.secretDone) || t("settingsV2.done")}
              </button>
            </div>
          </>
        ) : (
          <form action={formAction}>
            <div
              style={{
                padding: "14px 22px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 13,
              }}
            >
              {children}
            </div>
            <div style={footer}>
              <button
                type="button"
                onClick={onClose}
                className="oi-hover"
                style={{
                  height: 34,
                  padding: "0 14px",
                  border: "1px solid var(--line)",
                  borderRadius: 9,
                  background: "var(--panel)",
                  display: "flex",
                  alignItems: "center",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  color: "var(--ink)",
                }}
              >
                {t("settingsV2.cancel")}
              </button>
              <button
                type="submit"
                disabled={pending}
                data-testid={submitTestId ?? (testId ? `${testId}-submit` : undefined)}
                className={danger ? undefined : "oi-hover-brand-2"}
                style={{ ...primaryStyle(!!danger), opacity: pending ? 0.7 : 1 }}
              >
                {primary}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
  return mounted ? createPortal(body, document.body) : null;
}

function primaryStyle(danger: boolean): CSSProperties {
  return {
    height: 34,
    padding: "0 15px",
    borderRadius: 9,
    background: danger ? "var(--dang)" : "var(--brand)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    border: 0,
  };
}

/* ---------- Dialog fields ---------- */

export function dialogInputStyle(mono?: boolean): CSSProperties {
  return {
    width: "100%",
    height: 36,
    border: "1px solid var(--line)",
    borderRadius: 9,
    padding: "0 11px",
    fontSize: 13,
    fontFamily: mono ? "var(--mono)" : "inherit",
    background: "var(--panel)",
    color: "var(--ink)",
    outline: "none",
  };
}

export const dialogSelectStyle: CSSProperties = { ...dialogInputStyle(), padding: "0 9px" };

export const dialogTextareaStyle: CSSProperties = {
  width: "100%",
  border: "1px solid var(--line)",
  borderRadius: 9,
  padding: "9px 11px",
  fontSize: 13,
  lineHeight: 1.5,
  background: "var(--panel)",
  color: "var(--ink)",
  outline: "none",
  resize: "vertical",
  fontFamily: "inherit",
};

/** A field of a dialog: 12 px label, the control, one line of help. */
export function DialogField({
  label,
  help,
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
      {children}
      {help && (
        <span style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.45 }}>{help}</span>
      )}
    </label>
  );
}

/** A read-only line in a dialog: what a connection will be allowed to do. */
export function DialogReadOnly({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
      <span
        style={{
          display: "flex",
          alignItems: "center",
          minHeight: 36,
          padding: "6px 11px",
          borderRadius: 9,
          background: "var(--sunk)",
          fontSize: 12.5,
          color: "var(--ink-2)",
          lineHeight: 1.5,
        }}
      >
        {children}
      </span>
    </div>
  );
}

/** A toggle in a dialog: the label on the left, the switch on the right. */
export function DialogToggle({
  name,
  label,
  help,
  defaultChecked,
  testId,
}: {
  name: string;
  label: ReactNode;
  help?: ReactNode;
  defaultChecked: boolean;
  testId?: string;
}) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{label}</span>
        <input
          type="checkbox"
          name={name}
          defaultChecked={defaultChecked}
          data-testid={testId}
          onChange={(e) => setOn(e.currentTarget.checked)}
          style={{ position: "absolute", opacity: 0, width: 1, height: 1, pointerEvents: "none" }}
        />
        <span
          aria-hidden
          style={{
            position: "relative",
            width: 36,
            height: 20,
            borderRadius: 999,
            background: on ? "var(--brand)" : "var(--line)",
            flex: "none",
            transition: "background .15s",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 2,
              left: on ? 18 : 2,
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: "#fff",
              boxShadow: "0 1px 2px rgba(0,0,0,.2)",
              transition: "left .15s",
            }}
          />
        </span>
      </label>
      {help && (
        <span style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.45 }}>{help}</span>
      )}
    </div>
  );
}

/** A segmented choice in a dialog. */
export function DialogSegmented({
  label,
  name,
  options,
  defaultValue,
  onChange,
}: {
  label: ReactNode;
  name: string;
  options: Array<{ value: string; label: ReactNode }>;
  defaultValue: string;
  onChange?: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
      <Segmented
        name={name}
        options={options}
        defaultValue={defaultValue}
        onChange={onChange}
        size="dialog"
      />
    </div>
  );
}
