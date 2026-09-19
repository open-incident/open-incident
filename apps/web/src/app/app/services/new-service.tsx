"use client";

/**
 * "+ Declare a service" — the exception to the rule this screen is built on.
 *
 * Services arrive on their own, from the signals that name them, and the list
 * says so. This dialog exists for the one case discovery cannot serve: a
 * service whose first alert has not happened yet and must page somebody when
 * it does. It asks for the key an alert will carry, because that is the only
 * field that has to be right — everything else can be filled in later, from
 * the service's own page.
 */

import { useState } from "react";
import { useT } from "@/i18n/client";
import { declareService } from "./actions";

const CONTROL: React.CSSProperties = {
  height: 38,
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "0 12px",
  fontSize: 13.5,
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

const FIELD: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 5 };

export function NewService({ teams }: { teams: Array<{ id: string; name: string }> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");

  // What the action will store, shown as it is typed: the key is normalised on
  // the way in, and a reader should not discover that after the fact.
  const normalised = key.trim().toLowerCase();

  return (
    <>
      <button
        type="button"
        data-testid="service-new"
        onClick={() => setOpen(true)}
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
        {t("services.new")}
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
            paddingTop: "10vh",
            zIndex: 50,
          }}
        >
          <form
            action={declareService}
            onClick={(e) => e.stopPropagation()}
            className="oi-rise-fast"
            role="dialog"
            aria-modal="true"
            data-testid="service-form"
            style={{
              width: 520,
              maxWidth: "calc(100vw - 32px)",
              background: "var(--panel)",
              borderRadius: "var(--radius-modal)",
              boxShadow: "var(--shadow-modal)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "16px 22px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span style={{ fontFamily: "var(--title)", fontSize: 17, fontWeight: 600 }}>
                {t("services.newTitle")}
              </span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("common.close")}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  display: "grid",
                  placeItems: "center",
                  color: "var(--ink-3)",
                  cursor: "pointer",
                  border: 0,
                  background: "none",
                }}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                padding: "18px 22px",
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <label style={FIELD}>
                <span style={LABEL}>{t("services.newKey")}</span>
                <input
                  name="key"
                  required
                  autoFocus
                  maxLength={120}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="checkout-api"
                  style={{ ...CONTROL, fontFamily: "var(--mono)" }}
                />
                <span style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
                  {normalised && normalised !== key.trim() ? (
                    <>
                      {t("services.newKeyNormalised")}{" "}
                      <span style={{ fontFamily: "var(--mono)", color: "var(--ink-2)" }}>
                        service:{normalised}
                      </span>
                    </>
                  ) : (
                    t("services.newKeyHint")
                  )}
                </span>
              </label>

              <label style={FIELD}>
                <span style={LABEL}>
                  {t("services.newName")} · {t("common.optional")}
                </span>
                <input name="name" maxLength={120} placeholder="Checkout" style={CONTROL} />
              </label>

              {teams.length > 0 ? (
                <label style={FIELD}>
                  <span style={LABEL}>
                    {t("services.newOwner")} · {t("common.optional")}
                  </span>
                  <select
                    name="teamId"
                    defaultValue=""
                    style={{ ...CONTROL, padding: "0 9px", fontSize: 13 }}
                  >
                    <option value="">{t("services.newNoOwner")}</option>
                    {teams.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div
                  style={{
                    background: "var(--sunk)",
                    borderRadius: 11,
                    padding: "11px 13px",
                    fontSize: 12,
                    color: "var(--ink-2)",
                    lineHeight: 1.5,
                  }}
                >
                  {t("services.noTeams")}
                </div>
              )}

              <div
                style={{
                  background: "var(--sunk)",
                  borderRadius: 11,
                  padding: "11px 13px",
                  fontSize: 12,
                  color: "var(--ink-2)",
                  lineHeight: 1.5,
                }}
              >
                {t("services.newNote")}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                padding: "13px 22px",
                background: "var(--sunk)",
                borderTop: "1px solid var(--line)",
              }}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="oi-hover"
                style={{
                  height: 34,
                  padding: "0 14px",
                  border: "1px solid var(--line)",
                  borderRadius: 9,
                  background: "var(--panel)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  color: "inherit",
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                className="oi-hover-brand-2"
                style={{
                  height: 34,
                  padding: "0 16px",
                  border: 0,
                  borderRadius: 9,
                  background: "var(--brand)",
                  color: "var(--on-brand)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {t("services.newSubmit")}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
