"use client";

import { useState, type ReactNode } from "react";
import { useT } from "@/i18n/client";
import { addInvestigationNote, rerunInvestigation } from "./investigation-actions";

const btn: React.CSSProperties = {
  height: 34,
  padding: "0 13px",
  border: "1px solid var(--line)",
  borderRadius: 9,
  background: "var(--panel)",
  display: "flex",
  alignItems: "center",
  fontSize: 13,
  fontWeight: 600,
  color: "inherit",
  cursor: "pointer",
  fontFamily: "inherit",
};

/**
 * The three things a person does with the leading hypothesis: accept it into
 * the post-mortem (passed in as `children`, a server form), reject it with a
 * reason — the reason becomes cited evidence and the analysis runs again —
 * or ask for another pass.
 */
export function AtlasRcaReject({
  number,
  hasTop = true,
  labels,
  children,
}: {
  number: number;
  /** Without a leading hypothesis there is nothing to reject — only another pass. */
  hasTop?: boolean;
  labels: { reject: string; placeholder: string; hint: string; submit: string };
  children?: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="rca-steer">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {children}
        {hasTop && (
          <button
            type="button"
            data-testid="rca-reject"
            aria-expanded={open}
            className="oi-hover-edge-fill"
            onClick={() => setOpen((v) => !v)}
            style={btn}
          >
            {labels.reject}
          </button>
        )}
        {
          <form action={rerunInvestigation} style={{ display: "contents" }}>
            <input type="hidden" name="number" value={number} />
            <button
              type="submit"
              data-testid="rca-rerun"
              className="oi-hover-edge-fill"
              style={{ ...btn, fontWeight: 400 }}
            >
              {t("inc2.rca.anotherPass")}
            </button>
          </form>
        }
      </div>
      {open && (
        <form
          action={async (fd) => {
            await addInvestigationNote(fd);
            setOpen(false);
          }}
          data-testid="rca-note-form"
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <input type="hidden" name="number" value={number} />
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
            {labels.hint}
          </div>
          <textarea
            name="body"
            required
            minLength={3}
            maxLength={2000}
            rows={2}
            autoFocus
            placeholder={labels.placeholder}
            className="oi-field"
            style={{
              width: "100%",
              boxSizing: "border-box",
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: "8px 11px",
              fontSize: 13,
              lineHeight: 1.5,
              fontFamily: "inherit",
              background: "var(--panel)",
              color: "var(--ink)",
              resize: "vertical",
              outline: "none",
            }}
          />
          <div>
            <button type="submit" style={btn}>
              {labels.submit}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
