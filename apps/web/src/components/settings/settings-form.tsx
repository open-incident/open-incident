"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/client";
import { flash } from "./controls";

/**
 * The one save of a settings screen.
 *
 * The fields are plain uncontrolled inputs rendered by the server with their
 * saved values; this form remembers what they said when they were drawn and
 * compares on every keystroke. Only when something differs does the bar
 * appear — "Unsaved changes on this page", Discard, Save changes — stuck to
 * the bottom of the screen, in the slot the page header leaves after the
 * last block. Discard redraws the fields from what the server last sent;
 * Save posts the whole form to the screen's action and, once it answers, the
 * fields are redrawn from the saved state.
 *
 * A field changed by script (a matrix cell, a colour swatch) calls
 * `markChanged(element)` so the comparison runs.
 */

export type FormResult = { ok: true; message?: string } | { ok: false; error: string } | null;

export type SettingsAction = (prev: FormResult, formData: FormData) => Promise<FormResult>;

/** Tells the enclosing SettingsForm that a field changed without a user event. */
export function markChanged(el: Element | null | undefined): void {
  el?.dispatchEvent(new Event("input", { bubbles: true }));
}

function snapshot(form: HTMLFormElement): string {
  const out: string[] = [];
  for (const [k, v] of new FormData(form).entries()) {
    if (typeof v === "string") out.push(`${k}=${v}`);
    else if (v.size > 0) out.push(`${k}=file:${v.name}:${v.size}`);
  }
  return out.join("\u0001");
}

export function SettingsForm({
  action,
  children,
  testId,
  id,
  savedMessage,
  style,
}: {
  action: SettingsAction;
  children: ReactNode;
  testId?: string;
  id?: string;
  /** What the toast says after a save; "Saved." by default. */
  savedMessage?: string;
  style?: React.CSSProperties;
}) {
  const t = useT();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = useRef<string>("");
  const [dirty, setDirty] = useState(false);
  // Bumped after a save or a discard: the fields are drawn again from what
  // the server holds, which is what "saved" and "discarded" both mean.
  const [generation, setGeneration] = useState(0);
  const [slot, setSlot] = useState<Element | null>(null);
  const [state, formAction, pending] = useActionState<FormResult, FormData>(action, null);
  const lastState = useRef<FormResult>(null);

  useLayoutEffect(() => {
    if (formRef.current) initial.current = snapshot(formRef.current);
    setDirty(false);
  }, [generation]);

  useEffect(() => {
    setSlot(
      formRef.current?.closest("[data-screen-label]")?.querySelector("[data-savebar-slot]") ?? null,
    );
  }, []);

  useEffect(() => {
    if (state === lastState.current) return;
    lastState.current = state;
    if (!state) return;
    if (state.ok) {
      flash(state.message ?? savedMessage ?? t("settingsV2.saved"));
      setGeneration((g) => g + 1);
    } else {
      flash(state.error);
    }
  }, [state, savedMessage, t]);

  const recompute = useCallback(() => {
    if (!formRef.current) return;
    setDirty(snapshot(formRef.current) !== initial.current);
  }, []);

  const bar = dirty ? (
    <div
      data-testid="settings-savebar"
      style={{
        position: "sticky",
        bottom: 16,
        zIndex: 5,
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "var(--topbar-dark)",
        color: "#fff",
        borderRadius: 12,
        padding: "9px 10px 9px 16px",
        boxShadow: "var(--shadow-pop)",
        animation: "oi-rise .14s ease backwards",
        flexWrap: "wrap",
      }}
    >
      <span
        aria-hidden
        style={{ width: 7, height: 7, borderRadius: "50%", background: "#F5B544" }}
      />
      <span style={{ fontSize: 13, fontWeight: 500 }}>{t("settingsV2.unsaved")}</span>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        data-testid="settings-discard"
        onClick={() => {
          setGeneration((g) => g + 1);
          flash(t("settingsV2.discarded"));
        }}
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          opacity: 0.8,
          cursor: "pointer",
          padding: "0 8px",
          background: "transparent",
          border: 0,
          color: "#fff",
        }}
      >
        {t("settingsV2.discard")}
      </button>
      <button
        type="submit"
        form={formId(id, generation)}
        data-testid="settings-save"
        disabled={pending}
        style={{
          height: 32,
          padding: "0 14px",
          borderRadius: 8,
          background: "#fff",
          color: "var(--ink)",
          fontSize: 12.5,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          cursor: pending ? "default" : "pointer",
          border: 0,
          opacity: pending ? 0.7 : 1,
        }}
      >
        {pending ? t("settingsV2.saving") : t("settingsV2.saveChanges")}
      </button>
    </div>
  ) : null;

  return (
    <>
      <form
        key={generation}
        ref={formRef}
        id={formId(id, generation)}
        action={formAction}
        data-testid={testId}
        onInput={recompute}
        onChange={recompute}
        style={{ display: "flex", flexDirection: "column", gap: 14, ...style }}
      >
        {children}
      </form>
      {bar && (slot ? createPortal(bar, slot) : bar)}
    </>
  );
}

function formId(id: string | undefined, generation: number): string {
  return `${id ?? "settings-form"}-${generation}`;
}
