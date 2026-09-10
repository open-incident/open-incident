"use client";

import { useState, useTransition } from "react";
import { useT } from "@/i18n/client";
import {
  previewPayload,
  sendPayload,
  type SimulationView,
} from "@/app/app/settings/alert-sources/actions";

const btn: React.CSSProperties = {
  height: 30,
  padding: "0 12px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--panel)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  color: "inherit",
};
const chip = (bg: string, ink: string): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  padding: "1px 7px",
  borderRadius: 999,
  background: bg,
  color: ink,
  fontSize: 11,
  fontWeight: 600,
});

/**
 * A payload, and what the pipeline would do with it — attributes, priority,
 * the route that catches it, who it pages, the incident it opens — before it
 * is sent. Then send it: as a test (routed, nobody paged) or for real.
 */
export function PayloadTester({
  sourceId,
  initialText,
}: {
  sourceId: string;
  initialText: string;
}) {
  const t = useT();
  const [text, setText] = useState(initialText);
  const [plans, setPlans] = useState<SimulationView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      setError(null);
      setSent(null);
      const r = await previewPayload(sourceId, text);
      if ("error" in r) {
        setPlans(null);
        setError(t(`settings.sources.tester.${r.error}`));
      } else setPlans(r.plans);
    });
  const send = (test: boolean) =>
    start(async () => {
      if (!test && !window.confirm(t("settings.sources.tester.confirmReal"))) return;
      setError(null);
      const r = await sendPayload(sourceId, text, test);
      if ("error" in r)
        setError(t(`settings.sources.tester.${r.error as "invalid_json" | "not_found"}`));
      else
        setSent(
          r
            .map((o) => `${o.action}${o.incidentNumber ? ` · INC-${o.incidentNumber}` : ""}`)
            .join(", "),
        );
    });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="payload-tester">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(18, Math.max(6, text.split("\n").length + 1))}
        spellCheck={false}
        className="oi-field"
        style={{
          border: "1px solid var(--line)",
          borderRadius: 10,
          padding: "10px 12px",
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          lineHeight: 1.5,
          background: "var(--panel)",
          resize: "vertical",
          outline: "none",
        }}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          style={{ ...btn, background: "var(--brand)", borderColor: "var(--brand)", color: "#fff" }}
          data-testid="tester-preview"
        >
          {t("settings.sources.tester.preview")}
        </button>
        <button
          type="button"
          onClick={() => send(true)}
          disabled={pending}
          style={btn}
          data-testid="tester-send-test"
        >
          {t("settings.sources.tester.sendTest")}
        </button>
        <button
          type="button"
          onClick={() => send(false)}
          disabled={pending}
          style={{ ...btn, color: "var(--dang)" }}
        >
          {t("settings.sources.tester.sendReal")}
        </button>
        {error && (
          <span role="alert" style={{ fontSize: 12.5, color: "var(--dang)" }}>
            {error}
          </span>
        )}
        {sent && (
          <span role="status" style={{ fontSize: 12.5, color: "var(--ok)", fontWeight: 600 }}>
            {t("settings.sources.tester.sent", { result: sent })}
          </span>
        )}
      </div>
      {plans?.map((p, i) => (
        <div
          key={i}
          style={{
            border: "1px solid var(--line)",
            borderRadius: 12,
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            background: "var(--sunk)",
          }}
          data-testid="tester-plan"
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>{p.title}</span>
            <span
              style={chip(
                p.status === "firing" ? "var(--dang-t)" : "var(--ok-t)",
                p.status === "firing" ? "var(--dang)" : "var(--ok)",
              )}
            >
              {p.status}
            </span>
            {p.priority && (
              <span style={chip("var(--panel)", "var(--ink-2)")}>
                {p.priority} · {p.urgency}
              </span>
            )}
            {p.filtered && (
              <span style={chip("var(--wait-t)", "var(--wait)")}>
                {t("settings.sources.tester.filtered")}
              </span>
            )}
            <span style={{ flex: 1 }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)" }}>
              {p.dedupKey}
            </span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.entries(p.attributes)
              .filter(([k]) => !k.endsWith("_id"))
              .map(([k, v]) => (
                <span
                  key={k}
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    padding: "1px 7px",
                    borderRadius: 6,
                    background: "var(--panel)",
                    border: "1px solid var(--line)",
                    color: "var(--ink-2)",
                  }}
                >
                  {k}=<strong style={{ color: "var(--ink)" }}>{v}</strong>
                </span>
              ))}
            {p.missing.map((k) => (
              <span
                key={k}
                style={{ ...chip("var(--wait-t)", "var(--wait)"), fontFamily: "var(--font-mono)" }}
              >
                {t("settings.sources.tester.missing", { key: k })}
              </span>
            ))}
          </div>
          {!p.filtered && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 8,
                fontSize: 12.5,
              }}
            >
              <div>
                <div className="oi-eyebrow">{t("settings.sources.tester.route")}</div>
                <div style={{ marginTop: 3, fontWeight: 600 }}>
                  {p.route
                    ? `${p.route.name}${p.route.testMode ? ` · ${t("settings.routes.testMode")}` : ""}`
                    : t("settings.sources.tester.noRoute")}
                </div>
                {p.grouping?.enabled && (
                  <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                    {p.grouping.joins
                      ? t("settings.sources.tester.joins", { title: p.grouping.joins })
                      : t("settings.sources.tester.groupKey", { key: p.grouping.key ?? "*" })}
                  </div>
                )}
              </div>
              <div>
                <div className="oi-eyebrow">{t("settings.sources.tester.pages")}</div>
                {p.escalations.length === 0 && (
                  <div style={{ marginTop: 3, color: "var(--ink-3)" }}>
                    {t("routes.pageNobody")}
                  </div>
                )}
                {p.escalations.map((e, j) => (
                  <div
                    key={j}
                    style={{ marginTop: 3, color: e.skipped ? "var(--wait)" : "var(--ink)" }}
                  >
                    {e.path ?? "—"}
                    {e.via && e.via !== "fallback" ? (
                      <span style={{ color: "var(--ink-3)" }}> · {e.via}</span>
                    ) : null}
                    {e.skipped ? ` · ${t(`settings.sources.tester.skipped.${e.skipped}`)}` : ""}
                  </div>
                ))}
              </div>
              <div>
                <div className="oi-eyebrow">{t("settings.sources.tester.incident")}</div>
                <div style={{ marginTop: 3 }}>
                  {p.incident?.wants
                    ? t("settings.sources.tester.incidentYes", {
                        type: p.incident.type ?? "—",
                        phase: p.incident.phase,
                        severity: p.incident.severity ?? "—",
                      })
                    : p.route?.testMode
                      ? t("settings.sources.tester.incidentTest")
                      : t("settings.sources.tester.incidentNo")}
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
