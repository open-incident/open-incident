"use client";

/**
 * The journey editor — eight verbs, a selector, a value and a patience.
 *
 * It writes one hidden field, the whole journey as JSON, which the server
 * re-reads with the same `parseSyntheticConfig` the runner uses. The browser is
 * not trusted to have produced something valid: a journey that does not parse
 * on the server is a monitor that is not created, and the reader is told so.
 *
 * Used twice — when creating a monitor, and when fixing its journey afterwards.
 */

import { useMemo, useState } from "react";
import {
  SYNTHETIC_MAX_STEPS,
  SYNTHETIC_STEP_KINDS,
  stepNeedsSelector,
  stepNeedsValue,
  type SyntheticConfig,
  type SyntheticStep,
  type SyntheticStepKind,
} from "@openincident/oncall/synthetic-steps";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/dictionaries/en";

const CONTROL: React.CSSProperties = {
  height: 32,
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "0 8px",
  fontSize: 12.5,
  outline: "none",
  background: "var(--panel)",
  color: "inherit",
  width: "100%",
  minWidth: 0,
};

const LABEL: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".08em",
  color: "var(--ink-3)",
};

const TINY: React.CSSProperties = {
  height: 26,
  width: 26,
  border: "1px solid var(--line)",
  borderRadius: 7,
  background: "var(--panel)",
  color: "var(--ink-3)",
  fontSize: 12,
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
};

/** A row while it is being edited: everything is a string until it is parsed. */
type Row = { kind: SyntheticStepKind; selector: string; value: string; seconds: string };

function toRow(step: SyntheticStep): Row {
  return {
    kind: step.kind,
    selector: step.selector ?? "",
    value: step.value ?? "",
    seconds: step.timeoutMs ? String(Math.round(step.timeoutMs / 1000)) : "",
  };
}

const BUDGETS = [30, 60, 120, 300];

