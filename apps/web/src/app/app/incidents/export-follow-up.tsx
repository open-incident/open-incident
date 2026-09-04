"use client";

import { useState, useTransition } from "react";
import { useT } from "@/i18n/client";
import { exportFollowUpAction } from "./follow-up-actions";

/** "Export ▾" on a follow-up: one connected tracker per line; the issue is created on click. */
export function ExportFollowUp({
  id,
  trackers,
}: {
  id: string;
  trackers: Array<{ kind: "github" | "gitlab" | "jira" | "linear"; label: string }>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (trackers.length === 0) return null;
  return (
    <span style={{ position: "relative", display: "inline-flex", flex: "none" }}>
      <button
        type="button"
        data-testid="follow-up-export"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        className="oi-hover"
        style={{
          height: 26,
          padding: "0 9px",
          border: "1px solid var(--line)",
          borderRadius: 7,
          background: "var(--panel)",
          fontSize: 11.5,
          fontWeight: 600,
          cursor: "pointer",
          color: "var(--brand)",
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? t("followUp.exporting") : t("followUp.export")} ▾
      </button>
      {open && (
        <span
          role="menu"
          style={{
            position: "absolute",
            top: 30,
            right: 0,
            zIndex: 20,
            minWidth: 160,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            boxShadow: "var(--shadow-modal)",
            padding: 4,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {trackers.map((tr) => (
            <button
              key={tr.kind}
              type="button"
              role="menuitem"
              data-testid={`follow-up-export-${tr.kind}`}
              onClick={() => {
                setOpen(false);
                setError(null);
                start(async () => {
                  const res = await exportFollowUpAction(id, tr.kind);
                  if (res && "error" in res) setError(res.error);
                });
              }}
              className="oi-hover"
              style={{
                textAlign: "left",
                padding: "7px 10px",
                border: 0,
                background: "none",
                borderRadius: 7,
                fontSize: 12.5,
                cursor: "pointer",
              }}
            >
              {tr.label}
            </button>
          ))}
        </span>
      )}
      {error && (
        <span
          role="alert"
          style={{
            position: "absolute",
            top: 30,
            right: 0,
            fontSize: 11.5,
            color: "var(--dang)",
            whiteSpace: "nowrap",
          }}
        >
          {error}
        </span>
      )}
    </span>
  );
}
