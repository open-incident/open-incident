"use client";

import Link from "next/link";
import { useEffect, useState, useTransition, type CSSProperties } from "react";
import { useT } from "@/i18n/client";
import { Chip, itemButtonStyle, type Tone } from "@/components/settings/template";
import { flash } from "@/components/settings/controls";
import { moveRule } from "./actions";
import { RuleDialog, type RuleDialogData } from "./rule-dialog";
import type { DialogValues, ThenPart } from "./model";

export type RuleItem = {
  id: string;
  /** The rule's stored name — not shown, but it is how a person or a test finds it. */
  name: string;
  title: string;
  parts: ThenPart[];
  right: string;
  chips: Array<{ label: string; tone: Tone }>;
  muted: boolean;
  /** The dialog's fields, or null when the rule says more than they hold. */
  dialog: DialogValues | null;
  keepNote: string | null;
};

const srOnly: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/**
 * The rules in the order they are tried, as the design's list card draws
 * them: a number, the sentence, what it does, a figure, Edit. The order is
 * changed by dragging a row, or from the keyboard on its number — both write
 * the real positions and an audit line.
 */
export function RulesList({
  items,
  manages,
  dialog,
}: {
  items: RuleItem[];
  manages: boolean;
  dialog: RuleDialogData;
}) {
  const t = useT();
  const [order, setOrder] = useState(items);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [pending, start] = useTransition();
  // The server's order wins whenever it arrives.
  useEffect(() => setOrder(items), [items]);

  const move = (id: string, to: number) => {
    const from = order.findIndex((r) => r.id === id);
    if (from < 0 || to < 0 || to >= order.length || from === to) return;
    const next = order.filter((r) => r.id !== id);
    next.splice(to, 0, order[from]!);
    setOrder(next);
    start(async () => {
      const r = await moveRule(id, to);
      if (!r.ok) {
        setOrder(items);
        flash(r.error);
      } else if (r.message) flash(r.message);
    });
  };

  return (
    <div data-testid="rules-list" aria-busy={pending}>
      {order.map((r, i) => (
        <div
          key={r.id}
          data-testid="route-row"
          data-rule-id={r.id}
          draggable={manages}
          onDragStart={(e) => {
            setDragging(r.id);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", r.id);
          }}
          onDragOver={(e) => {
            if (!dragging) return;
            e.preventDefault();
            setOver(i);
          }}
          onDragLeave={() => setOver((o) => (o === i ? null : o))}
          onDrop={(e) => {
            e.preventDefault();
            const id = dragging ?? e.dataTransfer.getData("text/plain");
            setDragging(null);
            setOver(null);
            if (id) move(id, i);
          }}
          onDragEnd={() => {
            setDragging(null);
            setOver(null);
          }}
          className="oi-hover"
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "11px 18px",
            borderTop: "1px solid var(--line-2)",
            boxShadow: over === i && dragging !== r.id ? "inset 0 2px 0 var(--brand)" : undefined,
            background: "transparent",
            flexWrap: "wrap",
            opacity: dragging === r.id ? 0.5 : r.muted ? 0.6 : 1,
            cursor: manages ? "grab" : "default",
          }}
        >
          <span
            role={manages ? "button" : undefined}
            tabIndex={manages ? 0 : undefined}
            aria-label={manages ? t("settingsV2.rules.reorder", { n: i + 1 }) : undefined}
            title={manages ? t("settingsV2.rules.reorder", { n: i + 1 }) : undefined}
            data-testid="rule-handle"
            onKeyDown={(e) => {
              if (!manages) return;
              if (e.key === "ArrowUp") {
                e.preventDefault();
                move(r.id, i - 1);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                move(r.id, i + 1);
              }
            }}
            className={manages ? "oi-focus" : undefined}
            style={{
              width: 22,
              height: 22,
              borderRadius: 7,
              background: "var(--sunk)",
              display: "grid",
              placeItems: "center",
              fontFamily: "var(--mono)",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--ink-2)",
              flex: "none",
            }}
          >
            {i + 1}
          </span>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <div
              data-testid="rule-sentence"
              style={{
                fontSize: 13.5,
                fontWeight: 500,
                lineHeight: 1.45,
                overflowWrap: "anywhere",
              }}
            >
              {r.title}
              <span style={srOnly}> — {r.name}</span>
            </div>
            <div
              data-testid="rule-then-line"
              style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 1, lineHeight: 1.45 }}
            >
              {"→ "}
              {r.parts.map((p, k) => (
                <span key={k}>
                  {k > 0 && " · "}
                  {p.atlas ? (
                    <span data-testid="rule-atlas" style={{ color: "var(--viol)" }}>
                      {p.text}
                    </span>
                  ) : (
                    p.text
                  )}
                </span>
              ))}
            </div>
          </div>
          {r.chips.length > 0 && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
              {r.chips.map((c, k) => (
                <Chip key={k} tone={c.tone}>
                  {c.label}
                </Chip>
              ))}
            </div>
          )}
          <span style={{ fontSize: 12, color: "var(--ink-3)", whiteSpace: "nowrap" }}>
            {r.right}
          </span>
          {manages &&
            (r.dialog ? (
              <RuleDialog
                data={dialog}
                edit={{ id: r.id, n: i + 1, values: r.dialog, keepNote: r.keepNote }}
              />
            ) : (
              <Link
                href={`/app/settings/rules/${r.id}`}
                data-testid="rule-edit"
                className="oi-hover"
                style={itemButtonStyle()}
              >
                {t("settingsV2.edit")}
              </Link>
            ))}
        </div>
      ))}
    </div>
  );
}
