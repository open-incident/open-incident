"use client";

import { useState } from "react";
import type { PriorityRule } from "@openincident/db";
import { useT } from "@/i18n/client";
import { saveSourcePriorityRule } from "@/app/app/settings/alert-sources/actions";

type Mode = "none" | "static" | "field";
const control: React.CSSProperties = {
  height: 32,
  padding: "0 9px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--panel)",
  fontSize: 12.5,
  outline: "none",
};
const small: React.CSSProperties = {
  background: "none",
  border: 0,
  padding: "2px 6px",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--brand)",
  cursor: "pointer",
};

/**
 * The alert's priority, decided at the source: none (the payload's own label
 * or the default applies), the same for every alert, or read from a field
 * with a value map — "critical → P1" — and a fallback.
 */
export function PriorityRuleEditor({
  sourceId,
  initial,
  priorities,
  paths,
}: {
  sourceId: string;
  initial: PriorityRule | null;
  priorities: Array<{ id: string; name: string; isDefault: boolean }>;
  paths: string[];
}) {
  const t = useT();
  const [mode, setMode] = useState<Mode>(initial?.mode ?? "none");
  const [staticId, setStaticId] = useState(
    initial?.mode === "static" ? initial.priorityId : (priorities[0]?.id ?? ""),
  );
  const [path, setPath] = useState(initial?.mode === "field" ? initial.path : "");
  const [rows, setRows] = useState<Array<[string, string]>>(
    initial?.mode === "field"
      ? Object.entries(initial.map)
      : [["critical", priorities[0]?.id ?? ""]],
  );
  const [fallback, setFallback] = useState(
    initial?.mode === "field" ? (initial.fallbackPriorityId ?? "") : "",
  );
  const rule: PriorityRule | null =
    mode === "static"
      ? { mode: "static", priorityId: staticId }
      : mode === "field"
        ? {
            mode: "field",
            path,
            map: Object.fromEntries(
              rows.filter(([k, v]) => k && v).map(([k, v]) => [k.toLowerCase(), v]),
            ),
            fallbackPriorityId: fallback || null,
          }
        : null;
  const radio = (m: Mode, label: string) => (
    <label
      style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}
    >
      <input type="radio" name="_mode" checked={mode === m} onChange={() => setMode(m)} />
      {label}
    </label>
  );
  return (
    <form
      action={saveSourcePriorityRule}
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
      data-testid="priority-rule"
    >
      <input type="hidden" name="id" value={sourceId} />
      <input type="hidden" name="rule" value={rule ? JSON.stringify(rule) : ""} />
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {radio("none", t("settings.sources.priority.none"))}
        {radio("static", t("settings.sources.priority.static"))}
        {radio("field", t("settings.sources.priority.field"))}
      </div>
      {mode === "static" && (
        <select
          value={staticId}
          onChange={(e) => setStaticId(e.target.value)}
          style={{ ...control, maxWidth: 240 }}
        >
          {priorities.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {mode === "field" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
              {t("settings.sources.priority.path")}
            </span>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="labels.severity"
              list={`prio-paths-${sourceId}`}
              style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 11.5, minWidth: 240 }}
            />
            <datalist id={`prio-paths-${sourceId}`}>
              {paths.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map(([k, v], i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  value={k}
                  onChange={(e) =>
                    setRows((r) => r.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))
                  }
                  placeholder="critical"
                  style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 11.5, width: 180 }}
                />
                <span style={{ color: "var(--ink-3)" }}>→</span>
                <select
                  value={v}
                  onChange={(e) =>
                    setRows((r) => r.map((x, j) => (j === i ? [x[0], e.target.value] : x)))
                  }
                  style={{ ...control, width: 140 }}
                >
                  {priorities.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                  style={{ ...small, color: "var(--ink-3)" }}
                  aria-label={t("common.delete")}
                >
                  ✕
                </button>
              </div>
            ))}
            <div>
              <button
                type="button"
                style={small}
                onClick={() => setRows((r) => [...r, ["", priorities[0]?.id ?? ""]])}
              >
                + {t("settings.sources.priority.addValue")}
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
              {t("settings.sources.priority.fallback")}
            </span>
            <select
              value={fallback}
              onChange={(e) => setFallback(e.target.value)}
              style={{ ...control, width: 200 }}
            >
              <option value="">{t("settings.sources.priority.fallbackNone")}</option>
              {priorities.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.isDefault ? ` · ${t("settings.priorities.default")}` : ""}
                </option>
              ))}
            </select>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>
            {t("settings.sources.priority.aliasNote")}
          </p>
        </div>
      )}
      <div>
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
      </div>
    </form>
  );
}
