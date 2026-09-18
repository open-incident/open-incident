"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";

/**
 * The secret, shown once.
 *
 * It is never stored in a readable form, so this dialog is the only moment it
 * exists on a screen: it carries the whole URL the tool is given, a copy
 * button, and a line that waits for the first alert to come back.
 */
export function SecretDialog({
  name,
  endpoint,
  secret,
  doneLabel,
  onDone,
}: {
  name: string;
  endpoint: string;
  secret: string;
  doneLabel: string;
  onDone: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const url = `${endpoint}?secret=${secret}`;
  return (
    <div
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
        className="oi-rise-fast"
        data-testid="source-created"
        style={{
          width: 560,
          maxWidth: "calc(100vw - 32px)",
          background: "var(--panel)",
          borderRadius: "var(--radius-modal)",
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
          textAlign: "left",
        }}
      >
        <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                background: "var(--ok-t)",
                color: "var(--ok)",
                display: "grid",
                placeItems: "center",
                fontWeight: 800,
              }}
            >
              ✓
            </span>
            <span style={{ fontFamily: "var(--title)", fontSize: 17, fontWeight: 600 }}>
              {t("alt2.secret.title", { name })}
            </span>
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
            {t("alt2.secret.text", { name })}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <code
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                background: "var(--sunk)",
                border: "1px solid var(--brand-b)",
                borderRadius: 8,
                padding: "9px 11px",
                wordBreak: "break-all",
                lineHeight: 1.5,
              }}
            >
              <span data-testid="source-endpoint">{endpoint}</span>?secret=
              <span data-testid="source-secret">{secret}</span>
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(url).catch(() => {});
                setCopied(true);
              }}
              className="oi-hover-brand-2"
              style={{
                height: 38,
                padding: "0 14px",
                borderRadius: 8,
                border: 0,
                background: "var(--brand)",
                color: "var(--on-brand)",
                display: "flex",
                alignItems: "center",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                flex: "none",
              }}
            >
              {copied ? t("common.copied") : t("common.copy")}
            </button>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              background: "var(--viol-t)",
              borderRadius: 10,
              padding: "10px 13px",
              fontSize: 12.5,
              color: "var(--ink-2)",
            }}
          >
            <span
              className="oi-pulse"
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--viol)",
                flex: "none",
              }}
            />
            {t("alt2.secret.waiting", { name })}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "14px 22px",
            borderTop: "1px solid var(--line)",
            background: "var(--sunk)",
          }}
        >
          <span style={{ flex: 1 }} />
          <button
            type="button"
            data-testid="source-configure"
            onClick={onDone}
            className="oi-hover-brand-2"
            style={{
              height: 34,
              padding: "0 16px",
              borderRadius: 9,
              border: 0,
              background: "var(--brand)",
              color: "var(--on-brand)",
              display: "flex",
              alignItems: "center",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {doneLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
