/**
 * A synthetic monitor's journey, and what the last run did with it.
 *
 * The steps are always shown — that is the monitor's definition. The timings
 * are shown beside the step they belong to, and only where there are any: a
 * step the run never reached carries "not run", not a zero. The step that broke
 * is named with its error, and the screenshot is linked only when one was
 * actually stored.
 */

import Link from "next/link";
import { isSyntheticResult, type SyntheticConfig } from "@openincident/oncall/synthetic-steps";
import { getT } from "@/i18n/server";
import type { MessageKey } from "@/i18n/dictionaries/en";

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
  padding: "14px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const EYEBROW: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".08em",
  color: "var(--ink-3)",
};

const OUTCOME_TONE: Record<string, string> = {
  passed: "var(--ok)",
  failed: "var(--dang)",
  skipped: "var(--ink-3)",
};

export async function JourneyCard({
  monitorId,
  journey,
  lastCheck,
}: {
  monitorId: string;
  journey: SyntheticConfig;
  /** The most recent check, whatever it did — or nothing, if none ran yet. */
  lastCheck: { id: string; result: Record<string, unknown> | null } | null;
}) {
  const t = await getT();
  const run = isSyntheticResult(lastCheck?.result) ? lastCheck.result : null;
  const byIndex = new Map((run?.steps ?? []).map((s) => [s.index, s]));
  const slowest = Math.max(1, ...(run?.steps ?? []).map((s) => s.durationMs ?? 0));

  return (
    <div style={CARD}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={EYEBROW}>{t("synthetic.journey")}</span>
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
          {t("synthetic.steps", { count: journey.steps.length })} ·{" "}
          {t("synthetic.budgetSeconds", { count: Math.round(journey.budgetMs / 1000) })}
        </span>
        <span style={{ flex: 1 }} />
        {run && (
          <span style={{ fontSize: 11.5, color: "var(--ink-3)", fontFamily: "var(--mono)" }}>
            {run.totalMs} ms
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {journey.steps.map((step, i) => {
          const outcome = byIndex.get(i);
          const tone = OUTCOME_TONE[outcome?.outcome ?? "skipped"]!;
          return (
            <div
              key={i}
              data-testid={`journey-row-${i}`}
              style={{
                display: "grid",
                gridTemplateColumns: "20px 104px minmax(0,1fr) 120px 72px",
                gap: 10,
                alignItems: "center",
                padding: "7px 0",
                borderTop: i === 0 ? "none" : "1px solid var(--line-2)",
                fontSize: 12.5,
              }}
            >
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
                {i + 1}
              </span>
              <span style={{ fontWeight: 600, color: outcome ? tone : "var(--ink-2)" }}>
                {t(`synthetic.kind.${step.kind}` as MessageKey)}
              </span>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11.5,
                  color: "var(--ink-2)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={`${step.selector ?? ""} ${step.value ?? ""}`.trim()}
              >
                {step.selector ?? ""} {step.value ?? ""}
              </span>
              {/* The bar is relative to the slowest step of this run: it is the
                  shape of the journey, not a budget gauge. */}
              <span
                style={{
                  height: 6,
                  borderRadius: 3,
                  background: "var(--line)",
                  overflow: "hidden",
                  display: outcome?.durationMs === undefined ? "none" : "block",
                }}
              >
                <span
                  style={{
                    display: "block",
                    height: "100%",
                    width: `${Math.max(3, ((outcome?.durationMs ?? 0) / slowest) * 100)}%`,
                    background: tone,
                  }}
                />
              </span>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11.5,
                  textAlign: "right",
                  gridColumn: outcome?.durationMs === undefined ? "4 / span 2" : "auto",
                  color: outcome?.durationMs === undefined ? "var(--ink-3)" : "var(--ink)",
                }}
              >
                {outcome?.durationMs === undefined
                  ? run
                    ? t("synthetic.notRun")
                    : ""
                  : `${outcome.durationMs} ms`}
              </span>
            </div>
          );
        })}
      </div>

      {!run && <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("synthetic.noRun")}</div>}

      {run?.failedStep && (
        <div
          style={{
            border: "1px solid var(--dang)",
            background: "var(--dang-t)",
            borderRadius: 10,
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 5,
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--dang)" }}>
            {t("synthetic.failedAt", { step: run.failedStep.index + 1 })} ·{" "}
            <span style={{ fontFamily: "var(--mono)", fontWeight: 400 }}>
              {run.failedStep.label}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
            {run.failedStep.error}
          </div>
        </div>
      )}

      {/* Linked only when the runner really stored one. */}
      {run?.screenshotKey && lastCheck && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={EYEBROW}>{t("synthetic.screenshot")}</div>
          <Link
            href={`/app/monitors/${monitorId}/shot/${lastCheck.id}`}
            target="_blank"
            data-testid="journey-screenshot"
            style={{ display: "block", lineHeight: 0 }}
          >
            {/* A plain <img>: the route streams bytes out of a private bucket,
                and Next's optimiser would need a public URL it does not have. */}
            <img
              src={`/app/monitors/${monitorId}/shot/${lastCheck.id}`}
              alt={t("synthetic.screenshot")}
              style={{
                width: "100%",
                border: "1px solid var(--line)",
                borderRadius: 10,
                display: "block",
              }}
            />
          </Link>
          <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
            {t("synthetic.screenshotMasked")} · {t("synthetic.screenshotOpen")}
          </div>
        </div>
      )}
    </div>
  );
}
