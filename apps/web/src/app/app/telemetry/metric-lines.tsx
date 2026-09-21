import Link from "next/link";
import type { MetricGraph } from "@openincident/telemetry";
import { getT } from "@/i18n/server";

/**
 * One metric, one chart, every series on the same scale.
 *
 * The screen used to draw a separate little chart per series, stacked: a
 * metric with four hosts was four drawings whose y axes had nothing to do with
 * each other, so comparing two hosts meant comparing two pictures. Sharing one
 * box and one scale is the entire reason a chart beats a table.
 *
 * What the reader controls is stated above the drawing rather than assumed:
 * which label the lines are split on, and how a bucket is reduced. A gauge
 * averaged and a counter summed are different questions, and a chart that
 * picks silently is a chart whose numbers nobody can reproduce.
 */
export async function MetricLines({
  graph,
  metric,
  unit,
  from,
  to,
  onGroup,
  onAgg,
}: {
  graph: MetricGraph;
  metric: string;
  unit: string;
  from: Date;
  to: Date;
  onGroup: (key: string | null) => string;
  onAgg: (agg: "avg" | "sum" | "max") => string;
}) {
  const t = await getT();
  const { lines, labelKeys, groupBy, agg } = graph;

  const width = 1000;
  const height = 180;
  const span = Math.max(1, to.getTime() - from.getTime());
  const values = lines.flatMap((l) => l.points.map((p) => p.value));
  const hi = Math.max(...values, 0);
  const lo = Math.min(...values, 0);
  const range = hi - lo || 1;
  const x = (at: number) => ((at - from.getTime()) / span) * width;
  const y = (v: number) => height - ((v - lo) / range) * (height - 6) - 3;

  const palette = [
    "var(--brand)",
    "var(--ok)",
    "var(--wait)",
    "var(--viol)",
    "var(--open)",
    "var(--dang)",
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="metric-lines">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 600 }}>{metric}</span>
        {/* "1" is OpenTelemetry's dimensionless unit: printing it says nothing. */}
        {unit && unit !== "1" && (
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{unit}</span>
        )}
        <span style={{ flex: 1 }} />
        {/* How a bucket is reduced, named. */}
        <span style={{ display: "flex", gap: 2 }}>
          {(["avg", "sum", "max"] as const).map((a) => (
            <Link
              key={a}
              href={onAgg(a)}
              data-testid={`metric-agg-${a}`}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                fontWeight: 600,
                padding: "2px 7px",
                borderRadius: 6,
                textDecoration: "none",
                color: agg === a ? "var(--ink)" : "var(--ink-3)",
                background: agg === a ? "var(--sunk)" : "transparent",
              }}
            >
              {a}
            </Link>
          ))}
        </span>
      </div>

      {labelKeys.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{t("metrics.groupBy")}</span>
          <Link
            href={onGroup(null)}
            style={{ ...CHIP, ...(groupBy === null ? CHIP_ON : {}) }}
            data-testid="metric-group-none"
          >
            {t("metrics.groupNone")}
          </Link>
          {labelKeys.map((key) => (
            <Link
              key={key}
              href={onGroup(key)}
              data-testid={`metric-group-${key}`}
              style={{ ...CHIP, ...(groupBy === key ? CHIP_ON : {}) }}
            >
              {key}
            </Link>
          ))}
        </div>
      )}

      {lines.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("telemetry.noPoints")}</div>
      ) : (
        <>
          <div style={{ position: "relative" }}>
            <svg
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="none"
              style={{ width: "100%", height: 180, display: "block" }}
            >
              {/* Three gridlines: the floor, the middle and the ceiling. More
                  than that on a chart this size is texture, not information. */}
              {[0, 0.5, 1].map((f) => (
                <line
                  key={f}
                  x1={0}
                  x2={width}
                  y1={y(lo + range * f)}
                  y2={y(lo + range * f)}
                  stroke="var(--line-2)"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {lines.map((line, i) => (
                <polyline
                  key={line.label}
                  points={line.points.map((p) => `${x(p.at)},${y(p.value)}`).join(" ")}
                  fill="none"
                  stroke={palette[i % palette.length]}
                  strokeWidth="1.6"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            <div
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                fontFamily: "var(--mono)",
                fontSize: 9.5,
                color: "var(--ink-3)",
              }}
            >
              {[1, 0.5, 0].map((f) => (
                <span
                  key={f}
                  style={{
                    position: "absolute",
                    left: 2,
                    top: `${(y(lo + range * f) / height) * 100}%`,
                    transform: "translateY(-100%)",
                    background: "var(--panel)",
                    padding: "0 3px",
                  }}
                >
                  {number(lo + range * f)}
                </span>
              ))}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: "var(--ink-3)",
            }}
          >
            <span>{stamp(from)}</span>
            <span>{stamp(to)}</span>
          </div>

          {/* The legend carries each line's last value: the number people read. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {lines.map((line, i) => (
              <span
                key={line.label}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11 }}
              >
                <span style={{ width: 10, height: 2, background: palette[i % palette.length] }} />
                <span style={{ fontFamily: "var(--mono)", color: "var(--ink-2)" }}>
                  {line.label}
                </span>
                <span style={{ fontFamily: "var(--mono)" }}>
                  {number(line.points[line.points.length - 1]?.value ?? 0)}
                </span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const CHIP: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 10.5,
  padding: "2px 7px",
  borderRadius: 6,
  border: "1px solid var(--line)",
  color: "var(--ink-3)",
  textDecoration: "none",
};
const CHIP_ON: React.CSSProperties = { background: "var(--sunk)", color: "var(--ink)" };

/** Compact, because a legend of eight lines has no room for six decimals. */
function number(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)} G`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)} k`;
  if (abs >= 10) return v.toFixed(0);
  if (abs >= 1) return v.toFixed(2);
  if (abs === 0) return "0";
  return v.toFixed(3);
}

function stamp(at: Date): string {
  return at.toISOString().slice(5, 16).replace("T", " ");
}
