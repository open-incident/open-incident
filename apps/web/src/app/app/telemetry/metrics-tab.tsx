import Link from "next/link";
import { getT } from "@/i18n/server";
import { metricChart, metricCatalogue, type MetricName } from "@/lib/telemetry";

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};
const MONO: React.CSSProperties = { fontFamily: "var(--mono)", fontSize: 12 };

/**
 * A sparkline, drawn from the per-minute rollup.
 *
 * Deliberately not a charting library: one path, no axes, no legend. The
 * question this answers is "is this series alive and roughly flat", which is
 * the question somebody has while reading a list. The real chart belongs to
 * the dashboards, and dashboards are the next milestone — so this says less
 * rather than pretending to be one.
 */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <span style={{ ...MONO, color: "var(--ink-3)" }}>—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / span) * 26}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ width: "100%", height: 30 }}>
      <polyline
        points={points}
        fill="none"
        stroke="var(--brand)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export async function MetricsTab({ tenantId, open }: { tenantId: string; open?: string }) {
  const t = await getT();
  const names = await metricCatalogue(tenantId);
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
  const chart = open ? await metricChart(tenantId, open) : null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: open ? "minmax(0,1fr) minmax(0,1.1fr)" : "1fr",
        gap: 14,
      }}
    >
      <div style={{ ...CARD, overflow: "hidden", alignSelf: "start" }}>
        {names.map((m: MetricName, i) => (
          <Link
            key={m.metric_name}
            href={`/app/telemetry?tab=metrics&metric=${encodeURIComponent(m.metric_name)}`}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) 74px 60px",
              gap: 10,
              alignItems: "center",
              padding: "9px 14px",
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
                {m.unit ? ` · ${m.unit}` : ""}
              </span>
            </span>
            <span style={{ ...MONO, fontSize: 11, color: "var(--ink-3)", textAlign: "right" }}>
              {t("telemetry.seriesCount", { n: m.series })}
            </span>
            <span style={{ ...MONO, fontSize: 11, color: "var(--ink-3)", textAlign: "right" }}>
              {m.last_seen.slice(11, 16)}
            </span>
          </Link>
        ))}
      </div>

      {open && chart && (
        <div style={{ ...CARD, padding: "14px 16px" }}>
          <div style={{ ...MONO, fontSize: 12.5, marginBottom: 4 }}>{open}</div>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 12 }}>
            {t("telemetry.lastHours", { n: 24 })}
          </div>
          {chart.series.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("telemetry.noPoints")}</div>
          ) : (
            chart.series.map((s) => (
              <div key={s.hash} style={{ marginBottom: 14 }}>
                <div style={{ ...MONO, fontSize: 11, color: "var(--ink-2)", marginBottom: 2 }}>
                  {Object.entries(s.labels).length === 0
                    ? t("telemetry.noLabels")
                    : Object.entries(s.labels)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(" · ")}
                </div>
                <Spark values={s.values} />
                <div style={{ ...MONO, fontSize: 11, color: "var(--ink-3)" }}>
                  {t("telemetry.lastValue", { v: String(s.values[s.values.length - 1] ?? "—") })}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
