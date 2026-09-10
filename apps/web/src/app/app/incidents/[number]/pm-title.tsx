"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import { savePostMortemTitle } from "./pm-actions";

/** The document's title, edited in place; empty goes back to "INC-n — name". */
export function PmTitle({
  number,
  title,
  fallback,
  canAct,
}: {
  number: number;
  title: string | null;
  fallback: string;
  canAct: boolean;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const style: React.CSSProperties = {
    fontFamily: "var(--font-title)",
    fontSize: 24,
    fontWeight: 600,
    letterSpacing: "-.02em",
    lineHeight: 1.2,
  };
  if (!editing)
    return (
      <h1
        style={{ ...style, margin: 0, cursor: canAct ? "text" : "default" }}
        onClick={() => canAct && setEditing(true)}
        title={canAct ? t("postMortem.titleHint") : undefined}
        data-testid="pm-title"
      >
        {title?.trim() || fallback}
      </h1>
    );
  return (
    <form
      action={async (fd) => {
        await savePostMortemTitle(fd);
        setEditing(false);
      }}
      style={{ display: "flex", gap: 8, alignItems: "center" }}
    >
      <input type="hidden" name="number" value={number} />
      <input
        name="title"
        defaultValue={title ?? ""}
        placeholder={fallback}
        maxLength={200}
        autoFocus
        className="oi-field"
        style={{
          ...style,
          flex: 1,
          border: "1px solid var(--line)",
          borderRadius: 9,
          padding: "4px 10px",
          background: "var(--panel)",
        }}
      />
      <button
        type="submit"
        style={{
          height: 30,
          padding: "0 12px",
          borderRadius: 8,
          background: "var(--brand)",
          color: "#fff",
          border: 0,
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {t("common.save")}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        style={{
          height: 30,
          padding: "0 10px",
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
