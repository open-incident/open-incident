"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import { addDecision, addPostMortemSection } from "./pm-actions";

const linkBtn: React.CSSProperties = {
  background: "none",
  border: 0,
  padding: 0,
  fontSize: 12.5,
  fontWeight: 600,
  color: "var(--brand)",
  cursor: "pointer",
  width: "fit-content",
};
const field: React.CSSProperties = {
  height: 32,
  padding: "0 11px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--panel)",
  fontSize: 13,
  outline: "none",
  minWidth: 0,
};
const primary: React.CSSProperties = {
  height: 32,
  padding: "0 13px",
  borderRadius: 8,
  background: "var(--brand)",
  color: "var(--on-brand)",
  border: 0,
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
};
const ghost: React.CSSProperties = {
  height: 32,
  padding: "0 11px",
  borderRadius: 8,
  border: "1px solid var(--line)",
  background: "var(--panel)",
  fontSize: 12.5,
  cursor: "pointer",
  color: "inherit",
};

/** "+ Add a decision" — what was decided and why, written to the timeline and read back here. */
export function AddDecision({ number }: { number: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button
        type="button"
        data-testid="pm-decision-add"
        onClick={() => setOpen(true)}
        style={{ ...linkBtn, paddingTop: 2 }}
      >
        + {t("incv2.pm.addDecision")}
      </button>
    );
  return (
    <form
      action={async (fd) => {
        await addDecision(fd);
        setOpen(false);
      }}
      data-testid="pm-decision-form"
      style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingTop: 4 }}
    >
      <input type="hidden" name="number" value={number} />
      <input
        name="title"
        required
        maxLength={300}
        autoFocus
        placeholder={t("incv2.pm.decisionTitle")}
        className="oi-field"
        style={{ ...field, flex: "1 1 260px" }}
      />
      <input
        name="why"
        maxLength={1000}
        placeholder={t("incv2.pm.decisionWhy")}
        className="oi-field"
        style={{ ...field, flex: "1 1 220px" }}
      />
      <button type="submit" style={primary}>
        {t("common.add")}
      </button>
      <button type="button" onClick={() => setOpen(false)} style={ghost}>
        {t("common.cancel")}
      </button>
    </form>
  );
}

/** "+ Add a section" — a section of the workspace's own, at the end of the document. */
export function AddSection({ number }: { number: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button
        type="button"
        data-testid="pm-add-section-open"
        onClick={() => setOpen(true)}
        style={{ ...linkBtn, color: "var(--ink-3)" }}
        className="oi-pm-comment"
      >
        + {t("postMortem.addSection")}
      </button>
    );
  return (
    <form
      action={async (fd) => {
        await addPostMortemSection(fd);
        setOpen(false);
      }}
      style={{ display: "flex", gap: 8, alignItems: "center" }}
      data-testid="pm-add-section"
    >
      <input type="hidden" name="number" value={number} />
      <input
        name="title"
        required
        maxLength={120}
        autoFocus
        placeholder={t("postMortem.addSectionPlaceholder")}
        className="oi-field"
        style={{ ...field, flex: 1, border: "1px dashed var(--line)" }}
      />
      <button type="submit" style={primary}>
        {t("common.add")}
      </button>
      <button type="button" onClick={() => setOpen(false)} style={ghost}>
        {t("common.cancel")}
      </button>
    </form>
  );
}
