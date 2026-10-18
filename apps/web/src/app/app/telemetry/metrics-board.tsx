"use client";

/**
 * The Metrics tab's live half: the bar (service, compare, range), the zoom
 * banner, and the sections of charts that share one crosshair and one window.
 * The numbers were computed by the server; a zoom or a range is a new address
 * the server reads again at the finer resolution.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { formatInstant, formatSpan, type ChartSpec } from "@openincident/ui";
import { useT } from "@/i18n/client";
import { Chart, ChartBoard, useBoard } from "./charts";

export type MetricsSection = {
  t: string;
  d: string;
  charts: Array<{ spec: ChartSpec; h: number; hint: boolean; full: boolean }>;
};

const RANGES = ["15m", "1h", "6h", "24h", "7d"];

export function MetricsBoard(props: {
  service: string;
  chips: Array<{ n: string; dot: string }>;
  range: string;
  from: number;
  to: number;
  zoomed: boolean;
  compare: boolean;
  traces: number;
  sections: MetricsSection[];
  atlas: ReactNode;
  endpoints: ReactNode;
}) {
  return (
    <ChartBoard from={props.from} to={props.to} zoomed={props.zoomed} compare={props.compare}>
      <Inner {...props} />
    </ChartBoard>
  );
}

function Inner({
  service,
  chips,
  range,
  compare,
  traces,
  sections,
  atlas,
  endpoints,
}: Parameters<typeof MetricsBoard>[0]) {
  const t = useT();
  const pathname = usePathname();
  const params = useSearchParams();
  const board = useBoard();

  const href = (over: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    next.set("tab", "metrics");
    for (const [k, v] of Object.entries(over)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    return `${pathname}?${next.toString()}`;
  };
  const tz = { timeZone: t.timeZone, locale: "en-GB" };
  const zoomL = `${formatInstant(board.from, 3_600_000, tz)} – ${formatInstant(board.to, 3_600_000, tz)}`;
  const win = `&service=${encodeURIComponent(service)}&from=${Math.round(board.from)}&to=${Math.round(board.to)}`;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {chips.map((v) => {
          const on = v.n === service;
          return (
            <Link
              key={v.n}
              href={href({ service: v.n, from: null, to: null })}
              scroll={false}
              data-testid="metrics-service"
              aria-current={on ? "true" : undefined}
              style={{
                height: 30,
                padding: "0 11px",
                borderRadius: 999,
                border: `1px solid ${on ? "var(--brand)" : "var(--line)"}`,
                background: on ? "var(--brand-t)" : "var(--panel)",
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontFamily: "var(--mono)",
                fontSize: 12,
                fontWeight: 600,
                color: on ? "var(--brand)" : "var(--ink-2)",
                cursor: "pointer",
                whiteSpace: "nowrap",
                textDecoration: "none",
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: v.dot }} />
              {v.n}
            </Link>
          );
        })}
        <span style={{ flex: 1 }} />
        <Link
          href={href({ cmp: compare ? null : "1" })}
          scroll={false}
          data-testid="metrics-compare"
          aria-pressed={compare}
          style={{
            height: 30,
            padding: "0 11px",
            borderRadius: 9,
            border: `1px solid ${compare ? "var(--brand-b)" : "var(--line)"}`,
            background: compare ? "var(--brand-t)" : "var(--panel)",
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontSize: 12,
            fontWeight: 600,
            color: compare ? "var(--brand)" : "var(--ink-2)",
            cursor: "pointer",
            whiteSpace: "nowrap",
            textDecoration: "none",
          }}
        >
          <span style={{ width: 12, borderTop: "2px dashed currentColor" }} />
          {t("tel2.compare")}
        </Link>
        <div
          style={{
            display: "flex",
            gap: 2,
            background: "var(--sunk)",
            borderRadius: 9,
            padding: 3,
          }}
        >
          {RANGES.map((l) => {
            const on = l === range && !board.zoomed;
            return (
              <Link
                key={l}
                href={href({ range: l === "1h" ? null : l, from: null, to: null })}
                scroll={false}
                data-testid={`metrics-range-${l}`}
                style={{
                  height: 26,
                  padding: "0 10px",
                  borderRadius: 7,
                  background: on ? "var(--panel)" : "transparent",
                  boxShadow: on ? "0 1px 2px rgba(13,22,28,.12)" : "none",
                  display: "flex",
                  alignItems: "center",
                  fontFamily: "var(--mono)",
                  fontSize: 11.5,
                  fontWeight: on ? 700 : 500,
                  color: on ? "var(--ink)" : "var(--ink-3)",
                  cursor: "pointer",
                  textDecoration: "none",
                }}
              >
                {l}
              </Link>
            );
          })}
        </div>
      </div>

      {board.zoomed && (
        <div
          data-testid="metrics-zoom"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "var(--brand-t)",
            border: "1px solid var(--brand-b)",
            borderRadius: 12,
            padding: "8px 10px 8px 14px",
            flexWrap: "wrap",
            animation: "oi-rise .12s ease backwards",
          }}
        >
          <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
            {t
              .parts("tel2.zoomedTo", "range", { span: formatSpan(board.to - board.from) })
              .map((p, i) =>
                i === 0 ? (
                  <span key={i}>
                    {p}
                    <strong style={{ fontFamily: "var(--mono)", color: "var(--ink)" }}>
                      {zoomL}
                    </strong>
                  </span>
                ) : (
                  <span key={i}>{p}</span>
                ),
              )}
          </span>
          <span style={{ flex: 1 }} />
          <Link
            href={`/app/telemetry?tab=traces${win}`}
            style={BANNER_LINK}
            data-testid="metrics-zoom-traces"
          >
            {t("tel2.tracesInRange", { count: board.pending ? "…" : traces })}
          </Link>
          <Link
            href={`/app/telemetry?tab=logs${win}`}
            style={BANNER_LINK}
            data-testid="metrics-zoom-logs"
          >
            {t("tel2.logsInRange")}
          </Link>
          <span
            role="button"
            tabIndex={0}
            onClick={board.reset}
            style={{ ...BANNER_LINK, background: "var(--brand)", color: "#fff", border: 0 }}
          >
            ↺ {t("tel2.reset")}
          </span>
        </div>
      )}

      {atlas}

      {sections.map((sec) => (
        <div key={sec.t} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{sec.t}</span>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{sec.d}</span>
          </div>
          {sec.charts.length === 0 ? (
            <div
              style={{
                border: "1px dashed var(--line)",
                borderRadius: "var(--radius-card)",
                padding: "14px 16px",
                fontSize: 12.5,
                color: "var(--ink-3)",
              }}
            >
              {t("tel2.noDependencies")}
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))",
                gap: 12,
              }}
            >
              {sec.charts.map((c, i) => (
                <div key={i} style={{ gridColumn: c.full ? "1 / -1" : "auto", minWidth: 0 }}>
                  <Chart spec={c.spec} height={c.h} hint={c.hint} testId={`metrics-chart`} />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {endpoints}
    </>
  );
}

const BANNER_LINK: React.CSSProperties = {
  height: 28,
  padding: "0 11px",
  borderRadius: 8,
  background: "var(--panel)",
  border: "1px solid var(--brand-b)",
  display: "flex",
  alignItems: "center",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--brand)",
  cursor: "pointer",
  whiteSpace: "nowrap",
  textDecoration: "none",
};
