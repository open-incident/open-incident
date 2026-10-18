import Link from "next/link";
import { getT } from "@/i18n/server";
import { logs as readLogs } from "@/lib/telemetry";
import {
  logCounts,
  parseLogQuery,
  type RangeKey,
  type TelemetrySearch,
} from "@/lib/telemetry-board";
import { LogsBar, LiveRefresh } from "./logs-client";

/**
 * Telemetry — Logs (design: "Telemetry — Logs").
 *
 * The query box, live tail, and the lines as a terminal: newest first, each
 * opening its trace when it has one. Live tail reads the window again every
 * few seconds; paused, the list stays as it is and says how much of the
 * window it shows.
 */
const LEVEL_INK: Record<string, string> = {
  FATAL: "#F0645C",
  ERROR: "#F0645C",
  WARN: "#E0A030",
  INFO: "#7CC3E8",
  DEBUG: "#6F7E89",
};

function level(n: number): string {
  return n >= 21 ? "FATAL" : n >= 17 ? "ERROR" : n >= 13 ? "WARN" : n >= 9 ? "INFO" : "DEBUG";
}

export async function LogsView({
  tenantId,
  from,
  to,
  sp,
  range,
}: {
  tenantId: string;
  from: Date;
  to: Date;
  sp: TelemetrySearch;
  range: RangeKey;
}) {
  const t = await getT();
  // A service handed over from Metrics joins the box, so what is filtered is written.
  const q = (sp.q ?? (sp.service ? `service:${sp.service}` : "")).trim();
  const parsed = parseLogQuery(q);
  const traceId = sp.trace ?? parsed.traceId;
  const opts = {
    from,
    to,
    service: parsed.service,
    filter: parsed.filter,
    traceId,
    spanId: sp.span,
  };
  let failure: string | null = null;
  const [page, counts] = await Promise.all([
    readLogs(tenantId, { ...opts, limit: 60 }).catch((err: Error) => {
      failure = err.message;
      return { rows: [], older: null };
    }),
    logCounts(tenantId, opts),
  ]);
  const live = sp.live !== "0";
  const firstError = page.rows.findIndex((r) => r.severity_number >= 17);
  const windowLabel = t(`tel2.short.${range}` as "tel2.short.1h");

  return (
    <div
      data-screen-label="Telemetry — Logs"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        animation: "oi-rise .16s ease backwards",
      }}
    >
      <LogsBar
        q={q}
        suffix={
          traceId
            ? t("tel2.logsSuffixTrace", { trace: traceId.slice(0, 8) })
            : t("tel2.logsSuffix", { window: windowLabel })
        }
        live={live}
      />
      {live && <LiveRefresh />}
      {failure && (
        <div
          role="alert"
          style={{
            border: "1px solid var(--dang)",
            background: "var(--dang-t)",
            borderRadius: 11,
            padding: "10px 14px",
            fontSize: 12.5,
          }}
        >
          {failure}
        </div>
      )}
      <div
        data-testid="log-lines"
        style={{
          background: "#0F1417",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-card)",
          overflow: "hidden",
          fontFamily: "var(--mono)",
          fontSize: 11.5,
          lineHeight: 1.6,
        }}
      >
        {page.rows.length === 0 && (
          <div style={{ padding: "12px 16px", color: "#6F7E89" }}>{t("tel2.noLogs")}</div>
        )}
        {page.rows.map((r, i) => {
          const lv = level(r.severity_number);
          const at = new Date(`${r.ts.replace(" ", "T")}Z`);
          const bg =
            r.scope_name === "deploy"
              ? "rgba(176,140,255,.10)"
              : i === firstError
                ? "rgba(240,100,92,.08)"
                : "transparent";
          const row = (
            <>
              <span style={{ color: "#6F7E89" }}>{t.fmt.time(at, t.timeZone)}</span>
              <span style={{ fontWeight: 700, color: LEVEL_INK[lv] }}>{lv}</span>
              <span
                style={{
                  color: "#8FB6C4",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.service_name}
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.body}
              </span>
            </>
          );
          const style: React.CSSProperties = {
            display: "grid",
            gridTemplateColumns: "78px 52px 140px minmax(0,1fr)",
            gap: 12,
            padding: "5px 16px",
            borderBottom: "1px solid #1C2329",
            color: "#C9D3DA",
            background: bg,
            textDecoration: "none",
          };
          return r.trace_id ? (
            <Link
              key={i}
              href={`/app/telemetry?tab=traces&trace=${r.trace_id}${r.span_id ? `&span=${r.span_id}` : ""}`}
              data-testid="log-line"
              title={t("tel2.openTrace")}
              style={style}
            >
              {row}
            </Link>
          ) : (
            <div key={i} data-testid="log-line" style={style}>
              {row}
            </div>
          );
        })}
        <div style={{ padding: "8px 16px", color: "#6F7E89", fontSize: 11 }} data-testid="log-foot">
          {live
            ? t("tel2.logsFollowing", { n: Math.round(counts.perMinute) })
            : t("tel2.logsPaused", {
                shown: t.fmt.number(page.rows.length),
                total: t.fmt.number(counts.total),
              })}
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("tel2.logsFoot")}</div>
    </div>
  );
}
