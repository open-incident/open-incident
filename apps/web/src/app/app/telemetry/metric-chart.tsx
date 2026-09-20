import type { ChangeMark, MetricPoint } from "@/lib/telemetry";

/**
 * One series, with what changed while it was happening.
 *
 * The annotations are the point of this chart. A line going up answers
 * nothing on its own — "what changed" is the first question of every incident,
 * and a deploy marker drawn on the same axis turns two screens and a guess
 * into one glance. The product already records changes over its API and from
 * CI; this is where they become useful.
 *
 * Bars rather than a line, and deliberately: a per-minute rollup has gaps when
 * nothing reported, and a line drawn through a gap invents a value that was
 * never measured. A missing bar is visibly missing.
 */
export function MetricChart({
  points,
  changes,
  from,
  to,
  unit,
  labels,
}: {
  points: MetricPoint[];
  changes: ChangeMark[];
  from: number;
  to: number;
  unit?: string;
  labels: { noPoints: string };
}) {
  if (points.length === 0) {
    return <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{labels.noPoints}</div>;
  }
  const span = Math.max(1, to - from);
  const max = Math.max(...points.map((p) => p.value), 0);
  const scale = max > 0 ? max : 1;
  const pct = (at: number) => ((at - from) / span) * 100;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ position: "relative", height: 70, background: "var(--sunk)", borderRadius: 4 }}>
        {points.map((p) => (
          <span
            key={p.at}
            title={`${p.value}${unit ? ` ${unit}` : ""} · ${new Date(p.at).toISOString().slice(11, 16)}`}
            style={{
              position: "absolute",
              left: `${pct(p.at)}%`,
              bottom: 0,
              // A floor, so a point that reported zero is visibly a point that
              // reported, not a gap where nothing arrived.
              height: `${Math.max(2, (p.value / scale) * 100)}%`,
              width: 3,
              marginLeft: -1.5,
              borderRadius: "2px 2px 0 0",
              background: "var(--brand)",
              opacity: 0.85,
            }}
          />
        ))}
        {changes.map((c) => {
          const x = pct(c.at);
          // Past two thirds the label would run off the panel, so it flips to
          // the other side of its own line. A deploy is most interesting when
          // it just happened, which is exactly where it sits on the right.
          const flip = x > 66;
          return (
            <span key={c.id}>
              <span
                style={{
                  position: "absolute",
                  left: `${x}%`,
                  top: -4,
                  bottom: 0,
                  borderLeft: "1.5px dashed var(--viol)",
                }}
              />
              <span
                title={`${c.title} · ${c.kind} · ${new Date(c.at).toISOString().slice(11, 16)}`}
                style={{
                  position: "absolute",
                  left: flip ? undefined : `calc(${x}% + 6px)`,
                  right: flip ? `calc(${100 - x}% + 6px)` : undefined,
                  top: -6,
                  fontSize: 10,
                  fontWeight: 700,
                  color: "var(--viol)",
                  background: "var(--viol-t)",
                  borderRadius: 4,
                  padding: "0 5px",
                  whiteSpace: "nowrap",
                  maxWidth: 150,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {c.title} · {c.kind}
              </span>
            </span>
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10.5,
          color: "var(--ink-3)",
        }}
      >
        {[0, 0.33, 0.66, 1].map((f) => (
          <span key={f} style={{ fontFamily: "var(--mono)" }}>
            {f === 1 ? "now" : new Date(from + span * f).toISOString().slice(11, 16)}
          </span>
        ))}
      </div>
    </div>
  );
}
