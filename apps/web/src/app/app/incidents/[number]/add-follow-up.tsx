"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import { addFollowUp } from "./actions";

/** "+ New follow-up" under the document's follow-ups — title and priority inline, nothing else required. */
export function AddFollowUp({ number }: { number: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="follow-up-add"
        className="oi-link"
        style={{
          background: "none",
          border: 0,
          padding: 0,
          fontSize: 12.5,
          fontWeight: 600,
          color: "var(--brand)",
          cursor: "pointer",
        }}
      >
        + {t("incv2.pm.newFollowUp")}
      </button>
    );
  }
  return (
    <form
      action={async (fd) => {
        await addFollowUp(fd);
        setOpen(false);
      }}
      data-testid="follow-up-form"
      style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
    >
      <input type="hidden" name="number" value={number} />
      <input
        name="title"
        required
        autoFocus
        placeholder={t("incident.followUps.titlePlaceholder")}
        className="oi-field"
        style={{
          height: 32,
          padding: "0 11px",
          border: "1px solid var(--line)",
          borderRadius: 8,
          background: "var(--panel)",
          fontSize: 12.5,
          flex: "1 1 240px",
          minWidth: 0,
          outline: "none",
        }}
      />
      <select
        name="priority"
        defaultValue="P2"
        className="oi-field"
        style={{
          height: 32,
          padding: "0 9px",
          border: "1px solid var(--line)",
          borderRadius: 8,
          background: "var(--panel)",
          fontSize: 12.5,
          outline: "none",
        }}
        aria-label={t("incident.followUps.priority")}
      >
        {["P1", "P2", "P3"].map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <button
        type="submit"
        style={{
          height: 32,
          padding: "0 13px",
          borderRadius: 8,
          background: "var(--brand)",
          color: "#fff",
          border: 0,
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {t("common.add")}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        style={{
          height: 32,
          padding: "0 11px",
          borderRadius: 8,
          border: "1px solid var(--line)",
          background: "var(--panel)",
          fontSize: 12.5,
          cursor: "pointer",
        }}
      >
        {t("common.cancel")}
      </button>
    </form>
  );
}
