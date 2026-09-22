"use client";

import { useState } from "react";

/**
 * Past incidents, grouped by the month they started in.
 *
 * A row opens onto the updates that were published at the time, in the order
 * they were written. Nothing is summarised or rewritten here: what a visitor
 * reads is what was said while it was happening.
 */

export type HistoryUpdate = {
  status: string;
  label: string;
  at: string;
  body: string;
  /**
   * When the wording was corrected, if it was.
   *
   * Said rather than hidden: somebody read the first version and a subscriber
   * was emailed it, so a public statement that changes silently is the one
   * thing a status page must not do.
   */
  correctedAt?: string | null;
};

export type HistoryItem = {
  id: string;
  title: string;
  meta: string;
  statusLabel: string;
  tone: "ok" | "warn" | "bad";
  updates: HistoryUpdate[];
};

export type HistoryMonth = { label: string; items: HistoryItem[] };

const TONE: Record<string, { ink: string; bg: string }> = {
  ok: { ink: "#2E9E6B", bg: "#E8F3EC" },
  warn: { ink: "#B45309", bg: "#FDF2E3" },
  bad: { ink: "#D9534F", bg: "#FBECEB" },
};

const STATUS_INK: Record<string, string> = {
  investigating: "#D9534F",
  identified: "#E0A030",
  monitoring: "#6D3BC8",
  resolved: "#2E9E6B",
};

export function HistoryList({ months }: { months: HistoryMonth[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      {months.map((m) => (
        <div key={m.label} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".08em",
              color: "#8A8378",
              padding: "6px 2px 0",
            }}
          >
            {m.label}
          </div>
          {m.items.map((i) => {
            const tone = TONE[i.tone] ?? TONE.ok!;
            return (
              <div
                key={i.id}
                data-testid="history-item"
                className="st-hitem"
                onClick={() => setOpen(open === i.id ? null : i.id)}
                style={{
                  background: "#fff",
                  border: "1px solid rgba(27,25,23,.08)",
                  borderRadius: 16,
                  padding: "14px 20px",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span
                    style={{ width: 8, height: 8, borderRadius: "50%", background: tone.ink }}
                  />
                  <span style={{ fontSize: 14.5, fontWeight: 600, flex: 1, minWidth: 200 }}>
                    {i.title}
                  </span>
                  <span style={{ fontSize: 12, color: "#8A8378" }}>{i.meta}</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: tone.ink,
                      background: tone.bg,
                      borderRadius: 999,
                      padding: "2px 9px",
                    }}
                  >
                    {i.statusLabel}
                  </span>
                </div>
                {open === i.id && (
                  <div
                    data-testid="history-updates"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                      borderLeft: "2px solid #EFEDE7",
                      paddingLeft: 16,
                      margin: "14px 0 4px 3px",
                    }}
                  >
                    {i.updates.map((u, n) => (
                      <div key={n} style={{ position: "relative" }}>
                        <span
                          style={{
                            position: "absolute",
                            left: -21,
                            top: 5,
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: STATUS_INK[u.status] ?? "#8A8378",
                            border: "2px solid #fff",
                          }}
                        />
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "baseline",
                            fontSize: 12,
                            color: "#8A8378",
                          }}
                        >
                          <strong style={{ color: STATUS_INK[u.status] ?? "#8A8378" }}>
                            {u.label}
                          </strong>
                          <span>{u.at}</span>
                          {u.correctedAt && <span>· {u.correctedAt}</span>}
                        </div>
                        <div style={{ fontSize: 13.5, lineHeight: 1.6, marginTop: 2 }}>
                          {u.body}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
