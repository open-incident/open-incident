"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useT } from "@/i18n/client";
import { BlockHead, cardStyle } from "./template";

/**
 * The interactive pieces of the settings template: the switch, the segmented
 * choice, the copy buttons and the toast. Each switch and segment is a real
 * form input underneath — a checkbox, radios — so a form posts it, a reset
 * restores it, and the SettingsForm sees it change like any other field.
 */

/* ---------- Switch ---------- */

export function Switch({
  on,
  onToggle,
  disabled,
  label,
  testId,
}: {
  on: boolean;
  onToggle?: () => void;
  disabled?: boolean;
  label?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={onToggle}
      className="oi-focus"
      style={{
        position: "relative",
        width: 36,
        height: 20,
        borderRadius: 999,
        background: on ? "var(--brand)" : "var(--line)",
        cursor: disabled ? "default" : "pointer",
        flex: "none",
        transition: "background .15s",
        border: 0,
        padding: 0,
        opacity: disabled ? 0.55 : 1,
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
    </button>
  );
}

/**
 * A form toggle: "On"/"Off" then the switch, posting `name=on` when on.
 * The checkbox stays the source of truth, so a form reset brings it back.
 */
export function Toggle({
  name,
  defaultChecked,
  label,
  showState = true,
  disabled,
  testId,
  onChange,
}: {
  name: string;
  defaultChecked: boolean;
  /** Accessible name — the row's label. */
  label: string;
  showState?: boolean;
  disabled?: boolean;
  testId?: string;
  onChange?: (on: boolean) => void;
}) {
  const t = useT();
  const [on, setOn] = useState(defaultChecked);
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {showState && (
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {on ? t("settingsV2.on") : t("settingsV2.off")}
        </span>
      )}
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        disabled={disabled}
        aria-label={label}
        data-testid={testId}
        onChange={(e) => {
          setOn(e.currentTarget.checked);
          onChange?.(e.currentTarget.checked);
        }}
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
          opacity: disabled ? 0.55 : 1,
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
  );
}

/* ---------- Segmented choice ---------- */

export function Segmented({
  name,
  options,
  defaultValue,
  value: controlled,
  onChange,
  size = "row",
  testId,
}: {
  name?: string;
  options: Array<{ value: string; label: ReactNode; testId?: string }>;
  defaultValue?: string;
  /** Controlled use, without a form field. */
  value?: string;
  onChange?: (value: string) => void;
  /** "row": 11 px padding in a form row; "dialog": 12 px, aligned left. */
  size?: "row" | "dialog";
  testId?: string;
}) {
  const [own, setOwn] = useState(defaultValue ?? options[0]?.value ?? "");
  const value = controlled ?? own;
  return (
    <div
      role="radiogroup"
      data-testid={testId}
      style={{
        display: "flex",
        gap: 2,
        background: "var(--sunk)",
        borderRadius: 9,
        padding: 3,
        alignSelf: size === "dialog" ? "flex-start" : undefined,
        flexWrap: "wrap",
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <label
            key={o.value}
            data-testid={o.testId}
            style={{
              height: 28,
              padding: size === "dialog" ? "0 12px" : "0 11px",
              borderRadius: 7,
              background: active ? "var(--panel)" : "transparent",
              boxShadow: active ? "0 1px 2px rgba(13,22,28,.12)" : "none",
              display: "flex",
              alignItems: "center",
              fontSize: 12.5,
              fontWeight: active ? 600 : 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <input
              type="radio"
              name={name ?? undefined}
              value={o.value}
              {...(controlled !== undefined
                ? { checked: active }
                : { defaultChecked: (defaultValue ?? options[0]?.value) === o.value })}
              onChange={() => {
                setOwn(o.value);
                onChange?.(o.value);
              }}
              style={{
                position: "absolute",
                opacity: 0,
                width: 1,
                height: 1,
                pointerEvents: "none",
              }}
            />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}

/* ---------- Copy ---------- */

function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);
  return [
    copied,
    (text: string) => {
      void navigator.clipboard
        ?.writeText(text)
        .then(() => setCopied(true))
        .catch(() => setCopied(false));
    },
  ];
}

/** A value to paste elsewhere — a redirect URI, a base URL — and its Copy button. */
export function CopyValue({ value, testId }: { value: string; testId?: string }) {
  const t = useT();
  const [copied, copy] = useCopy();
  return (
    <>
      <span
        data-testid={testId}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          height: 34,
          padding: "0 11px",
          borderRadius: 9,
          background: "var(--sunk)",
          fontFamily: "var(--mono)",
          fontSize: 12,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => copy(value)}
        className="oi-hover"
        style={{
          height: 32,
          padding: "0 12px",
          border: "1px solid var(--line)",
          borderRadius: 9,
          background: "var(--panel)",
          display: "flex",
          alignItems: "center",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          whiteSpace: "nowrap",
          color: "var(--ink)",
        }}
      >
        {copied ? t("settingsV2.copied") : t("settingsV2.copy")}
      </button>
    </>
  );
}

/** The dark code line with its Copy — a command, a curl, a secret shown once. */
export function CodeLine({
  code,
  testId,
  padding = "11px 14px",
}: {
  code: string;
  testId?: string;
  padding?: string;
}) {
  const t = useT();
  const [copied, copy] = useCopy();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "var(--topbar-dark)",
        borderRadius: 10,
        padding,
      }}
    >
      <code
        data-testid={testId}
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: "var(--mono)",
          fontSize: 12.5,
          color: "var(--code-blue)",
          overflowX: "auto",
          whiteSpace: "nowrap",
        }}
      >
        {code}
      </code>
      <button
        type="button"
        onClick={() => copy(code)}
        style={{
          fontSize: 11.5,
          fontWeight: 600,
          color: "#fff",
          opacity: 0.8,
          cursor: "pointer",
          whiteSpace: "nowrap",
          background: "transparent",
          border: 0,
          padding: 0,
        }}
      >
        {copied ? t("settingsV2.copied") : t("settingsV2.copy")}
      </button>
    </div>
  );
}

