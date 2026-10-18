/**
 * A monitor's rules, read back as the sentences the design writes —
 * "slower than 2 s → Degraded" — and the editor that rewrites them.
 *
 * The sentence is rebuilt from the stored row, never from the type's
 * defaults: what is shown is what the next check obeys.
 */

import type { MonitorCriterion } from "@openincident/db";
import type { MessageKey } from "@/i18n/dictionaries/en";
import { saveMonitorCriteria } from "../actions";

type T = ((key: MessageKey, vars?: Record<string, string | number>) => string) & {
  fmt: { number: (n: number) => string };
};

const OP_LABEL: Record<string, string> = {
  eq: "=",
  neq: "≠",
  lt: "<",
  lte: "≤",
  gt: ">",
  gte: "≥",
  contains: "contains",
  not_contains: "does not contain",
  matches: "matches",
};

/** The left-hand sides a criterion can read, in the order the editor lists them. */
const CRITERION_FIELDS = [
  "reachable",
  "status_code",
  "response_time_ms",
  "body_contains",
  "body_matches",
  "header",
  "days_to_expiry",
  "record_value",
  "ping_received_in",
] as const;

export const STATE_INK: Record<string, string> = {
  online: "var(--ok)",
  degraded: "var(--wait)",
  offline: "var(--dang)",
};

export function msLabel(v: number): string {
  return v >= 1000 ? `${+(v / 1000).toFixed(2)} s` : `${v} ms`;
}

/** The left half of a rule, in words: "unreachable", "slower than 2 s", "status ≥ 400". */
export function criterionCondition(t: T, c: MonitorCriterion): string {
  const v = c.value;
  if (c.on === "reachable") {
    return (c.op === "eq") === (v === "true") ? t("mon2.c.reachable") : t("mon2.c.unreachable");
  }
  if (c.on === "response_time_ms" && (c.op === "gt" || c.op === "gte")) {
    return t("mon2.c.slower", { value: msLabel(Number(v)) });
  }
  if (c.on === "response_time_ms" && (c.op === "lt" || c.op === "lte")) {
    return t("mon2.c.faster", { value: msLabel(Number(v)) });
  }
  if (c.on === "days_to_expiry" && (c.op === "lt" || c.op === "lte")) {
    return t("mon2.c.expiresWithin", { n: v });
  }
  return `${t(`monitors.on.${c.on}` as MessageKey)} ${OP_LABEL[c.op] ?? c.op} ${v}`;
}

/** One rule as the CRITERIA card lists it, with its colour and the alert it raises. */
export function CriterionLine({ t, c }: { t: T; c: MonitorCriterion }) {
  const ink = STATE_INK[c.then] ?? "var(--ink)";
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: ink,
          marginTop: 7,
          flex: "none",
        }}
      />
      <span>
        {criterionCondition(t, c)} →{" "}
        <strong style={{ color: ink }}>{t(`monitors.state.${c.then}` as MessageKey)}</strong>
        {c.then === "offline"
          ? ` ${t("mon2.c.alert", { p: "P2" })}`
          : c.then === "degraded"
            ? ` ${t("mon2.c.alert", { p: "P3" })}`
            : ""}
      </span>
    </div>
  );
}

const MICRO: React.CSSProperties = {
  height: 32,
  minWidth: 0,
  flex: 1,
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "0 8px",
  fontSize: 12.5,
  background: "var(--panel)",
  color: "inherit",
};

/** The editor: one row per rule, and a blank one at the end — that is how a rule is added. */
export function CriteriaEditor({
  t,
  monitorId,
  criteria,
}: {
  t: T;
  monitorId: string;
  criteria: MonitorCriterion[];
}) {
  return (
    <form
      action={saveMonitorCriteria}
      data-testid="criteria-edit"
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <input type="hidden" name="id" value={monitorId} />
      {[...criteria, null].map((c, i) => (
        <div
          key={i}
          data-testid="criterion-row"
          style={{ display: "flex", gap: 6, alignItems: "center" }}
        >
          <span
            style={{
              width: 20,
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--ink-3)",
              flex: "none",
            }}
          >
            {i + 1}
          </span>
          <select
            name="on"
            defaultValue={c?.on ?? "response_time_ms"}
            className="oi-field"
            style={MICRO}
          >
            {CRITERION_FIELDS.map((f) => (
              <option key={f} value={f}>
                {t(`monitors.on.${f}` as MessageKey)}
              </option>
            ))}
          </select>
          <select
            name="op"
            defaultValue={c?.op ?? "gt"}
            className="oi-field"
            style={{ ...MICRO, width: 120, flex: "none" }}
          >
            {Object.keys(OP_LABEL).map((op) => (
              <option key={op} value={op}>
                {OP_LABEL[op]}
              </option>
            ))}
          </select>
          <input
            name="value"
            defaultValue={c?.value ?? ""}
            placeholder={t("monitors.criterionValue")}
            className="oi-field"
            style={{ ...MICRO, width: 120, flex: "none", fontFamily: "var(--mono)" }}
          />
          <span style={{ color: "var(--ink-3)", flex: "none" }}>→</span>
          <select
            name="then"
            defaultValue={c?.then ?? "degraded"}
            className="oi-field"
            style={{ ...MICRO, width: 130, flex: "none" }}
          >
            {(["online", "degraded", "offline"] as const).map((st) => (
              <option key={st} value={st}>
                {t(`monitors.state.${st}` as MessageKey)}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
        <button
          type="submit"
          data-testid="criteria-save"
          className="oi-hover-brand-2"
          style={{
            height: 34,
            padding: "0 14px",
            borderRadius: 9,
            background: "var(--brand)",
            color: "var(--on-brand)",
            border: 0,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {t("common.save")}
        </button>
        <span style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.45 }}>
          {t("monitors.criteriaNote")}
        </span>
      </div>
    </form>
  );
}
