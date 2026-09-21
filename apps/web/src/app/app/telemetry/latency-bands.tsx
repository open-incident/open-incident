import Link from "next/link";
import type { BandShape } from "@openincident/telemetry";
import { getT } from "@/i18n/server";

/**
 * Traffic and latency over the window, as one drawing.
 *
 * Two questions share an x axis and are never asked separately: how much went
 * through, and how long it took. So the bars are requests and the lines are
 * p50, p95 and p99 — and the red on a bar is the share of that bucket that
 * failed, which is the third question nobody asks out loud.
 *
 * This is the default shape rather than a cloud of dots for a reason that is
 * arithmetic and not taste: one dot is one trace, so a cloud costs the window.
 * Seven days of dots was 7 million rows merged and 22 seconds. Seven days of
 * these is ten thousand rows. The cloud is still there for short windows,
 * where clicking the outlier is worth its price.
 *
 * Every bucket is a link into itself, so the picture is also the zoom.
 */
export async function LatencyBands({
  shape,
  from,
  to,
  zoom,
  note,
}: {
  shape: BandShape;
  from: Date;
  to: Date;
  zoom: (from: Date, to: Date) => string;
  /** Said when the filter above cannot reach a pre-aggregated minute. */
  note?: string;
}) {
  const t = await getT();
  const { bands, stepMs } = shape;
  if (bands.length === 0) return null;

  const width = 1000;
  const height = 150;
  const span = Math.max(1, to.getTime() - from.getTime());
  const busiest = Math.max(...bands.map((b) => b.traces), 1);
  const slowest = Math.max(...bands.map((b) => b.p99Ms), 1);
  /*
   * The failures get their own lane and their own scale.
   *
   * Drawn as a share of the bar above them, a steady 0.3 % of failures became
   * a minimum-height red sliver in every bucket — a continuous red line along
   * the floor, which reads as "errors everywhere" and is exactly the wrong
   * thing to say about background noise. Scaled against the worst bucket
   * instead, the baseline is a faint mark and an incident is a tall one.
   */
  const worstErrors = Math.max(...bands.map((b) => b.errors), 1);
  const barWidth = Math.max(1.5, (width / bands.length) * 0.8);

  const x = (at: number) => ((at - from.getTime()) / span) * width;
  /** Bars grow from the floor; the lines live in the same box, scaled apart. */
  /** The bottom eighth is the failure lane; the bars sit above it. */
  const errorLane = height * 0.13;
  const floor = height - errorLane;
  const yTraffic = (n: number) => floor - (n / busiest) * (height * 0.36);
  const yLatency = (msValue: number) => height * 0.5 - (msValue / slowest) * (height * 0.44);

  const lines = [
    { key: "p99Ms" as const, colour: "var(--dang)", label: "p99" },
    { key: "p95Ms" as const, colour: "var(--wait)", label: "p95" },
    { key: "p50Ms" as const, colour: "var(--ok)", label: "p50" },
  ];
  const last = bands[bands.length - 1]!;
  const totals = bands.reduce(
    (acc, b) => ({ traces: acc.traces + b.traces, errors: acc.errors + b.errors }),
    { traces: 0, errors: 0 },
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }} data-testid="latency-bands">
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
          {t("traces.bandsHint", {
            traces: t.fmt.number(totals.traces),
            errors: t.fmt.number(totals.errors),
          })}
        </span>
        <span style={{ flex: 1 }} />
        {lines.map((l) => (
          <span key={l.label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 2, background: l.colour }} />
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{l.label}</span>
            {/* The last bucket's value, which is "now" and the number people read. */}
            <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{ms(last[l.key])}</span>
          </span>
        ))}
      </div>

      {/*
        Two scales in one box, so two labels: without them the lines are a
        shape with no magnitude and the bars a rhythm with no volume.
      */}
      <div style={{ position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 2,
            fontFamily: "var(--mono)",
            fontSize: 9.5,
            color: "var(--ink-3)",
            pointerEvents: "none",
          }}
        >
          {ms(slowest)}
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 1,
            left: 2,
            fontFamily: "var(--mono)",
            fontSize: 9.5,
            color: "var(--dang)",
            pointerEvents: "none",
          }}
        >
          {t("traces.worstErrors", { n: t.fmt.number(worstErrors) })}
        </div>
        <div
          style={{
            position: "absolute",
            top: "52%",
            left: 2,
            fontFamily: "var(--mono)",
            fontSize: 9.5,
            color: "var(--ink-3)",
            pointerEvents: "none",
          }}
        >
          {t("traces.peak", { n: t.fmt.number(busiest) })}
        </div>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          style={{ width: "100%", height: 150, display: "block" }}
        >
          {bands.map((b) => {
            const bx = x(b.at);
            const top = yTraffic(b.traces);
            const errorHeight =
              b.errors > 0 ? Math.max(1.2, (b.errors / worstErrors) * errorLane) : 0;
            return (
              <Link key={b.at} href={zoom(new Date(b.at), new Date(b.at + stepMs))}>
                <g>
                  <rect
                    x={bx}
                    y={0}
                    width={Math.max(barWidth, width / bands.length)}
                    height={height}
                    fill="transparent"
                  >
                    <title>
                      {t("traces.bandTitle", {
                        time: new Date(b.at).toISOString().slice(5, 16).replace("T", " "),
                        traces: t.fmt.number(b.traces),
                        errors: t.fmt.number(b.errors),
                        p99: ms(b.p99Ms),
                      })}
                    </title>
                  </rect>
                  <rect
                    x={bx}
                    y={top}
                    width={barWidth}
                    height={floor - top}
                    fill="var(--brand)"
                    opacity="0.22"
                  />
                  {/* The failed share of the bar, from the floor up. A minimum so
                    a handful of failures in a busy bucket is still visible. */}
                  {b.errors > 0 && (
                    <rect
                      x={bx}
                      y={height - errorHeight}
                      width={barWidth}
                      height={errorHeight}
                      fill="var(--dang)"
                      opacity="0.9"
                    />
                  )}
                </g>
              </Link>
            );
          })}
          <line
            x1={0}
            x2={width}
            y1={floor}
            y2={floor}
            stroke="var(--line)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          {lines.map((l) => (
            <polyline
              key={l.label}
              points={bands.map((b) => `${x(b.at)},${yLatency(b[l.key])}`).join(" ")}
              fill="none"
              stroke={l.colour}
              strokeWidth="1.6"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
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
        <span>{t("traces.perBar", { minutes: Math.max(1, Math.round(stepMs / 60_000)) })}</span>
        <span>{stamp(to)}</span>
      </div>

      {note && <div style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.5 }}>{note}</div>}
    </div>
  );
}

function ms(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} s`;
  if (value >= 1) return `${Math.round(value)} ms`;
  return `${Math.round(value * 1000)} µs`;
}

function stamp(at: Date): string {
  return at.toISOString().slice(5, 16).replace("T", " ");
}
