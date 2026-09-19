"use client";

import { useState } from "react";

/**
 * The components of the page, with ninety bars each.
 *
 * A row opens on click to show what a visitor asks next — how much of the last
 * month was up, how fast it answers, when it last broke — and a bar says what
 * happened that day when the pointer rests on it. Both are client state and
 * nothing else on the page is, which is why this is the only interactive part.
 *
 * A day nothing measured is grey and says so. It is not green: a page that
 * paints silence as success is the one thing a status page must never do.
 */

export type Bar = { day: string; state: string };

export type Row = {
  id: string;
  name: string;
  description: string | null;
  state: string;
  stateLabel: string;
  uptime90: string;
  uptime30: string;
  response: string;
  /** False when the cell holds a sentence rather than a measurement. */
  responseMono: boolean;
  lastIncident: string;
  bars: Bar[];
};

export type Labels = {
  uptime30: string;
  response: string;
  lastIncident: string;
  ago90: string;
  today: string;
  operational: string;
  degraded: string;
  outage: string;
  tipOk: string;
  tipDeg: string;
  tipOut: string;
  tipNone: string;
};

const TICK: Record<string, string> = {
  operational: "#2E9E6B",
  maintenance: "#6D3BC8",
  degraded: "#E0A030",
  partial_outage: "#E0A030",
  major_outage: "#D9534F",
  unknown: "#E7E4DC",
  none: "#E7E4DC",
};

const STATE_INK: Record<string, string> = {
  operational: "#2E9E6B",
  maintenance: "#6D3BC8",
  degraded: "#E0A030",
  partial_outage: "#E0A030",
  major_outage: "#D9534F",
  unknown: "#8A8378",
};

function tipText(state: string, l: Labels): string {
  if (state === "operational") return l.tipOk;
  if (state === "degraded" || state === "partial_outage") return l.tipDeg;
  if (state === "major_outage") return l.tipOut;
  return l.tipNone;
}

export function ComponentsList({
  rows,
  labels,
  dayFormat,
}: {
  rows: Row[];
  labels: Labels;
  /** Formatted on the server so the language is the page's, not the browser's. */
  dayFormat: Record<string, string>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [tip, setTip] = useState<{ row: string; day: string; state: string; at: number } | null>(
    null,
  );

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid rgba(27,25,23,.08)",
        borderRadius: 18,
        overflow: "hidden",
        boxShadow: "0 1px 2px rgba(27,25,23,.03)",
      }}
    >
      {rows.map((c) => (
        <div
          key={c.id}
          data-testid="component-row"
          className="st-crow"
          onClick={() => setOpen(open === c.id ? null : c.id)}
          style={{ borderBottom: "1px solid #F1EFEA", cursor: "pointer" }}
        >
          <div className="st-crow-grid">
            <div
              className="st-crow-name"
              style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}
            >
              <span
                style={{
                  fontSize: 14.5,
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {c.name}
              </span>
              {c.description && (
                <span
                  style={{
                    fontSize: 11.5,
                    color: "#8A8378",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={c.description}
                >
                  {c.description}
                </span>
              )}
            </div>
            <div
              className="st-crow-bars"
              style={{
                position: "relative",
                display: "grid",
                gridTemplateColumns: `repeat(${c.bars.length}, minmax(0,1fr))`,
                gap: 2,
                height: 26,
                minWidth: 0,
              }}
            >
              {c.bars.map((b, n) => (
                <span
                  key={b.day}
                  data-testid="component-bar"
                  onMouseEnter={() =>
                    setTip({
                      row: c.id,
                      day: b.day,
                      state: b.state,
                      at: ((n + 0.5) / c.bars.length) * 100,
                    })
                  }
                  onMouseLeave={() => setTip(null)}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    minWidth: 0,
                    height: "100%",
                    borderRadius: 2,
                    background: TICK[b.state] ?? TICK.none,
                    transform:
                      tip?.row === c.id && tip.day === b.day ? "scaleY(1.18)" : "scaleY(1)",
                    transition: "transform .1s ease",
                  }}
                />
              ))}
              {tip?.row === c.id && (
                <div
                  style={{
                    position: "absolute",
                    bottom: 32,
                    // Over the hovered day, kept inside the row at either edge.
                    left: `clamp(0px, calc(${tip.at}% - 115px), calc(100% - 230px))`,
                    width: 230,
                    background: "#1B1917",
                    color: "#fff",
                    borderRadius: 10,
                    padding: "9px 12px",
                    fontSize: 12,
                    lineHeight: 1.45,
                    boxShadow: "0 12px 30px -12px rgba(27,25,23,.5)",
                    zIndex: 30,
                    pointerEvents: "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: TICK[tip.state] ?? TICK.none,
                      }}
                    />
                    <strong>{dayFormat[tip.day] ?? tip.day}</strong>
                  </div>
                  <div style={{ color: "rgba(255,255,255,.85)" }}>{tipText(tip.state, labels)}</div>
                </div>
              )}
            </div>
            <div
              className="st-crow-meta"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 10,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 12.5,
                  color: "#5C5750",
                  whiteSpace: "nowrap",
                }}
              >
                {c.uptime90}
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  color: STATE_INK[c.state] ?? "#8A8378",
                  whiteSpace: "nowrap",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: STATE_INK[c.state] ?? "#8A8378",
                  }}
                />
                {c.stateLabel}
              </span>
            </div>
          </div>
          {open === c.id && (
            <div
              data-testid="component-detail"
              className="st-cdetail"
              style={{ background: "#F1EFEA", borderTop: "1px solid #F1EFEA" }}
            >
              {[
                [labels.uptime30, c.uptime30, true],
                [labels.response, c.response, c.responseMono],
                [labels.lastIncident, c.lastIncident, false],
              ].map(([k, v, mono]) => (
                <div key={String(k)} style={{ background: "#FCFBF8", padding: "12px 22px" }}>
                  <div
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: ".08em",
                      color: "#8A8378",
                    }}
                  >
                    {k}
                  </div>
                  <div
                    style={{
                      fontFamily: mono ? "var(--mono)" : undefined,
                      fontSize: mono ? 15 : 13,
                      fontWeight: 600,
                      marginTop: mono ? 2 : 4,
                    }}
                  >
                    {v}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "10px 22px",
          fontSize: 11,
          color: "#8A8378",
          flexWrap: "wrap",
        }}
      >
        <span style={{ whiteSpace: "nowrap" }}>{labels.ago90}</span>
        <span style={{ flex: 1, minWidth: 20, height: 1, background: "#F1EFEA" }} />
        <span style={{ whiteSpace: "nowrap" }}>{labels.today}</span>
        <span style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[
            [labels.operational, "#2E9E6B"],
            [labels.degraded, "#E0A030"],
            [labels.outage, "#D9534F"],
          ].map(([l, c]) => (
            <span key={l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: c }} />
              {l}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
