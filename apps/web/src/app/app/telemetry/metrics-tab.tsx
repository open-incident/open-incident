import Link from "next/link";
import { getT } from "@/i18n/server";
import { metricCatalogue, metricGraphFor, metricSparks, type MetricName } from "@/lib/telemetry";
import { MetricLines } from "./metric-lines";

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};
const MONO: React.CSSProperties = { fontFamily: "var(--mono)", fontSize: 12 };

/**
 * The metric explorer: a catalogue you can scan, and one chart.
 *
 * Two things were wrong with the screen this replaces, and both came from the
 * same place — it had no idea which of forty metrics the reader cared about.
 * A list of names with no shape cannot be scanned, so every question started
 * with opening metrics one at a time; and once opened, a metric with four
 * hosts was drawn as four separate little charts with four unrelated y axes,
 * which is not a comparison.
 *
 * So: a sparkline on every row, from one query for the whole list, and one
 * chart with every series on one scale — with the label to split on and the
 * way a bucket is reduced both stated and both in the address.
 */
export async function MetricsTab({
  tenantId,
  open,
  from,
  to,
  groupBy,
  agg,
  link,
}: {
  tenantId: string;
  open?: string;
  from: Date;
  to: Date;
  groupBy?: string;
  agg?: "avg" | "sum" | "max";
  link: (over: Record<string, string | undefined>) => string;
}) {
  const t = await getT();
  const [names, sparks] = await Promise.all([
    metricCatalogue(tenantId),
    // One query for every sparkline in the list: 13 ms over a day, because the
    // per-minute rollup is what it reads. A query per row would be forty.
    metricSparks(tenantId, { from, to }),
  ]);
  if (names.length === 0) {
    return (
      <div
        style={{
          ...CARD,
          padding: "28px 20px",
          textAlign: "center",
          color: "var(--ink-3)",
          fontSize: 13,
        }}
      >
        {t("telemetry.noMetrics")}
      </div>
    );
  }
  const graph = open
    ? await metricGraphFor(tenantId, { metric: open, from, to, groupBy, agg })
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/*
        The chart first, then the catalogue.
        A reader who opened a metric came to look at it; making them scroll
        past forty names to reach their own chart is the one thing this screen
        used to get wrong at every width.
      */}
      {open && graph && (
        <div style={{ ...CARD, padding: "14px 16px" }}>
          <MetricLines
            graph={graph}
            metric={open}
            unit={names.find((m: MetricName) => m.metric_name === open)?.unit ?? ""}
            from={from}
            to={to}
            onGroup={(key) => link({ metric: open, group: key ?? undefined })}
            onAgg={(next) => link({ metric: open, group: groupBy, agg: next })}
          />
        </div>
      )}

      <div style={{ ...CARD, overflow: "hidden", alignSelf: "start", width: "100%" }}>
        {names.map((m: MetricName, i) => (
          <Link
            key={m.metric_name}
            href={link({ metric: m.metric_name, group: undefined, agg: undefined })}
            data-testid="metric-row"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) 120px 74px 60px",
              gap: 12,
              alignItems: "center",
              padding: "8px 14px",
              borderTop: i ? "1px solid var(--line-2)" : "none",
              background: m.metric_name === open ? "var(--sunk)" : "transparent",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <span style={{ minWidth: 0 }}>
              <span style={{ ...MONO, display: "block", fontSize: 12.5, color: "var(--ink)" }}>
                {m.metric_name}
              </span>
              <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                {m.type}
                {m.unit && m.unit !== "1" ? ` · ${m.unit}` : ""}
              </span>
            </span>
            {/* The shape, so a list of forty names can be scanned for the one
                that moved rather than opened one at a time. */}
            <Spark values={sparks.get(m.metric_name) ?? []} />
            <span style={{ ...MONO, fontSize: 11, color: "var(--ink-3)", textAlign: "right" }}>
              {t("telemetry.seriesCount", { count: m.series })}
            </span>
            <span style={{ ...MONO, fontSize: 11, color: "var(--ink-3)", textAlign: "right" }}>
              {m.last_seen.slice(11, 16)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Twenty-four points of a metric, drawn small. */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <span style={{ color: "var(--line)", fontSize: 10 }}>—</span>;
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  const span = hi - lo || 1;
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" style={{ width: "100%", height: 18 }}>
      <polyline
        points={values
          .map((v, i) => `${(i / (values.length - 1)) * 100},${22 - ((v - lo) / span) * 20}`)
          .join(" ")}
        fill="none"
        stroke="var(--brand)"
        strokeWidth="1.4"
        vectorEffect="non-scaling-stroke"
        opacity="0.75"
      />
    </svg>
  );
}