export function JourneyEditor({
  initial,
  fieldName = "steps",
}: {
  initial?: SyntheticConfig | null;
  /** The hidden field the form posts. */
  fieldName?: string;
}) {
  const t = useT();
  const [rows, setRows] = useState<Row[]>(
    initial?.steps.map(toRow) ?? [{ kind: "goto", selector: "", value: "", seconds: "" }],
  );
  const [budget, setBudget] = useState(Math.round((initial?.budgetMs ?? 60_000) / 1000));

  const payload = useMemo(
    () =>
      JSON.stringify({
        steps: rows.map((r) => ({
          kind: r.kind,
          selector: r.selector.trim() || undefined,
          value: r.value.trim() || undefined,
          timeoutMs: r.seconds.trim() ? Number(r.seconds) * 1000 : undefined,
        })),
        budgetMs: budget * 1000,
        viewport: initial?.viewport ?? { width: 1280, height: 800 },
      }),
    [rows, budget, initial?.viewport],
  );

  const patch = (i: number, next: Partial<Row>) =>
    setRows((list) => list.map((r, j) => (i === j ? { ...r, ...next } : r)));
  const move = (i: number, by: number) =>
    setRows((list) => {
      const j = i + by;
      if (j < 0 || j >= list.length) return list;
      const copy = [...list];
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      return copy;
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input type="hidden" name={fieldName} value={payload} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={LABEL}>{t("synthetic.journey")}</span>
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{t("synthetic.journeyHint")}</span>
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("synthetic.noSteps")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "18px 118px minmax(0,1fr) minmax(0,1fr) 46px 62px",
              gap: 6,
              ...LABEL,
            }}
          >
            <span />
            <span>{t("synthetic.colStep")}</span>
            <span>{t("synthetic.colSelector")}</span>
            <span>{t("synthetic.colValue")}</span>
            <span>{t("synthetic.colTimeout")}</span>
            <span />
          </div>
          {rows.map((row, i) => (
            <div
              key={i}
              data-testid={`journey-step-${i}`}
              style={{
                display: "grid",
                gridTemplateColumns: "18px 118px minmax(0,1fr) minmax(0,1fr) 46px 62px",
                gap: 6,
                alignItems: "center",
              }}
            >
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
                {i + 1}
              </span>
              <select
                aria-label={t("synthetic.colStep")}
                value={row.kind}
                onChange={(e) => patch(i, { kind: e.target.value as SyntheticStepKind })}
                style={CONTROL}
              >
                {SYNTHETIC_STEP_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`synthetic.kind.${k}` as MessageKey)}
                  </option>
                ))}
              </select>
              <input
                aria-label={t("synthetic.colSelector")}
                value={row.selector}
                onChange={(e) => patch(i, { selector: e.target.value })}
                placeholder={stepNeedsSelector(row.kind) ? t("synthetic.selectorPlaceholder") : "—"}
                disabled={row.kind === "expectUrl" || row.kind === "expectStatus"}
                style={{ ...CONTROL, fontFamily: "var(--mono)" }}
              />
              <input
                aria-label={t("synthetic.colValue")}
                value={row.value}
                onChange={(e) => patch(i, { value: e.target.value })}
                placeholder={stepNeedsValue(row.kind) ? t("synthetic.valuePlaceholder") : "—"}
                disabled={row.kind === "click" || row.kind === "waitFor"}
                style={{ ...CONTROL, fontFamily: "var(--mono)" }}
              />
              <input
                aria-label={t("synthetic.colTimeout")}
                value={row.seconds}
                onChange={(e) => patch(i, { seconds: e.target.value.replace(/\D/g, "") })}
                placeholder="15"
                inputMode="numeric"
                style={{ ...CONTROL, fontFamily: "var(--mono)", textAlign: "center" }}
              />
              <span style={{ display: "flex", gap: 3 }}>
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  aria-label={t("synthetic.up")}
                  style={TINY}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => setRows((l) => l.filter((_, j) => j !== i))}
                  aria-label={t("synthetic.remove")}
                  style={TINY}
                >
                  ✕
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          data-testid="journey-add-step"
          disabled={rows.length >= SYNTHETIC_MAX_STEPS}
          onClick={() =>
            setRows((l) => [...l, { kind: "click", selector: "", value: "", seconds: "" }])
          }
          style={{
            height: 30,
            padding: "0 11px",
            border: "1px dashed var(--line)",
            borderRadius: 8,
            background: "none",
            color: "var(--ink-2)",
            fontSize: 12,
            fontWeight: 600,
            cursor: rows.length >= SYNTHETIC_MAX_STEPS ? "not-allowed" : "pointer",
          }}
        >
          + {t("synthetic.addStep")}
        </button>
        <span style={{ flex: 1 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{t("synthetic.budget")}</span>
          <select
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            style={{ ...CONTROL, width: 130 }}
          >
            {BUDGETS.map((s) => (
              <option key={s} value={s}>
                {t("synthetic.budgetSeconds", { count: s })}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

/**
 * The credentials a journey signs in with, as they are first written.
 *
 * The value leaves the browser once and comes back never: the field is a
 * password input, the server encrypts it, and every screen afterwards shows the
 * name alone.
 */
export function SecretsEditor({ fieldName = "secrets" }: { fieldName?: string }) {
  const t = useT();
  const [pairs, setPairs] = useState<{ name: string; value: string }[]>([]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input type="hidden" name={fieldName} value={JSON.stringify(pairs)} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={LABEL}>{t("synthetic.credentials")}</span>
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
          {t("synthetic.credentialsHint")}
        </span>
      </div>
      {pairs.map((pair, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: "160px minmax(0,1fr) 26px",
            gap: 6,
            alignItems: "center",
          }}
        >
          <input
            aria-label={t("synthetic.secretName")}
            value={pair.name}
            onChange={(e) =>
              setPairs((l) =>
                l.map((p, j) =>
                  i === j ? { ...p, name: e.target.value.replace(/[^A-Za-z0-9_]/g, "") } : p,
                ),
              )
            }
            placeholder="PASSWORD"
            style={{ ...CONTROL, fontFamily: "var(--mono)" }}
          />
          <input
            aria-label={t("synthetic.secretValue")}
            type="password"
            autoComplete="new-password"
            value={pair.value}
            onChange={(e) =>
              setPairs((l) => l.map((p, j) => (i === j ? { ...p, value: e.target.value } : p)))
            }
            style={CONTROL}
          />
          <button
            type="button"
            onClick={() => setPairs((l) => l.filter((_, j) => j !== i))}
            aria-label={t("synthetic.remove")}
            style={TINY}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setPairs((l) => [...l, { name: "", value: "" }])}
        style={{
          height: 30,
          padding: "0 11px",
          border: "1px dashed var(--line)",
          borderRadius: 8,
          background: "none",
          color: "var(--ink-2)",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          width: "fit-content",
        }}
      >
        + {t("synthetic.addSecret")}
      </button>
    </div>
  );
}
