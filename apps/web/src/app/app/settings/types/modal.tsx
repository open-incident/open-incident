"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/client";

/**
 * The settings dialog's frame for a LIST edited in place — the active
 * statuses, the post-incident tasks: same scrim, panel, title and footer as
 * SettingsDialog, but the body holds its own small forms (one per gesture)
 * instead of being one form, and the footer has one button that closes.
 */
export function ListModal({
  title,
  lead,
  onClose,
  children,
  testId,
}: {
  title: ReactNode;
  lead?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
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
  if (!mounted) return null;
  return createPortal(
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
          maxWidth: 560,
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
        <div
          style={{ padding: "14px 22px 16px", display: "flex", flexDirection: "column", gap: 12 }}
        >
          {children}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "12px 22px",
            borderTop: "1px solid var(--line)",
            background: "var(--sunk)",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            data-testid={testId ? `${testId}-done` : undefined}
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
    </div>,
    document.body,
  );
}
