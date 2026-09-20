"use client";

/**
 * What a telemetry monitor watches, written as a sentence.
 *
 * The four telemetry types have no address to type: their subject is a
 * question put to what the services already send. That question has seven
 * parts, and a form of seven boxes would read like a database console — so the
 * parts are laid out as a sentence, and the boxes are the words that vary.
 *
 * The one thing the sentence cannot hide is the filter. `service_name =
 * 'checkout' AND severity_number >= 17` is exact and a picker over every field
 * and every value would be neither smaller nor clearer. The fields it accepts
 * are listed underneath, because a filter that names a field we do not have is
 * refused, and a refusal with no list is a guessing game.
 */

import { useState } from "react";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/dictionaries/en";

const CONTROL: React.CSSProperties = {
  height: 34,
  border: "1px solid var(--line)",
  borderRadius: 9,
  padding: "0 9px",
  fontSize: 13,
  outline: "none",
  background: "var(--panel)",
};

const LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};

/** The fields a filter may name, per type — the same list the evaluator holds. */
const FIELDS: Record<string, string[]> = {
  logs: ["service_name", "environment", "severity_number", "severity_text", "body", "trace_id"],
  traces: [
    "service_name",
    "environment",
    "name",
    "kind",
    "status_code",
    "duration_ms",
    "http_status_code",
  ],
  exceptions: ["service_name", "environment", "release", "type", "message", "fingerprint"],
  metrics: [],
};

/** The aggregates that need a column to run on. */
const NEEDS_FIELD = new Set(["sum", "avg", "min", "max", "p50", "p95", "p99"]);

const NUMERIC: Record<string, string[]> = {
  logs: ["severity_number"],
  traces: ["duration_ms", "http_status_code"],
  exceptions: [],
  metrics: [],
};

