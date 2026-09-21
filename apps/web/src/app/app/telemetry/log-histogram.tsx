import Link from "next/link";
import type { LogShape } from "@openincident/telemetry";
import { getT } from "@/i18n/server";

/**
 * When the lines happened, and how bad they were.
 *
 * A log list is a thousand rows of which the reader can see thirty, and the
 * question they arrive with is never "what is the newest line" — it is "when
 * did this start". The list cannot answer that and a bar chart answers it
 * instantly: the spike is where the bars are tall and red.
 *
 * Every bar is a link that narrows the window to the minutes it covers, which
 * makes the histogram the zoom control as well as the picture. That is the
 * whole gesture of a log explorer: see the spike, click the spike, read the
 * lines.
 *
 * Three bands, not nine levels. A stacked bar with nine colours is a bar
 * nobody reads, and "was this normal, noisy, or on fire" is the question.
 * Server-rendered SVG, like every other drawing here: twelve hundred bars of
 * charting library would cost more than the page it decorates.
 */
export async function LogHistogram({
  shape,
  from,
  to,
  zoom,
  onSeverity,
}: {
  shape: LogShape;
  from: Date;
  to: Date;
  /** A link to the window a bar covers. */
  zoom: (from: Date, to: Date) => string;
  /** A link that keeps only one severity band, or clears it. */
  onSeverity: (band: "error" | "warn" | null) => string;
}) {
  const t = await getT();
  const { buckets, stepMs, totals } = shape;
  if (buckets.length === 0) return null;

  const tallest = Math.max(...buckets.map((b) => b.error + b.warn + b.info), 1);
  const span = Math.max(1, to.getTime() - from.getTime());
  const width = 1000;
  const height = 72;
  // A bar per bucket, with the gap taken out of its width rather than added
  // between them: at seventy bars the gap is what makes them separable.
  const barWidth = Math.max(1.5, (width / buckets.length) * 0.78);

  const bands = [
    { key: "info" as const, colour: "var(--brand)", opacity: 0.35 },
    { key: "warn" as const, colour: "var(--wait)", opacity: 0.85 },
    { key: "error" as const, colour: "var(--dang)", opacity: 1 },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="log-histogram">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {/* The counts are the legend, and each one is the filter for its band. */}
        {(
          [
            ["error", totals.error, "var(--dang)"],
            ["warn", totals.warn, "var(--wait)"],
            ["info", totals.info, "var(--brand)"],
          ] as const
        ).map(([band, count, colour]) => (
          <Link
            key={band}
            href={onSeverity(band === "info" ? null : band)}
            data-testid={`log-band-${band}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11.5,
              textDecoration: "none",
              color: "var(--ink-2)",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: colour,
                opacity: band === "info" ? 0.4 : 1,
              }}
            />
            <span style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>
              {band}
            </span>
            <span style={{ fontFamily: "var(--mono)", color: "var(--ink)" }}>
              {t.fmt.number(count)}
            </span>
          </Link>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
          {t("logs.perBar", { minutes: Math.max(1, Math.round(stepMs / 60_000)) })}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: 76, display: "block" }}
      >
        {buckets.map((b) => {
          const x = ((b.at - from.getTime()) / span) * width;
          const total = b.error + b.warn + b.info;
          let y = height;
          return (
            <Link key={b.at} href={zoom(new Date(b.at), new Date(b.at + stepMs))}>
              <g>
                {/*
                 * A full-height, invisible target behind each bar: a two-pixel
                 * bar is a two-pixel click, and the tallest bar is the one
                 * nobody needs to click.
                 */}
                <rect
                  x={x}
                  y={0}
                  width={Math.max(barWidth, width / buckets.length)}
                  height={height}
                  fill="transparent"
                >
                  <title>
                    {t("logs.barTitle", {
                      time: new Date(b.at).toISOString().slice(11, 16),
                      total: t.fmt.number(total),
                      errors: t.fmt.number(b.error),
                    })}
                  </title>
                </rect>
                {bands.map((band) => {
                  const value = b[band.key];
                  if (value === 0) return null;
                  /*
                   * A minimum of a pixel and a half for a band that exists.
                   *
                   * Five thousand errors under a million info lines is 0.4 %
                   * of the bar — a quarter of a pixel, which is nothing. The
                   * red is the one thing a reader scans this drawing for, and
                   * a band that is present must be visible; the exact counts
                   * are on the bar and in the chips above it.
                   */
                  const h = Math.max(value > 0 ? 1.6 : 0, (value / tallest) * (height - 2));
                  y -= h;
                  return (
                    <rect
                      key={band.key}
                      x={x}
                      y={y}
                      width={barWidth}
                      height={h}
                      fill={band.colour}
                      opacity={band.opacity}
                    />
                  );
                })}
              </g>
            </Link>
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
        <span>{stamp(from)}</span>
        <span>{stamp(new Date((from.getTime() + to.getTime()) / 2))}</span>
        <span>{stamp(to)}</span>
      </div>
    </div>
  );
}

/** A window of hours shows hours; a window of days shows the day too. */
function stamp(at: Date): string {
  return at.toISOString().slice(5, 16).replace("T", " ");
}
