"use client";

/**
 * ⌘K — go anywhere, do the two things worth a shortcut, or ask Atlas.
 *
 * The Atlas card appears once the query is long enough to be a question. It
 * says what would happen and does not answer here: the answer belongs on a
 * screen that can cite its sources, so pressing ↵ opens it there.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { NavIcon } from "./nav-icons";
import type { SidebarSection } from "./sidebar";

export function CommandPalette({
  sections,
  canDeclare,
  canPageSelf,
  onClose,
  onDeclare,
  onPageMe,
}: {
  sections: SidebarSection[];
  canDeclare: boolean;
  canPageSelf: boolean;
  onClose: () => void;
  onDeclare: () => void;
  onPageMe: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const asking = q.trim().length > 2;
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return sections;
    return sections.filter((s) => t(s.labelKey).toLowerCase().includes(needle));
  }, [q, sections, t]);

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
        paddingTop: "14vh",
        zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="oi-rise-fast"
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.open")}
        style={{
          width: 580,
          maxWidth: "calc(100vw - 32px)",
          background: "var(--panel)",
          borderRadius: "var(--radius-modal)",
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 18px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <span
            style={{
              width: 16,
              height: 16,
              display: "grid",
              placeItems: "center",
              color: "var(--ink-3)",
            }}
          >
            <NavIcon id="search" size={16} />
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && asking) {
                onClose();
                router.push(`/app/incidents?q=${encodeURIComponent(q.trim())}`);
              }
            }}
            placeholder={t("palette.askPlaceholder")}
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              fontSize: 14.5,
              background: "transparent",
            }}
          />
        </div>
        <div style={{ padding: 8, display: "flex", flexDirection: "column" }}>
          {asking && (
            <div
              style={{
                margin: "4px 4px 8px",
                border: "1px solid var(--viol)",
                background: "var(--viol-t)",
                borderRadius: 12,
                padding: "11px 13px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--viol)",
                }}
              >
                ✦ {t("atlas.name")}
                <span
                  style={{
                    fontWeight: 600,
                    background: "var(--panel)",
                    borderRadius: 5,
                    padding: "1px 6px",
                  }}
                >
                  {t("atlas.draftLabel")}
                </span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                {t("palette.askBody", { q: q.trim() })}
              </div>
            </div>
          )}

          {(canDeclare || canPageSelf) && (
            <>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: "var(--ink-3)",
                  padding: "8px 12px 4px",
                }}
              >
                {t("palette.actions")}
              </div>
              {canDeclare && (
                <button type="button" onClick={onDeclare} className="oi-hover" style={ACTION}>
                  <span style={{ ...DOT, background: "var(--dang)" }} />
                  {t("palette.declare")}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
                    D
                  </span>
                </button>
              )}
              {canPageSelf && (
                <button type="button" onClick={onPageMe} className="oi-hover" style={ACTION}>
                  <span style={{ ...DOT, background: "var(--brand)" }} />
                  {t("palette.pageMeTest")}
                </button>
              )}
            </>
          )}

          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              padding: "10px 12px 4px",
            }}
          >
            {t("palette.goTo")}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
            {shown.map((s) => (
              <button
                key={s.href}
                type="button"
                onClick={() => {
                  onClose();
                  router.push(s.href);
                }}
                className="oi-hover"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "8px 12px",
                  borderRadius: 9,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  background: "transparent",
                  border: 0,
                  color: "inherit",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    display: "grid",
                    placeItems: "center",
                    color: "var(--ink-3)",
                  }}
                >
                  <NavIcon id={s.id} size={14} />
                </span>
                {t(s.labelKey)}
              </button>
            ))}
          </div>
          {shown.length === 0 && !asking && (
            <div style={{ padding: "10px 12px", fontSize: 13, color: "var(--ink-3)" }}>
              {t("palette.empty")}
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              borderTop: "1px solid var(--line)",
              marginTop: 8,
              padding: "9px 12px",
              fontSize: 11,
              color: "var(--ink-3)",
            }}
          >
            <span>{t("palette.keyNavigate")}</span>
            <span>{t("palette.keyOpen")}</span>
            <span>{t("palette.keyClose")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const ACTION: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "9px 12px",
  borderRadius: 9,
  fontSize: 13.5,
  fontWeight: 500,
  cursor: "pointer",
  background: "transparent",
  border: 0,
  color: "inherit",
  textAlign: "left",
  width: "100%",
};

const DOT: React.CSSProperties = { width: 7, height: 7, borderRadius: "50%", flex: "none" };
