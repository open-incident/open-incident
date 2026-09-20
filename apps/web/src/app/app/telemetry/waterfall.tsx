import type { SpanRow } from "@/lib/telemetry";

/**
 * The waterfall — one bar per span, placed on the trace's own timeline.
 *
 * Depth comes from `parent_span_id`, not from arrival order: spans of one
 * trace reach us from several services and in no particular sequence, and a
 * tree drawn from the order of insertion is a tree that lies. A span whose
 * parent is missing — sampled away, or still in flight — is drawn at the root
 * rather than dropped, because "we did not receive that one" is information.
 */
export function Waterfall({ spans }: { spans: SpanRow[] }) {
  if (spans.length === 0) return null;

  const t0 = Math.min(...spans.map((s) => Date.parse(s.start_ts)));
  const total = Math.max(
    1,
    Math.max(...spans.map((s) => Date.parse(s.start_ts) - t0 + Number(s.duration_ns) / 1e6)),
  );

  const byId = new Map(spans.map((s) => [s.span_id, s]));
  const depth = (s: SpanRow, guard = 0): number => {
    const parent = s.parent_span_id ? byId.get(s.parent_span_id) : undefined;
    return !parent || guard > 20 ? 0 : 1 + depth(parent, guard + 1);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {spans.map((s) => {
        const start = Date.parse(s.start_ts) - t0;
        const width = Number(s.duration_ns) / 1e6;
        const error = s.status_code === "error";
        return (
          <div
            key={s.span_id}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,230px) 1fr 64px",
              gap: 8,
              alignItems: "center",
            }}
          >
            <span
              style={{
                paddingLeft: depth(s) * 12,
                fontSize: 12,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={`${s.service_name} · ${s.name}`}
            >
              <span style={{ color: "var(--ink-3)", fontFamily: "var(--mono)", fontSize: 10.5 }}>
                {s.kind.slice(0, 3)}{" "}
              </span>
              {s.name}
            </span>
            <span
              style={{
                position: "relative",
                height: 14,
                background: "var(--sunk)",
                borderRadius: 4,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  left: `${(start / total) * 100}%`,
                  width: `${Math.max(1.5, (width / total) * 100)}%`,
                  top: 0,
                  bottom: 0,
                  borderRadius: 4,
                  background: error ? "var(--dang)" : "var(--brand)",
                }}
              />
            </span>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                textAlign: "right",
                color: error ? "var(--dang)" : "var(--ink-3)",
              }}
            >
              {width < 1 ? `${Math.round(width * 1000)} µs` : `${width.toFixed(1)} ms`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
