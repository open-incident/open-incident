"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/client";
import { itemButtonStyle } from "@/components/settings/template";

/**
 * A dialog that reads and acts rather than creates: an endpoint and its
 * deliveries, a browser application and its switches. The frame is the
 * settings dialog's (title, one sentence, a sunk footer); the body holds the
 * object's own buttons, each a real action, and the footer only closes.
 */
export function PlainDialog({
  title,
  lead,
  children,
  onClose,
  testId,
  footer,
}: {
  title: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  testId?: string;
  /** Buttons on the left of the footer (Delete…); Close is always on the right. */
  footer?: ReactNode;
}) {
  const t = useT();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
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
                overflowWrap: "anywhere",
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
        <div
          style={{ padding: "14px 22px 16px", display: "flex", flexDirection: "column", gap: 13 }}
        >
          {children}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 22px",
            borderTop: "1px solid var(--line)",
            background: "var(--sunk)",
          }}
        >
          {footer}
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            className="oi-hover-brand-2"
            style={{
              height: 34,
              padding: "0 15px",
              borderRadius: 9,
              background: "var(--brand)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              border: 0,
            }}
          >
            {t("settingsV2.done")}
          </button>
        </div>
      </div>
    </div>
  );
  return mounted ? createPortal(body, document.body) : null;
}

/** A small action button of a dialog's body or footer — the list row's button. */
export function smallButton(ink: "ink" | "brand" | "dang" = "ink", busy = false): CSSProperties {
  return { ...itemButtonStyle(ink), opacity: busy ? 0.6 : 1 };
}
