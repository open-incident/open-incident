"use client";

/**
 * The modal every Services dialog sits in — the design's: a scrim, a panel of
 * radius-modal, a title row with a close cross, the body, and a sunk footer
 * holding the buttons. Escape and a click on the scrim close it.
 */

import { useEffect, type ReactNode } from "react";
import { useT } from "@/i18n/client";

export const BTN_GHOST: React.CSSProperties = {
  height: 34,
  padding: "0 14px",
  border: "1px solid var(--line)",
  borderRadius: 9,
  background: "var(--panel)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  color: "inherit",
};

export const BTN_BRAND: React.CSSProperties = {
  height: 34,
  padding: "0 16px",
  border: 0,
  borderRadius: 9,
  background: "var(--brand)",
  color: "var(--on-brand)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

export const FIELD_LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};

export const CONTROL: React.CSSProperties = {
  height: 38,
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "0 12px",
  fontSize: 13.5,
  outline: "none",
  background: "var(--panel)",
  color: "var(--ink)",
  width: "100%",
};

export function Dialog({
  title,
  onClose,
  children,
  footer,
  width = 520,
  testId,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  testId?: string;
}) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--scrim)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "10vh",
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        data-testid={testId}
        style={{
          width,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--panel)",
          borderRadius: "var(--radius-modal)",
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
          animation: "oi-rise .2s ease backwards",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "16px 22px",
            borderBottom: "1px solid var(--line)",
            flex: "none",
          }}
        >
          <span style={{ fontFamily: "var(--title)", fontSize: 17, fontWeight: 600 }}>{title}</span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="oi-hover"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              display: "grid",
              placeItems: "center",
              color: "var(--ink-3)",
              cursor: "pointer",
              border: 0,
              background: "none",
            }}
          >
            ✕
          </button>
        </div>
        <div
          style={{
            padding: "18px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            overflowY: "auto",
          }}
        >
          {children}
        </div>
        {footer && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: 8,
              padding: "13px 22px",
              background: "var(--sunk)",
              borderTop: "1px solid var(--line)",
              flex: "none",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A small menu anchored under its trigger — "Other team ▾", "Change owner".
 * Closes on a click outside or Escape.
 */
export function useOutsideClose(
  open: boolean,
  close: () => void,
  ref: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close, ref]);
}

export const MENU: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 6px)",
  right: 0,
  minWidth: 200,
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 12,
  boxShadow: "var(--shadow-pop)",
  padding: 5,
  zIndex: 40,
  display: "flex",
  flexDirection: "column",
  gap: 1,
  animation: "oi-rise .16s ease backwards",
};

export const MENU_ITEM: React.CSSProperties = {
  height: 32,
  padding: "0 10px",
  borderRadius: 8,
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  border: 0,
  background: "none",
  color: "var(--ink)",
  textAlign: "left",
  width: "100%",
};
