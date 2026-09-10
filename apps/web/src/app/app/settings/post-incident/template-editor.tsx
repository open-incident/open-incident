"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import { savePostMortemTemplate } from "./actions";

type Row = { key: string; title: string; hint: string };

/**
 * The sections a new post-mortem starts with: a list a manager edits in place —
 * title, what the section should hold — reordered, extended, trimmed, and sent
 * as one JSON field. Existing documents keep their sections.
 */
export function TemplateEditor({
  sections,
  isDefault,
  canManage,
}: {
  sections: Row[];
  isDefault: boolean;
  canManage: boolean;
}) {
  const t = useT();
  const [rows, setRows] = useState<Row[]>(sections);
  const update = (i: number, patch: Partial<Row>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const next = [...r];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const field: React.CSSProperties = {
    height: 32,
    padding: "0 10px",
    border: "1px solid var(--line)",
    borderRadius: 8,
    fontSize: 13,
    background: "var(--panel)",
    outline: "none",
  };
  const icon: React.CSSProperties = {
    height: 26,
    width: 26,
    border: "1px solid var(--line)",
    borderRadius: 6,
    background: "var(--panel)",
    fontSize: 12,
    cursor: "pointer",
    color: "var(--ink-2)",
  };
  return (
    <form
      action={savePostMortemTemplate}
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
      data-testid="pm-template"
    >
      <input type="hidden" name="template" value={JSON.stringify(rows)} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t("settings.postIncident.template")}</span>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {isDefault
            ? t("settings.postIncident.templateDefault")
            : t("settings.postIncident.templateCustom")}
        </span>
        <span style={{ flex: 1 }} />
        {canManage && (
          <>
            {!isDefault && (
              <button
                type="submit"
                name="reset"
                value="1"
                className="oi-hover"
                style={{ ...icon, width: "auto", padding: "0 10px", height: 30, fontWeight: 600 }}
              >
                {t("settings.postIncident.templateReset")}
              </button>
            )}
            <button
              type="submit"
              className="oi-hover"
              style={{
                height: 30,
                padding: "0 12px",
                border: "1px solid var(--line)",
                borderRadius: 8,
                background: "var(--panel)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t("common.save")}
            </button>
          </>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>
        {t("settings.postIncident.templateHint")}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((row, i) => (
          <div
            key={`${row.key}-${i}`}
            style={{
              display: "grid",
              gridTemplateColumns: "26px minmax(0, 1fr) minmax(0, 2fr) auto",
              gap: 8,
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--ink-3)",
                textAlign: "center",
              }}
            >
              {i + 1}
            </span>
            <input
              value={row.title}
              onChange={(e) => update(i, { title: e.target.value })}
              placeholder={t("settings.postIncident.templateTitle")}
              maxLength={120}
              disabled={!canManage}
              className="oi-field"
              style={{ ...field, fontWeight: 600 }}
            />
            <input
              value={row.hint}
              onChange={(e) => update(i, { hint: e.target.value })}
              placeholder={t("settings.postIncident.templateHintLabel")}
              maxLength={400}
              disabled={!canManage}
              className="oi-field"
              style={field}
            />
            <span style={{ display: "inline-flex", gap: 4 }}>
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={!canManage || i === 0}
                style={icon}
                aria-label={t("postMortem.moveUp")}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={!canManage || i === rows.length - 1}
                style={icon}
                aria-label={t("postMortem.moveDown")}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                disabled={!canManage || rows.length <= 1}
                className="oi-hover-dang"
                style={icon}
                aria-label={t("common.delete")}
              >
                ✕
              </button>
            </span>
          </div>
        ))}
      </div>
      {canManage && rows.length < 12 && (
        <button
          type="button"
          onClick={() => setRows((r) => [...r, { key: "", title: "", hint: "" }])}
          className="oi-link"
          style={{
            alignSelf: "flex-start",
            background: "none",
            border: 0,
            padding: 0,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
            color: "var(--brand)",
          }}
        >
          {t("settings.postIncident.templateAdd")}
        </button>
      )}
    </form>
  );
}
