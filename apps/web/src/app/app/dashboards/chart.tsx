import type { Series } from "@openincident/telemetry";

/**
 * A panel's drawing, in SVG, server-rendered.
 *
 * No charting library on purpose. A dashboard of twelve panels has to answer
 * in under four seconds (§15.13), and shipping a megabyte of JavaScript to
 * draw twelve polylines is the easiest way to miss that by a wide margin. What
 * this cannot do — zoom, tooltips, a crosshair — is what the explorer is for.
 *
 * The one thing it must do is not lie about scale: a panel whose series share
 * an axis shares it here too, and a series with a single point is drawn as a
 * dot rather than as a flat line implying a measurement we never took.
 */

const PALETTE = ["var(--brand)", "var(--ok)", "var(--wait)", "var(--viol)", "var(--open)"];

export function Chart({
  series,
  height = 120,
  kind = "line",
  threshold,
}: {
  series: Series[];
  height?: number;
  kind?: "line" | "area" | "stat";
  /** Drawn as a rule, and included in the scale so the rule is always on screen. */
  threshold?: number;
}) {
  const points = series.flatMap((s) => s.points);
  if (points.length === 0) {
    return (
      <div
        style={{
          height,
          display: "grid",
          placeItems: "center",
          color: "var(--ink-3)",
          fontSize: 12,
        }}
      >
        no data in this window
      </div>
    );
  }

  if (kind === "stat") {
    const last = series[0]?.points[series[0].points.length - 1]?.v ?? 0;
    // Past the threshold the figure itself carries the colour: a stat panel
    // has no room for a rule, and a red number is the whole point of one.
    const over = threshold !== undefined && last >= threshold;
    return (
      <div style={{ height, display: "grid", placeItems: "center", gap: 2 }}>
        <span
          style={{
            fontFamily: "var(--title)",
            fontSize: 34,
            fontWeight: 600,
            color: over ? "var(--dang)" : undefined,
          }}
        >
          {format(last)}
        </span>
        {threshold !== undefined && (
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-3)" }}>
            threshold {format(threshold)}
          </span>
        )}
      </div>
    );
  }

  const t0 = Math.min(...points.map((p) => p.t));
  const t1 = Math.max(...points.map((p) => p.t));
  const lo = Math.min(0, ...points.map((p) => p.v));
  // The threshold widens the scale. Left out, a chart whose values all sit
  // well under it would draw the rule off the top and imply everything is
  // fine for a reason that is not the one shown.
  const hi = Math.max(...points.map((p) => p.v), ...(threshold !== undefined ? [threshold] : []));
  const spanT = t1 - t0 || 1;
  const spanV = hi - lo || 1;
  const x = (t: number) => ((t - t0) / spanT) * 100;
  const y = (v: number) => 100 - ((v - lo) / spanV) * 96 - 2;

  return (
    <div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height }}>
        {threshold !== undefined && (
          <line
            x1="0"
            x2="100"
            y1={y(threshold)}
            y2={y(threshold)}
            stroke="var(--dang)"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.7"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {series.map((s, i) => {
          const colour = PALETTE[i % PALETTE.length]!;
          // A series can come back named and empty — a label set that exists
          // but has no point in this window. Drawing it as an area read
          // `points[0].t` of nothing and took the whole page down with it;
          // skipped here rather than filtered out, so the colours still line
          // up with the legend.
          if (s.points.length === 0) return null;
          if (s.points.length === 1) {
            const p = s.points[0]!;
            return <circle key={i} cx={x(p.t)} cy={y(p.v)} r="1.2" fill={colour} />;
          }
          const d = s.points.map((p) => `${x(p.t)},${y(p.v)}`).join(" ");
          return (
            <g key={i}>
              {kind === "area" && (
                <polygon
                  points={`${x(s.points[0]!.t)},100 ${d} ${x(s.points[s.points.length - 1]!.t)},100`}
                  fill={colour}
                  opacity="0.12"
                />
              )}
              <polyline
                points={d}
                fill="none"
                stroke={colour}
                strokeWidth="1.4"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: "var(--mono)",
          fontSize: 10,
          color: "var(--ink-3)",
        }}
      >
        <span>{format(lo)}</span>
        {threshold !== undefined && (
          <span style={{ color: "var(--dang)" }}>{format(threshold)}</span>
        )}
        <span>{format(hi)}</span>
      </div>
    </div>
  );
}

function format(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (Math.abs(v) >= 1) return v.toFixed(2).replace(/\.?0+$/, "");
  return v.toPrecision(2);
}

/** The legend, kept out of the SVG so long label sets wrap instead of clipping. */
export function Legend({ series }: { series: Series[] }) {
  if (series.length <= 1) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
      {series.slice(0, 8).map((s, i) => (
        <span
          key={i}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontFamily: "var(--mono)",
            fontSize: 10,
            color: "var(--ink-3)",
          }}
        >
          <span
            style={{
              width: 8,
              height: 2,
              background: PALETTE[i % PALETTE.length],
              display: "inline-block",
            }}
          />
          {Object.entries(s.labels)
            .filter(([k]) => k !== "__name__")
            .map(([k, v]) => `${k}=${v}`)
            .join(" ") ||
            s.labels.__name__ ||
            "series"}
        </span>
      ))}
      {series.length > 8 && (
        <span style={{ fontSize: 10, color: "var(--ink-3)" }}>+{series.length - 8} more</span>
      )}
    </div>
  );
}
