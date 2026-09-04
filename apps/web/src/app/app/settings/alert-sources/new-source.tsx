"use client";

import { useActionState, useState } from "react";
import { useT } from "@/i18n/client";
import { createSource } from "./actions";

const KINDS = [
  ["datadog", "Datadog"],
  ["prometheus", "Prometheus / Alertmanager"],
  ["grafana", "Grafana"],
  ["sentry", "Sentry"],
  ["cloudwatch", "Amazon CloudWatch"],
  ["uptime_kuma", "Uptime Kuma"],
  ["http", "HTTP"],
] as const;
const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};
const control: React.CSSProperties = {
  height: 38,
  padding: "0 12px",
  border: "1px solid var(--line)",
  borderRadius: 10,
  outline: "none",
  fontSize: 13,
  background: "var(--panel)",
  width: "100%",
};

/** "+ New source": kind and name; then the endpoint and the secret, shown once. */
export function NewSourceDialog({ initialKind }: { initialKind?: string }) {
  const t = useT();
  const [open, setOpen] = useState(Boolean(initialKind));
  const [state, action, pending] = useActionState(createSource, {});
  const [copied, setCopied] = useState<"secret" | "endpoint" | null>(null);
  const copy = (what: "secret" | "endpoint", value: string) => {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopied(what);
  };
  const mono: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    fontFamily: "var(--font-mono)",
    fontSize: 11.5,
    background: "var(--panel)",
    border: "1px solid var(--brand-b)",
    borderRadius: 8,
    padding: "7px 10px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  return (
    <>
      <button
        type="button"
        data-testid="source-open"
        onClick={() => setOpen(true)}
        className="oi-hover-edge-fill"
        style={{
          height: 32,
          padding: "0 13px",
          border: "1px solid var(--line)",
          borderRadius: 9,
          background: "var(--panel)",
          fontSize: 12.5,
          fontWeight: 600,
          color: "var(--brand)",
          cursor: "pointer",
        }}
      >
        {t("settings.sources.new")}
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim-dialog)",
            display: "grid",
            placeItems: "center",
            padding: 24,
            zIndex: 60,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            className="oi-rise"
            style={{
              width: 560,
              maxWidth: "100%",
              background: "var(--panel)",
              borderRadius: 18,
              boxShadow: "var(--shadow-modal)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 20px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <div style={{ fontFamily: "var(--font-title)", fontSize: 16.5, fontWeight: 600 }}>
                {t("settings.sources.newTitle")}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("common.close")}
                className="oi-hover"
                style={{
                  marginLeft: "auto",
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  border: 0,
                  background: "transparent",
                  color: "var(--ink-3)",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                ✕
              </button>
            </div>
            <div
              style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 13 }}
            >
              {state.secret ? (
                <div
                  data-testid="source-created"
                  style={{ display: "flex", flexDirection: "column", gap: 10 }}
                >
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
                    {t("settings.sources.createdText")}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={label}>{t("settings.sources.endpoint")}</span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <code data-testid="source-endpoint" style={mono}>
                        {state.endpoint}
                      </code>
                      <button
                        type="button"
                        onClick={() => copy("endpoint", state.endpoint!)}
                        style={{
                          height: 30,
                          padding: "0 12px",
                          borderRadius: 8,
                          background: "var(--brand)",
                          color: "#fff",
                          border: 0,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {copied === "endpoint" ? t("common.copied") : t("common.copy")}
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={label}>{t("settings.sources.secret")}</span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <code data-testid="source-secret" style={mono}>
                        {state.secret}
                      </code>
                      <button
                        type="button"
                        onClick={() => copy("secret", state.secret!)}
                        style={{
                          height: 30,
                          padding: "0 12px",
                          borderRadius: 8,
                          background: "var(--brand)",
                          color: "#fff",
                          border: 0,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {copied === "secret" ? t("common.copied") : t("common.copy")}
                      </button>
                    </div>
                  </div>
                  <div
                    className="oi-note"
                    style={{ borderRadius: 11, padding: "11px 13px", fontSize: 12 }}
                  >
                    {t("settings.sources.secretNote")}
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      style={{
                        height: 34,
                        padding: "0 16px",
                        borderRadius: 9,
                        background: "var(--brand)",
                        color: "#fff",
                        border: 0,
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {t("common.close")}
                    </button>
                  </div>
                </div>
              ) : (
                <form
                  action={action}
                  data-testid="source-form"
                  style={{ display: "flex", flexDirection: "column", gap: 13 }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={label}>{t("settings.sources.kind")}</span>
                      <select
                        name="kind"
                        defaultValue={KINDS.some(([k]) => k === initialKind) ? initialKind : "http"}
                        className="oi-field"
                        style={control}
                      >
                        {KINDS.map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={label}>{t("settings.sources.name")}</span>
                      <input
                        name="name"
                        required
                        autoFocus
                        minLength={2}
                        maxLength={80}
                        placeholder="Datadog — production"
                        className="oi-field"
                        style={control}
                      />
                    </label>
                  </div>
                  {state.error && (
                    <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--dang)" }}>
                      {state.error === "duplicate"
                        ? t("settings.sources.errorDuplicate")
                        : t("settings.fields.errorInvalid")}
                    </p>
                  )}
                  <div
                    className="oi-note"
                    style={{ borderRadius: 11, padding: "11px 13px", fontSize: 12 }}
                  >
                    {t("settings.sources.newNote")}
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="oi-hover"
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
                      disabled={pending}
                      style={{
                        height: 34,
                        padding: "0 16px",
                        borderRadius: 9,
                        background: "var(--brand)",
                        color: "#fff",
                        border: 0,
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {t("common.create")}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
