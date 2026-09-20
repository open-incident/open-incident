"use client";

/**
 * "+ New SLO", as two expressions and a bar.
 *
 * The form asks for the ratio in words — "how many met the bar" over "how many
 * there were" — rather than for an SLI, because the arithmetic is the easy
 * part and naming the two counts is where people get it wrong. The examples
 * under each box are real expressions against the metrics this product stores.
 */

import { useState } from "react";
import { useT } from "@/i18n/client";
import { createSlo } from "./actions";

const CONTROL: React.CSSProperties = {
  height: 36,
  border: "1px solid var(--line)",
  borderRadius: 9,
  padding: "0 11px",
  fontSize: 13,
  outline: "none",
  background: "var(--panel)",
  width: "100%",
};

const LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};

const HINT: React.CSSProperties = { fontSize: 11, color: "var(--ink-3)", lineHeight: 1.45 };

export function NewSlo({
  services,
  initialOpen = false,
}: {
  services: string[];
  initialOpen?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(initialOpen);
  const [windowKind, setWindowKind] = useState<"rolling" | "calendar">("rolling");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="slo-new"
        className="oi-hover-brand-2"
        style={{
          height: 32,
          padding: "0 13px",
          borderRadius: 9,
          background: "var(--brand)",
          color: "var(--on-brand)",
          border: 0,
          display: "flex",
          alignItems: "center",
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {t("slo.new")}
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: "6vh",
            zIndex: 50,
          }}
        >
          <form
            action={createSlo}
            onClick={(e) => e.stopPropagation()}
            className="oi-rise-fast"
            data-testid="slo-form"
            style={{
              width: 680,
              maxWidth: "calc(100vw - 32px)",
              maxHeight: "88vh",
              background: "var(--panel)",
              borderRadius: "var(--radius-modal)",
              boxShadow: "var(--shadow-modal)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "16px 22px",
                borderBottom: "1px solid var(--line)",
                fontFamily: "var(--title)",
                fontSize: 17,
                fontWeight: 600,
                flex: "none",
              }}
            >
              {t("slo.new")}
            </div>

            <div
              style={{
                padding: "18px 22px",
                display: "flex",
                flexDirection: "column",
                gap: 14,
                overflowY: "auto",
                minHeight: 0,
              }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 180px", gap: 10 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style={LABEL}>{t("slo.fieldName")}</span>
                  <input name="name" required className="oi-field" style={CONTROL} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style={LABEL}>{t("slo.fieldService")}</span>
                  <input
                    name="service"
                    list="slo-services"
                    className="oi-field"
                    style={{ ...CONTROL, fontFamily: "var(--mono)" }}
                  />
                  <datalist id="slo-services">
                    {services.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </label>
              </div>

              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={LABEL}>{t("slo.fieldGood")}</span>
                <input
                  name="goodQuery"
                  required
                  data-testid="slo-good"
                  className="oi-field"
                  placeholder='sum(rate(http_requests_total{status!~"5.."}[5m]))'
                  style={{ ...CONTROL, fontFamily: "var(--mono)", fontSize: 12 }}
                />
                <span style={HINT}>{t("slo.fieldGoodHint")}</span>
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={LABEL}>{t("slo.fieldTotal")}</span>
                <input
                  name="totalQuery"
                  required
                  data-testid="slo-total"
                  className="oi-field"
                  placeholder="sum(rate(http_requests_total[5m]))"
                  style={{ ...CONTROL, fontFamily: "var(--mono)", fontSize: 12 }}
                />
                <span style={HINT}>{t("slo.fieldTotalHint")}</span>
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style={LABEL}>{t("slo.fieldObjective")}</span>
                  <input
                    name="objective"
                    type="number"
                    step="0.001"
                    min={50}
                    max={99.999}
                    defaultValue="99.9"
                    required
                    className="oi-field"
                    style={{ ...CONTROL, fontFamily: "var(--mono)" }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style={LABEL}>{t("slo.fieldWindow")}</span>
                  <select
                    name="windowKind"
                    value={windowKind}
                    onChange={(e) => setWindowKind(e.target.value as "rolling" | "calendar")}
                    style={CONTROL}
                  >
                    <option value="rolling">{t("slo.rolling")}</option>
                    <option value="calendar">{t("slo.calendar")}</option>
                  </select>
                </label>
                {/*
                  Only a rolling window has a length to choose. A calendar one
                  is the month, and offering a number of days beside it would
                  be a control that does nothing.
                */}
                {windowKind === "rolling" && (
                  <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <span style={LABEL}>{t("slo.fieldDays")}</span>
                    <select name="windowDays" defaultValue="28" style={CONTROL}>
                      <option value="7">{t("slo.nDays", { count: 7 })}</option>
                      <option value="28">{t("slo.nDays", { count: 28 })}</option>
                      <option value="90">{t("slo.nDays", { count: 90 })}</option>
                    </select>
                  </label>
                )}
              </div>
              <span style={HINT}>{t("slo.windowHint")}</span>

              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13 }}>
                <input type="checkbox" name="burnAlerts" defaultChecked style={{ marginTop: 3 }} />
                <span style={{ flex: 1, lineHeight: 1.5 }}>
                  {t("slo.burnAlerts")}
                  <span style={{ display: "block", ...HINT }}>{t("slo.burnAlertsHint")}</span>
                </span>
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 5, maxWidth: 240 }}>
                <span style={LABEL}>{t("slo.fieldPage")}</span>
                <select name="page" defaultValue="owner" style={CONTROL}>
                  <option value="owner">{t("monitors.pageOwner")}</option>
                  <option value="me">{t("monitors.pageMe")}</option>
                  <option value="nobody">{t("monitors.pageNobody")}</option>
                </select>
              </label>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "14px 22px",
                borderTop: "1px solid var(--line)",
                background: "var(--sunk)",
                flex: "none",
              }}
            >
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  height: 34,
                  padding: "0 13px",
                  border: "1px solid var(--line)",
                  borderRadius: 9,
                  background: "var(--panel)",
                  fontSize: 12.5,
                  cursor: "pointer",
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                data-testid="slo-create"
                className="oi-hover-brand-2"
                style={{
                  height: 34,
                  padding: "0 14px",
                  borderRadius: 9,
                  background: "var(--brand)",
                  color: "var(--on-brand)",
                  border: 0,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {t("slo.create")}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
