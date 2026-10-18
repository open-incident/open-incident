"use client";

/**
 * One trace as a waterfall, with its critical path and the selected span's
 * detail (designs: "Trace waterfall", "Span detail").
 *
 * The rows, the critical path and the self times were computed on the server
 * from the spans (trace-model.ts); this draws them, keeps the selection and
 * the critical-path toggle, and offers the two things a span leads to: its
 * logs, and the incident it is evidence for.
 */

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/i18n/client";
import { attachTraceToIncident } from "./actions";
import { formatMs } from "./trace-model";

export type WaterfallSpan = {
  id: string;
  depth: number;
  service: string;
  op: string;
  kind: string;
  start: number;
  duration: number;
  self: number;
  critical: boolean;
  error: boolean;
  errorMessage: string;
  colour: string;
  events: Array<{ at: number; name: string; tone: "dang" | "wait" | "ink" }>;
  attrs: Array<[string, string]>;
};

export function TraceWaterfall({
  traceId,
  title,
  status,
  startLabel,
  legend,
  spans,
  total,
  ticks,
  initialSpan,
  initialCritical,
  attach,
  attached,
}: {
  traceId: string;
  title: string;
  status: number;
  startLabel: string;
  legend: Array<{ n: string; c: string }>;
  spans: WaterfallSpan[];
  total: number;
  ticks: number[];
  initialSpan: string | null;
  initialCritical: boolean;
  attach: { incidentId: string; ref: string } | null;
  attached: string | null;
}) {
  const t = useT();
  const [sel, setSel] = useState<string | null>(initialSpan);
  const [crit, setCrit] = useState(initialCritical);
  const TOT = Math.max(1, total);
  const pc = (ms: number) => `${((ms / TOT) * 100).toFixed(2)}%`;
  const depth = Math.max(0, ...spans.map((s) => s.depth)) + 1;
  const selected = spans.find((s) => s.id === sel) ?? null;
  const ok = status < 400;

  return (
    <div
      data-screen-label="Trace waterfall"
      data-testid="trace-waterfall"
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          borderBottom: "1px solid var(--line)",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}>{title}</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: ok ? "var(--ok)" : "var(--dang)",
            background: ok ? "var(--ok-t)" : "var(--dang-t)",
            borderRadius: 5,
            padding: "1px 7px",
          }}
        >
          {status}
        </span>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11.5,
            color: "var(--ink-3)",
            whiteSpace: "nowrap",
          }}
        >
          {startLabel}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {legend.map((l) => (
            <span
              key={l.n}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11,
                color: "var(--ink-2)",
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: 3, background: l.c }} />
              {l.n}
            </span>
          ))}
        </span>
        <button
          type="button"
          onClick={() => setCrit((v) => !v)}
          aria-pressed={crit}
          data-testid="trace-critical"
          style={{
            height: 28,
            padding: "0 11px",
            border: `1px solid ${crit ? "var(--dang)" : "var(--line)"}`,
            borderRadius: 8,
            background: crit ? "var(--dang-t)" : "var(--panel)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 600,
            color: crit ? "var(--dang)" : "var(--ink-2)",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ width: 14, height: 3, borderRadius: 2, background: "var(--dang)" }} />
          {t("tel2.criticalPath")}
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0, overflowX: "auto", flex: "10 1 620px" }}>
          <div style={{ minWidth: 760 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "290px minmax(0,1fr)",
                borderBottom: "1px solid var(--line-2)",
              }}
            >
              <span
                style={{
                  padding: "6px 16px",
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: ".08em",
                  color: "var(--ink-3)",
                }}
              >
                {t("tel2.spanHead", { count: spans.length, depth })}
              </span>
              <div style={{ position: "relative", height: 28, marginRight: 16 }}>
                {ticks.map((tk) => (
                  <span key={tk}>
                    <span
                      style={{
                        position: "absolute",
                        left: pc(tk),
                        top: 0,
                        bottom: 0,
                        borderLeft: "1px solid var(--line)",
                      }}
                    />
                    <span
                      style={{
                        position: "absolute",
                        left: `calc(${pc(tk)} + 4px)`,
                        top: 7,
                        fontFamily: "var(--mono)",
                        fontSize: 10,
                        color: "var(--ink-3)",
                      }}
                    >
                      {tk === 0 ? "0" : formatMs(tk)}
                    </span>
                  </span>
                ))}
              </div>
            </div>
            {spans.map((x) => {
              const on = x.id === sel;
              const dim = crit && !x.critical;
              const c = x.error ? "var(--dang)" : x.colour;
              const wide = x.duration / TOT > 0.14;
              const end = (x.start + x.duration) / TOT;
              return (
                <div
                  key={x.id}
                  onClick={() => setSel(x.id)}
                  className="oi-hover"
                  data-testid="trace-span"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "290px minmax(0,1fr)",
                    alignItems: "center",
                    height: 34,
                    borderBottom: "1px solid var(--line-2)",
                    background: on ? "var(--brand-t)" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      minWidth: 0,
                      paddingLeft: 14 + x.depth * 18,
                      height: "100%",
                      position: "relative",
                    }}
                  >
                    {x.depth > 0 && (
                      <span
                        style={{
                          position: "absolute",
                          left: 14 + x.depth * 18 - 10,
                          top: 0,
                          height: "50%",
                          borderLeft: "1.5px solid var(--line)",
                          borderBottom: "1.5px solid var(--line)",
                          width: 8,
                          borderBottomLeftRadius: 4,
                        }}
                      />
                    )}
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: 3,
                        background: dim ? "var(--line-2)" : c,
                        flex: "none",
                      }}
                    />
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 10.5,
                        color: "var(--ink-3)",
                        flex: "none",
                      }}
                    >
                      {x.service}
                    </span>
                    <span
                      style={{
                        fontSize: 12.5,
                        fontWeight: on ? 700 : 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: dim ? "var(--ink-3)" : "var(--ink)",
                      }}
                    >
                      {x.op}
                    </span>
                    {x.error && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "var(--dang)",
                          flex: "none",
                        }}
                      >
                        ⚠
                      </span>
                    )}
                  </span>
                  <span style={{ position: "relative", height: "100%", marginRight: 16 }}>
                    {ticks.map((tk) => (
                      <span
                        key={tk}
                        style={{
                          position: "absolute",
                          left: pc(tk),
                          top: 0,
                          bottom: 0,
                          borderLeft: "1px solid var(--line-2)",
                        }}
                      />
                    ))}
                    <span
                      style={{
                        position: "absolute",
                        top: 9,
                        height: 16,
                        left: pc(x.start),
                        width: pc(x.duration),
                        minWidth: 3,
                        background: dim ? "var(--line-2)" : c,
                        borderRadius: 4,
                        opacity: 0.92,
                        boxShadow: on
                          ? `0 0 0 2px var(--panel), 0 0 0 3.5px ${c}`
                          : crit && x.critical
                            ? "inset 0 -3px 0 rgba(0,0,0,.18)"
                            : "none",
                      }}
                    />
                    {!dim &&
                      x.events.map((ev, i) => (
                        <span key={i}>
                          <span
                            style={{
                              position: "absolute",
                              top: 6,
                              left: pc(ev.at),
                              width: 2,
                              height: 22,
                              background: "var(--ink)",
                              opacity: 0.7,
                            }}
                          />
                          <span
                            style={{
                              position: "absolute",
                              top: 2,
                              left: `calc(${pc(ev.at)} - 3px)`,
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background:
                                ev.tone === "dang"
                                  ? "var(--dang)"
                                  : ev.tone === "wait"
                                    ? "var(--wait)"
                                    : "var(--ok)",
                              border: "2px solid var(--panel)",
                            }}
                          />
                        </span>
                      ))}
                    <span
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: wide ? "flex-start" : "flex-end",
                        left: wide
                          ? pc(x.start)
                          : end > 0.82
                            ? `calc(${pc(x.start)} - 62px)`
                            : pc(x.start + x.duration),
                        width: 62,
                        fontFamily: "var(--mono)",
                        fontSize: 10.5,
                        fontWeight: 600,
                        color: wide
                          ? dim
                            ? "var(--ink-3)"
                            : "#fff"
                          : dim
                            ? "var(--ink-3)"
                            : "var(--ink-2)",
                        whiteSpace: "nowrap",
                        padding: "0 6px",
                        pointerEvents: "none",
                        boxSizing: "border-box",
                      }}
                    >
                      {formatMs(x.duration)}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        {selected && (
          <div
            data-screen-label="Span detail"
            data-testid="span-detail"
            style={{
              borderLeft: "1px solid var(--line)",
              borderTop: "1px solid var(--line)",
              marginTop: -1,
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              minWidth: 0,
              flex: "1 1 280px",
              maxWidth: 340,
              animation: "oi-rise .14s ease backwards",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: selected.error ? "var(--dang)" : selected.colour,
                  marginTop: 4,
                  flex: "none",
                }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, wordBreak: "break-word" }}>
                  {selected.op}
                </div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
                  {selected.service} · {selected.kind}
                </div>
              </div>
              <span
                role="button"
                tabIndex={0}
                aria-label={t("common.close")}
                onClick={() => setSel(null)}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  display: "grid",
                  placeItems: "center",
                  color: "var(--ink-3)",
                  cursor: "pointer",
                  flex: "none",
                }}
              >
                ✕
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 1,
                background: "var(--line)",
                border: "1px solid var(--line)",
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              {[
                [t("tel2.start"), `+${formatMs(selected.start)}`, "var(--ink)"],
                [
                  t("tel2.duration"),
                  formatMs(selected.duration),
                  selected.error ? "var(--dang)" : "var(--ink)",
                ],
                [
                  t("tel2.ofTrace"),
                  `${Math.round((selected.duration / TOT) * 100)} %`,
                  "var(--ink)",
                ],
              ].map(([l, v, ink]) => (
                <div key={l} style={{ background: "var(--panel)", padding: "8px 10px" }}>
                  <div
                    style={{
                      fontSize: 9.5,
                      fontWeight: 700,
                      letterSpacing: ".08em",
                      color: "var(--ink-3)",
                    }}
                  >
                    {l}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: ink,
                    }}
                  >
                    {v}
                  </div>
                </div>
              ))}
            </div>
            {selected.error && selected.errorMessage && (
              <div
                style={{
                  display: "flex",
                  gap: 9,
                  alignItems: "flex-start",
                  background: "var(--dang-t)",
                  borderRadius: 10,
                  padding: "9px 11px",
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "var(--dang)",
                    marginTop: 5,
                    flex: "none",
                  }}
                />
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    lineHeight: 1.5,
                    wordBreak: "break-word",
                  }}
                >
                  {selected.errorMessage}
                </span>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: ".08em",
                  color: "var(--ink-3)",
                }}
              >
                {t("tel2.events")}
              </div>
              {selected.events.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("tel2.noEvents")}</div>
              )}
              {selected.events.map((e, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "54px minmax(0,1fr)",
                    gap: 8,
                    fontSize: 12,
                    alignItems: "baseline",
                  }}
                >
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
                    +{formatMs(e.at)}
                  </span>
                  <span
                    style={{
                      lineHeight: 1.45,
                      color: e.tone === "dang" ? "var(--dang)" : "var(--ink)",
                    }}
                  >
                    {e.name}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: ".08em",
                  color: "var(--ink-3)",
                }}
              >
                {t("tel2.attributes")}
              </div>
              {selected.attrs.map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    fontSize: 11.5,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      color: "var(--ink-3)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {k}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontWeight: 600,
                      textAlign: "right",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {v}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Link
                href={`/app/telemetry?tab=logs&trace=${traceId}&span=${selected.id}`}
                className="oi-hover"
                data-testid="span-logs"
                style={{
                  height: 28,
                  padding: "0 10px",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  color: "inherit",
                  textDecoration: "none",
                }}
              >
                {t("tel2.spanLogs")}
              </Link>
              {attach && (
                <form action={attachTraceToIncident}>
                  <input type="hidden" name="trace" value={traceId} />
                  <input type="hidden" name="incident" value={attach.incidentId} />
                  <input
                    type="hidden"
                    name="title"
                    value={`${title} · ${selected.service} ${selected.op}`}
                  />
                  <button
                    type="submit"
                    data-testid="span-attach"
                    style={{
                      height: 28,
                      padding: "0 10px",
                      borderRadius: 8,
                      background: "var(--brand)",
                      color: "#fff",
                      border: 0,
                      display: "flex",
                      alignItems: "center",
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {t("tel2.attachTo", { ref: attach.ref })}
                  </button>
                </form>
              )}
              {attached && (
                <span
                  style={{
                    fontSize: 11.5,
                    color: "var(--ok)",
                    fontWeight: 600,
                    alignSelf: "center",
                  }}
                >
                  {t("tel2.attached", { ref: `INC-${attached}` })}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