/** A card holding a line of code to copy: the danger zone's command, "Try it". */
export function CodeCard({
  title,
  hint,
  code,
  testId,
}: {
  title: ReactNode;
  hint?: ReactNode;
  code: string;
  testId?: string;
}) {
  return (
    <section data-testid={testId} style={cardStyle}>
      <BlockHead title={title} hint={hint} />
      <div style={{ margin: "0 18px 16px" }}>
        <CodeLine code={code} />
      </div>
    </section>
  );
}

/* ---------- Toast ---------- */

const TOAST_EVENT = "oi-settings-toast";

/** Says what just happened, at the bottom of the screen, for 2.8 s. */
export function flash(message: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: message }));
}

export function SettingsToaster() {
  const [message, setMessage] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const on = (e: Event) => {
      setMessage((e as CustomEvent<string>).detail);
      setNonce((n) => n + 1);
    };
    window.addEventListener(TOAST_EVENT, on);
    return () => window.removeEventListener(TOAST_EVENT, on);
  }, []);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), 2800);
    return () => clearTimeout(id);
  }, [message, nonce]);
  if (!message) return null;
  const style: CSSProperties = {
    background: "var(--topbar-dark)",
    color: "#fff",
    borderRadius: 10,
    padding: "10px 16px",
    fontSize: 13,
    fontWeight: 500,
    boxShadow: "var(--shadow-pop)",
    animation: "oi-rise .14s ease backwards",
    maxWidth: "90vw",
    pointerEvents: "auto",
  };
  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 24,
        zIndex: 90,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div key={nonce} role="status" data-testid="settings-toast" style={style}>
        {message}
      </div>
    </div>
  );
}