export function TelemetryEditor({ kind }: { kind: string }) {
  const t = useT();
  const promql = kind === "metrics";
  const [aggregate, setAggregate] = useState(promql ? "count" : "count");
  const [condition, setCondition] = useState<"threshold" | "anomaly">("threshold");
  const fields = FIELDS[kind] ?? [];
  const numeric = NUMERIC[kind] ?? [];

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: "13px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        background: "var(--sunk)",
      }}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={LABEL}>
          {promql ? t("telemetryMonitor.promql") : t("telemetryMonitor.filter")}
        </span>
        <input
          name="telemetryQuery"
          required
          className="oi-field"
          data-testid="telemetry-query"
          placeholder={t(`telemetryMonitor.placeholder.${kind}` as MessageKey)}
          style={{ ...CONTROL, width: "100%", fontFamily: "var(--mono)" }}
        />
        <span style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.45 }}>
          {promql
            ? t("telemetryMonitor.promqlHint")
            : t("telemetryMonitor.filterHint", { fields: fields.join(", ") })}
        </span>
      </label>

      {!promql && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={LABEL}>{t("telemetryMonitor.measure")}</span>
            <select
              name="telemetryAggregate"
              value={aggregate}
              onChange={(e) => setAggregate(e.target.value)}
              style={CONTROL}
            >
              <option value="count">{t("telemetryMonitor.aggCount")}</option>
              <option value="rate">{t("telemetryMonitor.aggRate")}</option>
              {numeric.length > 0 && (
                <>
                  <option value="avg">{t("telemetryMonitor.aggAvg")}</option>
                  <option value="sum">{t("telemetryMonitor.aggSum")}</option>
                  <option value="min">{t("telemetryMonitor.aggMin")}</option>
                  <option value="max">{t("telemetryMonitor.aggMax")}</option>
                  <option value="p50">{t("telemetryMonitor.aggP50")}</option>
                  <option value="p95">{t("telemetryMonitor.aggP95")}</option>
                  <option value="p99">{t("telemetryMonitor.aggP99")}</option>
                </>
              )}
            </select>
          </label>
          {/*
            Only shown when the measure needs one. A `count` has no column to
            average, and a select offering one would be a question with no
            answer.
          */}
          {NEEDS_FIELD.has(aggregate) && (
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={LABEL}>{t("telemetryMonitor.of")}</span>
              <select name="telemetryField" style={CONTROL}>
                {numeric.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={LABEL}>{t("telemetryMonitor.over")}</span>
            <select name="telemetryWindow" defaultValue="5" style={CONTROL}>
              <option value="1">{t("telemetryMonitor.min1")}</option>
              <option value="5">{t("telemetryMonitor.min5")}</option>
              <option value="15">{t("telemetryMonitor.min15")}</option>
              <option value="30">{t("telemetryMonitor.min30")}</option>
              <option value="60">{t("telemetryMonitor.min60")}</option>
            </select>
          </label>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={LABEL}>{t("telemetryMonitor.fires")}</span>
          <select
            name="telemetryCondition"
            value={condition}
            onChange={(e) => setCondition(e.target.value as "threshold" | "anomaly")}
            style={CONTROL}
          >
            <option value="threshold">{t("telemetryMonitor.whenThreshold")}</option>
            <option value="anomaly">{t("telemetryMonitor.whenAnomaly")}</option>
          </select>
        </label>
        {condition === "threshold" ? (
          <>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={LABEL}>{t("telemetryMonitor.comparison")}</span>
              <select name="telemetryOp" defaultValue=">" style={CONTROL}>
                <option value=">">&gt;</option>
                <option value=">=">&ge;</option>
                <option value="<">&lt;</option>
                <option value="<=">&le;</option>
                <option value="==">=</option>
                <option value="!=">&ne;</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={LABEL}>{t("telemetryMonitor.value")}</span>
              <input
                name="telemetryValue"
                type="number"
                step="any"
                defaultValue="0"
                required
                className="oi-field"
                style={{ ...CONTROL, fontFamily: "var(--mono)" }}
              />
            </label>
          </>
        ) : (
          <label style={{ display: "flex", flexDirection: "column", gap: 5, gridColumn: "span 2" }}>
            <span style={LABEL}>{t("telemetryMonitor.direction")}</span>
            <select name="telemetryDirection" defaultValue="high" style={CONTROL}>
              <option value="high">{t("telemetryMonitor.dirHigh")}</option>
              <option value="low">{t("telemetryMonitor.dirLow")}</option>
              <option value="any">{t("telemetryMonitor.dirAny")}</option>
            </select>
          </label>
        )}
      </div>

      {condition === "anomaly" && (
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
          {t("telemetryMonitor.learningNote")}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={LABEL}>{t("telemetryMonitor.forLabel")}</span>
          <select name="telemetryFor" defaultValue="2" style={CONTROL}>
            <option value="1">{t("telemetryMonitor.for1")}</option>
            <option value="2">{t("telemetryMonitor.forN", { n: 2 })}</option>
            <option value="3">{t("telemetryMonitor.forN", { n: 3 })}</option>
            <option value="5">{t("telemetryMonitor.forN", { n: 5 })}</option>
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={LABEL}>{t("telemetryMonitor.groupBy")}</span>
          <input
            name="telemetryGroupBy"
            className="oi-field"
            placeholder={promql ? "route" : (fields[0] ?? "")}
            style={{ ...CONTROL, fontFamily: "var(--mono)" }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={LABEL}>{t("telemetryMonitor.noData")}</span>
          <select name="telemetryNoData" defaultValue="ignore" style={CONTROL}>
            <option value="ignore">{t("telemetryMonitor.noDataIgnore")}</option>
            <option value="trigger">{t("telemetryMonitor.noDataTrigger")}</option>
            <option value="zero">{t("telemetryMonitor.noDataZero")}</option>
          </select>
        </label>
      </div>

      <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
        {t("telemetryMonitor.groupByNote")}
      </div>
    </div>
  );
}
