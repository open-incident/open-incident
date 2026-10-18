"use client";

import { useState } from "react";
import type { AtlasActionKind } from "@openincident/db";
import { useT } from "@/i18n/client";
import { atlasDecide, atlasToggleUndo } from "@/components/atlas/actions";
import { useAtlasCommand } from "@/components/atlas/toast";
import { Chip, KindBadge, type Tone } from "@/components/atlas/ui";

export type JournalRow = {
  id: string;
  /** For ordering the journal with what people told Atlas. */
  at: number;
  time: string;
  kind: AtlasActionKind;
  what: string;
  how: string | null;
  chips: Array<{ label: string; tone: Tone }>;
  undone: boolean;
  autonomous: boolean;
  /** What the row's button does, when the reader may act. */
  button: "undo" | "redo" | "decide" | null;
};

type Filter = "all" | "auto" | "sys";

const btn: React.CSSProperties = {
  height: 28,
  padding: "0 11px",
  borderRadius: 8,
  border: "1px solid var(--line)",
  background: "var(--panel)",
  display: "flex",
  alignItems: "center",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
  fontFamily: "inherit",
  color: "var(--ink)",
};

/**
 * "What Atlas did" — the journal, in order: when, what kind of step (R read,
 * O written in Open Incident, S on your systems, ✎ a person), what and how,
 * the chips that say who decided, and the button that takes it back. A
 * proposal still waiting is approved or rejected from its own row.
 */
export function AtlasJournal({ rows }: { rows: JournalRow[] }) {
  const t = useT();
  const [filter, setFilter] = useState<Filter>("all");
  const { run, pending, toast } = useAtlasCommand();
  const shown = rows.filter((r) =>
    filter === "all" ? true : filter === "sys" ? r.kind === "system" : r.autonomous,
  );
  const filters: Array<[Filter, string]> = [
    ["all", t("atlas.ui.filter.all")],
    ["auto", t("atlas.ui.filter.alone")],
    ["sys", t("atlas.ui.filter.systems")],
  ];
  return (
    <div data-testid="atlas-journal">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 18px",
          borderBottom: "1px solid var(--line-2)",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t("atlas.ui.journal.title")}</span>
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{t("atlas.ui.journal.hint")}</span>
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 4 }} role="tablist">
          {filters.map(([id, label]) => {
            const on = filter === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={on}
                data-testid={`atlas-filter-${id}`}
                onClick={() => setFilter(id)}
                style={{
                  height: 24,
                  padding: "0 9px",
                  borderRadius: 999,
                  border: `1px solid ${on ? "var(--brand-b)" : "var(--line)"}`,
                  background: on ? "var(--brand-t)" : "var(--panel)",
                  color: on ? "var(--brand)" : "var(--ink-2)",
                  display: "flex",
                  alignItems: "center",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  fontFamily: "inherit",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      {shown.length === 0 && (
        <div
          style={{
            padding: "12px 18px",
            borderTop: "1px solid var(--line-2)",
            fontSize: 12.5,
            color: "var(--ink-3)",
          }}
        >
          {rows.length === 0 ? t("atlas.ui.journal.empty") : t("atlas.ui.journal.none")}
        </div>
      )}
      {shown.map((r) => (
        <div
          key={r.id}
          data-testid="atlas-action"
          data-kind={r.kind}
          style={{
            display: "grid",
            gridTemplateColumns: "48px 20px minmax(0,1fr) auto",
            gap: 10,
            padding: "10px 18px",
            borderTop: "1px solid var(--line-2)",
            alignItems: "start",
            opacity: r.undone ? 0.6 : 1,
          }}
        >
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              color: "var(--ink-3)",
              paddingTop: 2,
            }}
          >
            {r.time}
          </span>
          <KindBadge kind={r.kind} />
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                lineHeight: 1.4,
                textDecoration: r.undone ? "line-through" : "none",
              }}
            >
              {r.what}
            </span>
            {r.how && (
              <span style={{ fontSize: 11.5, color: "var(--ink-2)", lineHeight: 1.45 }}>
                {r.how}
              </span>
            )}
            {r.chips.length > 0 && (
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 2 }}>
                {r.chips.map((c, j) => (
                  <Chip key={j} label={c.label} tone={c.tone} />
                ))}
              </div>
            )}
          </div>
          {r.button === "decide" ? (
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                disabled={pending}
                data-testid="atlas-reject"
                className="oi-hover"
                onClick={() => run(() => atlasDecide(r.id, false))}
                style={btn}
              >
                {t("atlas.ui.reject")}
              </button>
              <button
                type="button"
                disabled={pending}
                data-testid="atlas-approve"
                className="oi-hover-brand-2"
                onClick={() => run(() => atlasDecide(r.id, true))}
                style={{ ...btn, border: 0, background: "var(--brand)", color: "#fff" }}
              >
                {t("atlas.ui.approve")}
              </button>
            </div>
          ) : r.button ? (
            <button
              type="button"
              disabled={pending}
              data-testid={r.button === "undo" ? "atlas-undo" : "atlas-redo"}
              className="oi-hover"
              onClick={() => run(() => atlasToggleUndo(r.id))}
              style={{ ...btn, color: r.button === "redo" ? "var(--brand)" : "var(--ink)" }}
            >
              {r.button === "redo" ? t("atlas.ui.redo") : t("atlas.ui.undo")}
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
      {toast}
    </div>
  );
}
