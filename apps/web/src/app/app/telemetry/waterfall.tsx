"use client";

import { useState } from "react";
import type { SpanRow } from "@/lib/telemetry";
import { axisTicks, formatMs, timeByService, traceTree, type TraceNode } from "./trace-model";

/**
 * The waterfall — one trace, as a profiler draws it.
 *
 * Three things distinguish this from a list of bars, and each answers a
 * question the list leaves to the reader:
 *
 *  - **colour is the service**, assigned per trace in order of appearance, so
 *    "where did this request go" is answered by looking rather than by reading
 *    twenty service names down the left;
 *  - **the critical path is marked**, because it is the only part of a trace
 *    where making something faster makes the request faster;
 *  - **selecting a span opens what it recorded** — its error, its events in
 *    order, its attributes — which is where the answer usually is.
 *
 * Client-side because it is an interaction: selecting a span must not be a
 * round trip. The data is one request's worth of spans, already fetched.
 */
export function Waterfall({
  spans,
  labels,
}: {
  spans: SpanRow[];
  labels: {
    span: string;
    depth: string;
    criticalPath: string;
    start: string;
    duration: string;
    ofTrace: string;
    events: string;
    attributes: string;
    timeByService: string;
    selfTime: string;
    selectHint: string;
    close: string;
  };
}) {
  const nodes = traceTree(spans);
  const [selected, setSelected] = useState<string | null>(null);
  const [onlyCritical, setOnlyCritical] = useState(false);

  if (nodes.length === 0) return null;

  const total = Math.max(...nodes.map((n) => n.startMs + n.durationMs), 1);
  const ticks = axisTicks(total);
  const shown = onlyCritical ? nodes.filter((n) => n.critical) : nodes;
  const current = nodes.find((n) => n.span.span_id === selected) ?? null;
  const services = timeByService(nodes);
  const maxDepth = Math.max(...nodes.map((n) => n.depth));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* The legend doubles as the key to every bar below. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {services.map((s) => (
          <span
            key={s.service}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
          >
            <span style={{ width: 9, height: 9, borderRadius: 3, background: s.colour }} />
            {s.service}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setOnlyCritical((v) => !v)}
          data-testid="critical-path-toggle"
          aria-pressed={onlyCritical}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            border: `1px solid ${onlyCritical ? "var(--dang)" : "var(--line)"}`,
            background: onlyCritical ? "var(--dang-t)" : "var(--panel)",
            color: onlyCritical ? "var(--dang)" : "var(--ink-2)",
            borderRadius: 8,
            padding: "4px 11px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <span style={{ width: 12, height: 2, background: "currentColor", borderRadius: 2 }} />
          {labels.criticalPath}
          {/*
           * The count, because "all of them" is a real and useful answer. A
           * request whose spans run one after another has no slack anywhere:
           * every span on it is holding the request open, and a toggle that
           * silently changed nothing would read as broken rather than as
           * "this request is sequential".
           */}
          <span style={{ fontFamily: "var(--mono)", fontWeight: 400, opacity: 0.75 }}>
            {nodes.filter((n) => n.critical).length}/{nodes.length}
          </span>
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: current ? "minmax(0,1fr) 320px" : "1fr",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          {/* The axis header, and the count that tells you how deep this goes. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,330px) 1fr",
              gap: 10,
              borderBottom: "1px solid var(--line)",
              paddingBottom: 5,
            }}
          >
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
              {labels.span} · {nodes.length} · {labels.depth} {maxDepth}
            </span>
            <span style={{ position: "relative", height: 14 }}>
              {ticks.map((t) => (
                <span
                  key={t}
                  style={{
                    position: "absolute",
                    left: `${(t / total) * 100}%`,
                    fontFamily: "var(--mono)",
                    fontSize: 10.5,
                    color: "var(--ink-3)",
                    whiteSpace: "nowrap",
                    // The last tick sits on the right edge: centring it would
                    // push half the label outside the panel.
                    transform:
                      t === 0
                        ? "none"
                        : t === ticks[ticks.length - 1]
                          ? "translateX(-100%)"
                          : "translateX(-50%)",
                  }}
                >
                  {t === 0 ? "0" : formatMs(t)}
                </span>
              ))}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            {shown.map((n) => (
              <Row
                key={n.span.span_id}
                node={n}
                total={total}
                ticks={ticks}
                selected={n.span.span_id === selected}
                onSelect={() => setSelected(n.span.span_id === selected ? null : n.span.span_id)}
              />
            ))}
          </div>

          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 5 }}>
            <span className="oi-eyebrow">{labels.timeByService}</span>
            {services.map((s) => (
              <div
                key={s.service}
                style={{
                  display: "grid",
                  gridTemplateColumns: "140px 1fr 70px",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {s.service}
                </span>
                <span
                  style={{
                    height: 6,
                    background: "var(--sunk)",
                    borderRadius: 3,
                    overflow: "hidden",
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      height: "100%",
                      width: `${s.share * 100}%`,
                      background: s.colour,
                    }}
                  />
                </span>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    textAlign: "right",
                    color: "var(--ink-3)",
                  }}
                >
                  {formatMs(s.ms)}
                </span>
              </div>
            ))}
            <span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{labels.selfTime}</span>
          </div>
        </div>

        {current && (
          <SpanDetail
            node={current}
            total={total}
            labels={labels}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

      {!current && (
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{labels.selectHint}</span>
      )}
    </div>
  );
}

function Row({
  node,
  total,
  ticks,
  selected,
  onSelect,
}: {
  node: TraceNode;
  total: number;
  ticks: number[];
  selected: boolean;
  onSelect: () => void;
}) {
  const error = node.span.status_code === "error";
  const left = (node.startMs / total) * 100;
  // A floor, because a 2 ms span in a 4 s trace is 0.05 % and would otherwise
  // be invisible — and an invisible span reads as a span that did not happen.
  const width = Math.max(0.4, (node.durationMs / total) * 100);

  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid="span-row"
      data-span={node.span.span_id}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0,330px) 1fr",
        gap: 10,
        alignItems: "center",
        padding: "3px 0",
        border: "none",
        borderRadius: 6,
        background: selected ? "var(--sunk)" : "transparent",
        textAlign: "left",
        cursor: "pointer",
        font: "inherit",
      }}
    >
      <span
        style={{
          paddingLeft: node.depth * 14,
          display: "flex",
          alignItems: "center",
          gap: 6,
          minWidth: 0,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 2,
            background: node.colour,
            flexShrink: 0,
            // The critical path is a ring rather than another colour: colour
            // already means the service, and two meanings on one swatch is how
            // a legend stops being readable.
            outline: node.critical ? "2px solid var(--dang)" : "none",
            outlineOffset: 1,
          }}
        />
        <span
          style={{
            fontSize: 11.5,
            color: "var(--ink-3)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 130,
          }}
        >
          {node.span.service_name}
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={node.span.name}
        >
          {node.span.name}
        </span>
        {error && <span style={{ color: "var(--dang)", fontSize: 11 }}>⚠</span>}
      </span>

      <span style={{ position: "relative", height: 18 }}>
        {ticks.map((t) => (
          <span
            key={t}
            style={{
              position: "absolute",
              left: `${(t / total) * 100}%`,
              top: 0,
              bottom: 0,
              width: 1,
              background: "var(--line-2)",
            }}
          />
        ))}
        <span
          style={{
            position: "absolute",
            left: `${left}%`,
            width: `${width}%`,
            top: 3,
            height: 12,
            borderRadius: 3,
            background: error ? "var(--dang)" : node.colour,
            opacity: error ? 1 : 0.85,
          }}
        />
        <span
          style={{
            position: "absolute",
            left: `min(${left + width}% + 6px, calc(100% - 52px))`,
            top: 1,
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: error ? "var(--dang)" : "var(--ink-3)",
            whiteSpace: "nowrap",
          }}
        >
          {formatMs(node.durationMs)}
        </span>
      </span>
    </button>
  );
}

/**
 * What one span recorded.
 *
 * The three numbers at the top are the ones that settle an argument: when it
 * started relative to the request, how long it took, and what share of the
 * whole that is. The last is the one people compute in their head and get
 * wrong.
 */
function SpanDetail({
  node,
  total,
  labels,
  onClose,
}: {
  node: TraceNode;
  total: number;
  labels: {
    start: string;
    duration: string;
    ofTrace: string;
    events: string;
    attributes: string;
    close: string;
  };
  onClose: () => void;
}) {
  const s = node.span;
  const attributes = Object.entries(s.attributes ?? {}).slice(0, 40);
  const t0 = Date.parse(s.start_ts) - node.startMs;

  return (
    <aside
      data-testid="span-detail"
      style={{
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-card)",
        background: "var(--panel)",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        alignSelf: "start",
        maxHeight: 520,
        overflowY: "auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span
          style={{ width: 10, height: 10, borderRadius: 3, background: node.colour, marginTop: 4 }}
        />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{ display: "block", fontSize: 13.5, fontWeight: 600, wordBreak: "break-word" }}
          >
            {s.name}
          </span>
          <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)" }}>
            {s.service_name} · {s.kind}
          </span>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={labels.close}
          style={{
            border: "none",
            background: "none",
            cursor: "pointer",
            color: "var(--ink-3)",
            fontSize: 14,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        <Stat label={labels.start} value={`+${formatMs(node.startMs)}`} />
        <Stat label={labels.duration} value={formatMs(node.durationMs)} />
        <Stat label={labels.ofTrace} value={`${Math.round((node.durationMs / total) * 100)} %`} />
      </div>

      {s.status_message && (
        <div
          style={{
            background: "var(--dang-t)",
            color: "var(--dang)",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 12,
            lineHeight: 1.5,
            fontFamily: "var(--mono)",
            wordBreak: "break-word",
          }}
        >
          {s.status_message}
        </div>
      )}

      {s.events?.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span className="oi-eyebrow">{labels.events}</span>
          {s.events.map((e, i) => (
            <div
              key={i}
              style={{ display: "grid", gridTemplateColumns: "64px 1fr", gap: 8, fontSize: 11.5 }}
            >
              {/*
               * Offset from the start of the TRACE, not of the span.
               * Everything else on this panel — the span's own start, the
               * axis above — is in the trace's frame, and an events list in a
               * second frame makes the reader do arithmetic to line them up.
               */}
              <span style={{ fontFamily: "var(--mono)", color: "var(--ink-3)" }}>
                +{formatMs(Math.max(0, Date.parse(e.ts) - t0))}
              </span>
              <span style={{ wordBreak: "break-word" }}>
                {e.name}
                {Object.entries(e.attributes ?? {}).map(([k, v]) => (
                  <span key={k} style={{ color: "var(--ink-3)" }}>
                    {" "}
                    · {k}={v}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}

      {attributes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span className="oi-eyebrow">{labels.attributes}</span>
          {attributes.map(([k, v]) => (
            <div
              key={k}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
                gap: 8,
                fontSize: 11,
              }}
            >
              <span
                style={{ fontFamily: "var(--mono)", color: "var(--ink-3)", wordBreak: "break-all" }}
              >
                {k}
              </span>
              <span
                style={{ fontFamily: "var(--mono)", textAlign: "right", wordBreak: "break-all" }}
              >
                {v}
              </span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="oi-eyebrow" style={{ fontSize: 9.5 }}>
        {label}
      </span>
      <span style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 600 }}>{value}</span>
    </span>
  );
}
