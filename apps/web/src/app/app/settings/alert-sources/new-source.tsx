"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useT } from "@/i18n/client";
import { IntegrationIcon } from "../integrations/icons";
import { createSource } from "./actions";

export type KindOption = { kind: string; label: string; icon: string };

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
const btn: React.CSSProperties = {
  height: 34,
  padding: "0 13px",
  border: "1px solid var(--line)",
  borderRadius: 9,
  background: "var(--panel)",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  color: "inherit",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};

/**
 * "+ New source", in three steps: the tool (a grid of the ones the product
 * parses, HTTP for everything else), a name, then the endpoint and the secret
 * shown once — and the way to the source's page to map its attributes.
 */
export function NewSourceDialog({
  kinds,
  initialOpen = false,
}: {
  kinds: KindOption[];
  initialOpen?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(initialOpen);
  const [kind, setKind] = useState<string | null>(null);
  const [state, action, pending] = useActionState(createSource, {});
  const [copied, setCopied] = useState<"secret" | "endpoint" | null>(null);
  const copy = (what: "secret" | "endpoint", value: string) => {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopied(what);
  };
  const chosen = kinds.find((k) => k.kind === kind) ?? null;
  return (
    <>
      <button
        type="button"
        data-testid="source-open"
        onClick={() => setOpen(true)}
        className="oi-hover-edge-fill"
        style={{ ...btn, height: 32, color: "var(--brand)" }}
      >
        {t("settings.sources.new")}
      </button>
      {open && (
        <div
          onClick={() => !state.secret && setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(10,16,24,.35)",
            display: "grid",
            placeItems: "center",
            zIndex: 40,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="oi-rise-modal"
            style={{
              width: 620,
              maxWidth: "100%",
              background: "var(--panel)",
              borderRadius: 16,
              boxShadow: "var(--shadow-modal, 0 20px 60px rgba(0,0,0,.25))",
              padding: 22,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
            data-testid="source-form"
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: "var(--font-title)", fontSize: 17, fontWeight: 600 }}>
                {t("settings.sources.newTitle")}
              </span>
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {state.secret
                  ? t("settings.sources.step3")
                  : chosen
                    ? t("settings.sources.step2")
                    : t("settings.sources.step1")}
              </span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("common.close")}
                style={{
                  border: 0,
                  background: "none",
                  fontSize: 16,
                  cursor: "pointer",
                  color: "var(--ink-3)",
                }}
              >
                ✕
              </button>
            </div>

            {state.secret && state.endpoint ? (
              <div
                data-testid="source-created"
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
                  {t("settings.sources.createdText")}
                </p>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ ...label, width: 70 }}>{t("settings.sources.endpoint")}</span>
                  <code style={mono} data-testid="source-endpoint">
                    {state.endpoint}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy("endpoint", state.endpoint!)}
                    style={{ ...btn, height: 30 }}
                  >
                    {copied === "endpoint" ? t("common.copied") : t("common.copy")}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ ...label, width: 70 }}>{t("settings.sources.secret")}</span>
                  <code style={mono} data-testid="source-secret">
                    {state.secret}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy("secret", state.secret!)}
                    style={{ ...btn, height: 30 }}
                  >
                    {copied === "secret" ? t("common.copied") : t("common.copy")}
                  </button>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: "var(--wait)", fontWeight: 600 }}>
                  {t("settings.sources.secretNote")}
                </p>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => setOpen(false)} style={btn}>
                    {t("common.close")}
                  </button>
                  {state.id && (
                    <Link
                      href={`/app/settings/alert-sources/${state.id}`}
                      style={{
                        ...btn,
                        background: "var(--brand)",
                        borderColor: "var(--brand)",
                        color: "#fff",
                      }}
                      data-testid="source-configure"
                    >
                      {t("settings.sources.configure")} →
                    </Link>
                  )}
                </div>
              </div>
            ) : !chosen ? (
              <div
                style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}
                data-testid="source-kinds"
              >
                {kinds.map((k) => (
                  <button
                    key={k.kind}
                    type="button"
                    onClick={() => setKind(k.kind)}
                    className="oi-hover-edge"
                    data-testid={`source-kind-${k.kind}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "12px 12px",
                      border: "1px solid var(--line)",
                      borderRadius: 11,
                      background: "var(--panel)",
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "inherit",
                    }}
                  >
                    <IntegrationIcon id={k.icon} />
                    <span style={{ minWidth: 0 }}>
                      {k.label}
                      <span
                        style={{
                          display: "block",
                          fontSize: 11,
                          fontWeight: 500,
                          color: "var(--ink-3)",
                        }}
                      >
                        {k.kind === "http"
                          ? t("settings.sources.kindHttpNote")
                          : t("settings.sources.kindParsedNote")}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <form action={action} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <input type="hidden" name="kind" value={chosen.kind} />
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    background: "var(--sunk)",
                    borderRadius: 10,
                  }}
                >
                  <IntegrationIcon id={chosen.icon} />
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{chosen.label}</span>
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    onClick={() => setKind(null)}
                    className="oi-link"
                    style={{
                      background: "none",
                      border: 0,
                      fontSize: 12,
                      cursor: "pointer",
                      color: "var(--brand)",
                    }}
                  >
                    {t("settings.sources.changeKind")}
                  </button>
                </div>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("settings.sources.name")}</span>
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={80}
                    autoFocus
                    defaultValue={`${chosen.label}`}
                    className="oi-field"
                    style={control}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("settings.sources.description")}</span>
                  <input
                    name="description"
                    maxLength={300}
                    placeholder={t("settings.sources.descriptionPlaceholder")}
                    className="oi-field"
                    style={control}
                  />
                </label>
                <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
                  {t("settings.sources.newNote")}
                </p>
                {state.error && (
                  <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--dang)" }}>
                    {state.error === "duplicate"
                      ? t("settings.sources.errorDuplicate")
                      : t("settings.fields.errorInvalid")}
                  </p>
                )}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => setOpen(false)} style={btn}>
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={pending}
                    style={{
                      ...btn,
                      background: "var(--brand)",
                      borderColor: "var(--brand)",
                      color: "#fff",
                    }}
                    data-testid="source-create"
                  >
                    {t("settings.sources.create")}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
