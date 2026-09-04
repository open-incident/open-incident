"use client";

import { useActionState, useState } from "react";
import { useT } from "@/i18n/client";
import { createApiKey, createWebhook } from "./actions";

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

function Frame({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const t = useT();
  return (
    <div
      onClick={onClose}
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
          width: 540,
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
            {title}
          </div>
          <button
            type="button"
            onClick={onClose}
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
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 13 }}>
          {children}
        </div>
        {footer && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "14px 20px",
              borderTop: "1px solid var(--line)",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** A secret shown once — the brand-tinted banner of the design, with copy. */
function SecretOnce({
  value,
  title,
  hint,
  onDone,
}: {
  value: string;
  title: string;
  hint: string;
  onDone: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div
      data-testid="secret-once"
      style={{
        padding: "12px 14px",
        background: "var(--brand-t)",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--brand)" }}>{title}</span>
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{hint}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <code
          data-testid="secret-value"
          style={{
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
          }}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(value).catch(() => {});
            setCopied(true);
          }}
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
            flex: "none",
          }}
        >
          {copied ? t("common.copied") : t("common.copy")}
        </button>
        <button
          type="button"
          onClick={onDone}
          aria-label={t("common.close")}
          style={{
            height: 30,
            width: 30,
            border: "1px solid var(--brand-b)",
            borderRadius: 8,
            background: "transparent",
            display: "grid",
            placeItems: "center",
            fontSize: 12,
            color: "var(--ink-3)",
            cursor: "pointer",
            flex: "none",
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export function NewKeyDialog() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createApiKey, {});
  const close = () => setOpen(false);
  return (
    <>
      <button
        type="button"
        data-testid="key-open"
        onClick={() => setOpen(true)}
        style={{
          height: 30,
          padding: "0 12px",
          borderRadius: 8,
          background: "var(--brand)",
          color: "#fff",
          border: 0,
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {t("settings.api.newKey")}
      </button>
      {open && (
        <Frame title={t("settings.api.newKeyTitle")} onClose={close}>
          {state.key ? (
            <SecretOnce
              value={state.key}
              title={t("settings.api.keyCreated")}
              hint={t("settings.api.keyCreatedHint")}
              onDone={close}
            />
          ) : (
            <form
              action={action}
              data-testid="key-form"
              style={{ display: "flex", flexDirection: "column", gap: 13 }}
            >
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("settings.api.keyName")}</span>
                <input
                  name="name"
                  required
                  autoFocus
                  placeholder="Terraform CI"
                  className="oi-field"
                  style={control}
                />
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("settings.api.scopes")}</span>
                {(["read", "write", "incident:create"] as const).map((s) => (
                  <label
                    key={s}
                    style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13 }}
                  >
                    <input type="checkbox" name="scopes" value={s} defaultChecked={s === "read"} />
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{s}</span>
                    <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                      {t(`settings.api.scope.${s === "incident:create" ? "incidentCreate" : s}`)}
                    </span>
                  </label>
                ))}
              </div>
              {state.error && (
                <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--dang)" }}>
                  {state.error === "scopes"
                    ? t("settings.api.errorScopes")
                    : t("settings.api.errorName")}
                </p>
              )}
              <div
                className="oi-note"
                style={{ borderRadius: 11, padding: "11px 13px", fontSize: 12 }}
              >
                {t("settings.api.keyNote")}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  type="button"
                  onClick={close}
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
                    whiteSpace: "nowrap",
                  }}
                >
                  {t("settings.api.createKey")}
                </button>
              </div>
            </form>
          )}
        </Frame>
      )}
    </>
  );
}

export function NewWebhookDialog({
  events,
  future,
}: {
  events: string[];
  future: Array<{ event: string; label: string }>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(events.slice(0, 3));
  const [state, action, pending] = useActionState(createWebhook, {});
  const close = () => setOpen(false);
  return (
    <>
      <button
        type="button"
        data-testid="webhook-open"
        onClick={() => setOpen(true)}
        className="oi-hover-edge-fill"
        style={{
          height: 30,
          padding: "0 12px",
          border: "1px solid var(--line)",
          borderRadius: 8,
          background: "var(--panel)",
          fontSize: 12.5,
          fontWeight: 600,
          color: "var(--brand)",
          cursor: "pointer",
        }}
      >
        {t("settings.api.newEndpoint")}
      </button>
      {open && (
        <Frame title={t("settings.api.newEndpointTitle")} onClose={close}>
          {state.secret ? (
            <SecretOnce
              value={state.secret}
              title={t("settings.api.secretCreated")}
              hint={t("settings.api.secretCreatedHint")}
              onDone={close}
            />
          ) : (
            <form
              action={action}
              data-testid="webhook-form"
              style={{ display: "flex", flexDirection: "column", gap: 13 }}
            >
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("settings.api.endpointUrl")}</span>
                <input
                  name="url"
                  type="url"
                  required
                  autoFocus
                  placeholder="https://hooks.example.dev/oi"
                  className="oi-field"
                  style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12 }}
                />
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("settings.api.events")}</span>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {events.map((e) => {
                    const on = selected.includes(e);
                    return (
                      <button
                        key={e}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() =>
                          setSelected((s) => (on ? s.filter((x) => x !== e) : [...s, e]))
                        }
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 11,
                          background: on ? "var(--brand-t)" : "var(--sunk)",
                          color: on ? "var(--brand)" : "var(--ink-2)",
                          border: `1px solid ${on ? "var(--brand-b)" : "var(--line)"}`,
                          borderRadius: 999,
                          padding: "3px 10px",
                          cursor: "pointer",
                        }}
                      >
                        {e}
                      </button>
                    );
                  })}
                  {future.map((f) => (
                    <span
                      key={f.event}
                      title={f.label}
                      aria-disabled
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        background: "transparent",
                        color: "var(--ink-3)",
                        border: "1px dashed var(--line)",
                        borderRadius: 999,
                        padding: "3px 10px",
                      }}
                    >
                      {f.event} · <span style={{ fontFamily: "var(--font-ui)" }}>{f.label}</span>
                    </span>
                  ))}
                </div>
                {selected.map((e) => (
                  <input key={e} type="hidden" name="events" value={e} />
                ))}
              </div>
              {state.error && (
                <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--dang)" }}>
                  {state.error === "events"
                    ? t("settings.api.errorEvents")
                    : t("settings.api.errorUrl")}
                </p>
              )}
              <div
                className="oi-note"
                style={{ borderRadius: 11, padding: "11px 13px", fontSize: 12 }}
              >
                {t("settings.api.endpointNote")}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  type="button"
                  onClick={close}
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
                    whiteSpace: "nowrap",
                  }}
                >
                  {t("common.create")}
                </button>
              </div>
            </form>
          )}
        </Frame>
      )}
    </>
  );
}
