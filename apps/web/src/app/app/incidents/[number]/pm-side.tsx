"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";

/**
 * The two controls of the post-incident strip that live in the browser: the
 * share button, which copies the document's address, and the comments panel —
 * a drawer over the document, holding the team's notes and the document's
 * history. Both are rendered on the server; this only opens and closes them.
 */
export function PmSide({ count, children }: { count: number; children: React.ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const btn: React.CSSProperties = {
    height: 30,
    padding: "0 12px",
    border: "1px solid var(--line)",
    borderRadius: 8,
    background: "var(--panel)",
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    color: "inherit",
  };
  return (
    <>
      <button
        type="button"
        className="oi-hover"
        style={btn}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(window.location.href);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? `${t("inc2.pi.linkCopied")} ✓` : t("inc2.pi.share")}
      </button>
      <button
        type="button"
        data-testid="pm-comments-toggle"
        onClick={() => setOpen((v) => !v)}
        style={{
          ...btn,
          border: `1px solid ${open ? "var(--brand)" : "var(--line)"}`,
          background: open ? "var(--brand-t)" : "var(--panel)",
          color: open ? "var(--brand)" : "var(--ink)",
        }}
      >
        {t("inc2.pi.comments")}{" "}
        <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{count}</span>
      </button>
      {open && (
        <div
          className="oi-rise-fast"
          data-testid="pm-drawer"
          style={{
            position: "fixed",
            right: 20,
            top: 66,
            bottom: 20,
            width: 320,
            zIndex: 40,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-pop)",
            display: "flex",
            flexDirection: "column",
            overflow: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 14px",
              borderBottom: "1px solid var(--line)",
              position: "sticky",
              top: 0,
              background: "var(--panel)",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>{t("inc2.pi.comments")}</span>
            <span style={{ fontSize: 11, color: "var(--ink-3)", marginLeft: 8 }}>
              {t("inc2.pi.teamOnly")}
            </span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("common.close")}
              className="oi-hover"
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                border: 0,
                background: "transparent",
                color: "var(--ink-3)",
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            {children}
            <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
              {t("inc2.pi.commentsNote")}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
