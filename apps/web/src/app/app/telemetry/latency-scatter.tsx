import Link from "next/link";
import type { LatencyShape } from "@openincident/telemetry";
import { getT } from "@/i18n/server";

/**
 * Every request as a dot: when it ran, how long it took, whether it failed.
 *
 * This is the one drawing a trace list cannot do without. A list sorted by
 * time answers "what happened last" and hides the thing somebody came for —
 * the request that took three seconds while ten thousand took eighty
 * milliseconds. On a scatter that request is a dot alone at the top, and
 * clicking it opens the trace.
 *
 * The y axis is logarithmic, because latency is. On a linear axis a three
 * second outlier flattens the entire normal band into the bottom pixel, which
 * is how a chart manages to hide both the outlier's context and everything
 * else at once.
 *
 * The three rules are the window's real quantiles, computed over every trace
 * rather than over the dots drawn: a sampled p99 of a sample is not a number
 * anybody should act on.
 */
export async function LatencyScatter({
  shape,
  from,
  to,
  open,
  href,
  zoom,
}: {
  shape: LatencyShape;
  from: Date;
  to: Date;
  /** The trace currently open, drawn larger. */
  open?: string;
  href: (traceId: string) => string;
  zoom: (from: Date, to: Date) => string;
}) {
  const t = await getT();
  const { points, p50Ms, p95Ms, p99Ms, traces } = shape;
  if (points.length === 0) return null;

  const width = 1000;
  const height = 190;
  const span = Math.max(1, to.getTime() - from.getTime());
  const slowest = Math.max(...points.map((p) => p.ms), p99Ms, 10);
  /*
   * The floor has to be below the median, not below the sample.
   *
   * The sample is drawn per time bucket and includes the tail on purpose; on a
   * quiet window it can easily contain nothing faster than half a second. A
   * floor taken from it alone put the p50 rule under the entire cloud — the
   * first version of this drawing did exactly that, and it was unreadable in a
   * way that looked deliberate.
   */
  const fastest = Math.min(...points.map((p) => p.ms), p50Ms > 0 ? p50Ms : Infinity);
  const floor = Math.max(0.5, fastest / 2);
  const logFloor = Math.log10(floor);
  const logSpan = Math.max(0.6, Math.log10(slowest * 1.15) - logFloor);

  const x = (at: number) => ((at - from.getTime()) / span) * width;
  const y = (ms: number) =>
    height - ((Math.log10(Math.max(ms, floor)) - logFloor) / logSpan) * height;

  /** Decade gridlines — 1 ms, 10 ms, 100 ms, 1 s… whichever fall inside. */
  const decades: number[] = [];
  for (let e = Math.ceil(logFloor); e <= Math.log10(slowest * 1.15); e++) decades.push(10 ** e);

  const rules = [
    { label: "p50", ms: p50Ms, colour: "var(--ok)" },
    { label: "p95", ms: p95Ms, colour: "var(--wait)" },
    { label: "p99", ms: p99Ms, colour: "var(--dang)" },
  ].filter((r) => r.ms > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }} data-testid="latency-scatter">
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
          {t("traces.scatterHint", { traces: t.fmt.number(traces), dots: points.length })}
        </span>
        <span style={{ flex: 1 }} />
        {rules.map((r) => (
          <span key={r.label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 2, background: r.colour }} />
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{r.label}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{ms(r.ms)}</span>
          </span>
        ))}
      </div>

      <div style={{ position: "relative" }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          style={{ width: "100%", height: 190, display: "block", overflow: "visible" }}
        >
          {decades.map((d) => (
            <line
              key={d}
              x1={0}
              x2={width}
              y1={y(d)}
              y2={y(d)}
              stroke="var(--line-2)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {rules.map((r) => (
            <line
              key={r.label}
              x1={0}
              x2={width}
              y1={y(r.ms)}
              y2={y(r.ms)}
              stroke={r.colour}
              strokeWidth="1"
              strokeDasharray="4 4"
              opacity="0.8"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/*
           * Failures last, so they are never hidden under a healthy dot: on a
           * busy window the whole point of the drawing is the red ones.
           */}
          {[...points]
            .sort((a, b) => Number(a.error) - Number(b.error))
            .map((p) => (
              <Link key={`${p.traceId}-${p.at}`} href={href(p.traceId)}>
                <circle
                  cx={x(p.at)}
                  cy={y(p.ms)}
                  // Radii in viewBox units would squash with the aspect ratio;
                  // these are drawn small and the hit area is the title's.
                  r={p.traceId === open ? 5 : p.error ? 3.2 : 2.4}
                  fill={p.error ? "var(--dang)" : "var(--brand)"}
                  opacity={p.error ? 0.9 : 0.5}
                  stroke={p.traceId === open ? "var(--ink)" : "none"}
                  strokeWidth={p.traceId === open ? 1.5 : 0}
                  vectorEffect="non-scaling-stroke"
                >
                  <title>{`${p.root} · ${ms(p.ms)}${p.error ? " · " + t("traces.failed") : ""}`}</title>
                </circle>
              </Link>
            ))}
        </svg>

        {/* The axis labels sit outside the squashed SVG so they keep their size. */}
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
          {decades.map((d) => (
            <span
              key={d}
              style={{
                position: "absolute",
                left: 2,
                top: `${(y(d) / height) * 100}%`,
                transform: "translateY(-100%)",
                background: "var(--panel)",
                padding: "0 3px",
              }}
            >
              {ms(d)}
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
        {/* Halves of the window, each a link that zooms into it. */}
        <Link href={zoom(from, new Date((from.getTime() + to.getTime()) / 2))} style={LINK}>
          {stamp(from)}
        </Link>
        <Link
          href={zoom(new Date((from.getTime() + to.getTime()) / 2), to)}
          style={LINK}
          data-testid="scatter-zoom-late"
        >
          {stamp(new Date((from.getTime() + to.getTime()) / 2))} →
        </Link>
        <span>{stamp(to)}</span>
      </div>
    </div>
  );
}

const LINK: React.CSSProperties = { color: "var(--ink-3)", textDecoration: "none" };

function ms(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} s`;
  if (value >= 1) return `${Math.round(value)} ms`;
  return `${Math.round(value * 1000)} µs`;
}

function stamp(at: Date): string {
  return at.toISOString().slice(5, 16).replace("T", " ");
}
