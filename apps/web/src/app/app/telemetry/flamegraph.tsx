"use client";

/**
 * A flamegraph, drawn as nested rows of proportional blocks.
 *
 * Not a canvas and not a library. The tree is already pruned to what a person
 * could click, and at that size plain elements give three things a canvas
 * would have to reimplement: text that the browser truncates and the reader
 * can select, a tooltip on hover, and a search that highlights without a
 * redraw. The one thing they do not give for free is zoom, which is a click
 * handler here.
 *
 * Clicking a block makes it the root. That is the whole interaction of a
 * flamegraph: the interesting frame is always three levels down and one per
 * cent wide, and widening it to the full width is how you read what is under
 * it.
 */

import { useMemo, useState } from "react";
import { useT } from "@/i18n/client";
import { format } from "./profile-format";

export type FlameNode = { name: string; at: string; value: number; children: FlameNode[] };

const ROW = 19;

/**
 * The colour of a block.
 *
 * Hue from a hash of the name, so the same function is the same colour every
 * time and two adjacent blocks are distinguishable — which is all a flamegraph
 * needs colour for. Deliberately not "red is slow": every block on a
 * flamegraph is slow in proportion to its width, and colouring by cost would
 * say the same thing twice while looking like a severity.
 */
function hue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  // 20°–50° is the orange-to-yellow band these have always used; staying in it
  // keeps a wide graph from looking like a bag of sweets.
  return 20 + (h % 30);
}

export function Flamegraph({
  root,
  unit,
  total,
}: {
  root: FlameNode;
  unit: string;
  total: number;
}) {
  const t = useT();
  const [zoom, setZoom] = useState<FlameNode | null>(null);
  const [needle, setNeedle] = useState("");
  const shown = zoom ?? root;

  const matched = useMemo(() => {
    if (!needle.trim()) return null;
    const lower = needle.trim().toLowerCase();
    let sum = 0;
    const walk = (n: FlameNode): void => {
      if (n.name.toLowerCase().includes(lower)) sum += n.value;
      else for (const c of n.children) walk(c);
    };
    walk(shown);
    return sum;
  }, [needle, shown]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <input
          value={needle}
          onChange={(e) => setNeedle(e.target.value)}
          placeholder={t("profiles.search")}
          data-testid="flame-search"
          className="oi-field"
          style={{
            height: 30,
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: "0 10px",
            fontSize: 12.5,
            background: "var(--panel)",
            width: 260,
            outline: "none",
          }}
        />
        {matched !== null && (
          <span style={{ fontSize: 12, color: "var(--ink-2)" }}>
            {t("profiles.matched", {
              pct: ((matched / Math.max(1, shown.value)) * 100).toFixed(1),
            })}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {zoom && (
          <button
            type="button"
            onClick={() => setZoom(null)}
            style={{
              height: 28,
              padding: "0 10px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--panel)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {t("profiles.resetZoom")}
          </button>
        )}
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
          {t("profiles.totalIs", { value: format(shown.value, unit), unit })}
        </span>
      </div>

      <div
        data-testid="flamegraph"
        style={{
          border: "1px solid var(--line)",
          borderRadius: 10,
          background: "var(--sunk)",
          padding: 6,
          overflowX: "auto",
        }}
      >
        <Row node={shown} width={100} onZoom={setZoom} needle={needle.trim().toLowerCase()} />
      </div>

      <span style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.5 }}>
        {t("profiles.flameHint", { pct: ((shown.value / Math.max(1, total)) * 100).toFixed(1) })}
      </span>
    </div>
  );
}

function Row({
  node,
  width,
  onZoom,
  needle,
}: {
  node: FlameNode;
  width: number;
  onZoom: (n: FlameNode) => void;
  needle: string;
}) {
  const hit = needle.length > 0 && node.name.toLowerCase().includes(needle);
  return (
    <div style={{ width: `${width}%`, minWidth: 1 }}>
      <button
        type="button"
        onClick={() => onZoom(node)}
        title={`${node.name}${node.at ? `\n${node.at}` : ""}`}
        style={{
          display: "block",
          width: "100%",
          height: ROW,
          lineHeight: `${ROW - 2}px`,
          textAlign: "left",
          border: "1px solid var(--panel)",
          borderRadius: 2,
          background: hit ? "var(--brand)" : `hsl(${hue(node.name)} 82% 62%)`,
          color: hit ? "var(--on-brand)" : "#1b1205",
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          padding: "0 4px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          cursor: "pointer",
        }}
      >
        {node.name}
      </button>
      {node.children.length > 0 && (
        <div style={{ display: "flex", width: "100%" }}>
          {node.children.map((child) => (
            <Row
              key={child.name}
              node={child}
              width={(child.value / node.value) * 100}
              onZoom={onZoom}
              needle={needle}
            />
          ))}
        </div>
      )}
    </div>
  );
}
