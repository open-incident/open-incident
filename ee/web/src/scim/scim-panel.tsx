"use client";

import { useState, useTransition } from "react";

type State = {
  enabled: boolean;
  tokenHint: string;
  lastSeen: string | null;
  defaultRole: string;
  sendInvites: boolean;
  provisionedCount: number;
};

type Labels = Record<
  | "baseUrl"
  | "baseUrlHint"
  | "notEnabled"
  | "enable"
  | "rotate"
  | "disable"
  | "reenable"
  | "enabled"
  | "disabled"
  | "token"
  | "tokenOnce"
  | "tokenHint"
  | "lastSeen"
  | "neverSeen"
  | "provisioned"
  | "options"
  | "defaultRole"
  | "sendInvites"
  | "save"
  | "mapping"
  | "error",
  string
>;

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 14,
  padding: "14px 16px",
  boxShadow: "var(--shadow-card)",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
const mono: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  wordBreak: "break-all",
};
const button = (tone: "primary" | "plain" | "danger"): React.CSSProperties => ({
  height: 32,
  padding: "0 13px",
  borderRadius: 9,
  border: tone === "primary" ? 0 : `1px solid ${tone === "danger" ? "var(--dang)" : "var(--line)"}`,
  background: tone === "primary" ? "var(--brand)" : "var(--panel)",
  color: tone === "primary" ? "#fff" : tone === "danger" ? "var(--dang)" : "var(--ink)",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
});

/** The token is shown once, right after it is issued; afterwards only its last characters. */
export function ScimPanel({
  baseUrl,
  state,
  actions,
  labels: l,
}: {
  baseUrl: string;
  state: State | null;
  actions: {
    issue: (formData: FormData) => Promise<{ token: string } | { error: string }>;
    toggle: (formData: FormData) => Promise<void>;
    saveOptions: (formData: FormData) => Promise<void>;
  };
  labels: Labels;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const issue = () => {
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("defaultRole", state?.defaultRole ?? "responder");
      fd.set("sendInvites", state?.sendInvites === false ? "" : "on");
      const res = await actions.issue(fd);
      if ("token" in res) setToken(res.token);
      else setError(res.error);
    });
  };
  return (
    <>
      <div style={card}>
        <div className="oi-eyebrow">{l.baseUrl}</div>
        <code data-testid="scim-base-url" style={mono}>
          {baseUrl}
        </code>
        <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>{l.baseUrlHint}</div>
        <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>{l.mapping}</div>
      </div>

      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span
            data-testid="scim-state"
            style={{
              padding: "2px 9px",
              borderRadius: 999,
              background: state?.enabled ? "var(--ok-t)" : "var(--sunk)",
              color: state?.enabled ? "var(--ok)" : "var(--ink-2)",
              fontSize: 11.5,
              fontWeight: 700,
            }}
          >
            {!state ? l.notEnabled : state.enabled ? l.enabled : l.disabled}
          </span>
          {state && (
            <>
              <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                {l.tokenHint} <code style={mono}>{state.tokenHint}</code>
              </span>
              <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                {state.lastSeen ? `${l.lastSeen} ${state.lastSeen}` : l.neverSeen}
              </span>
              <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{l.provisioned}</span>
            </>
          )}
          <span style={{ flex: 1 }} />
          <button
            type="button"
            data-testid="scim-issue"
            onClick={issue}
            disabled={pending}
            style={button("primary")}
          >
            {state ? l.rotate : l.enable}
          </button>
          {state && (
            <form action={actions.toggle}>
              <input type="hidden" name="enabled" value={state.enabled ? "" : "on"} />
              <button
                type="submit"
                data-testid="scim-toggle"
                style={button(state.enabled ? "danger" : "plain")}
              >
                {state.enabled ? l.disable : l.reenable}
              </button>
            </form>
          )}
        </div>
        {token && (
          <div
            role="status"
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              background: "var(--brand-t)",
              border: "1px solid var(--brand-b)",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--brand)" }}>{l.token}</span>
            <code data-testid="scim-token" style={{ ...mono, fontSize: 13 }}>
              {token}
            </code>
            <span style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{l.tokenOnce}</span>
          </div>
        )}
        {error && (
          <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--dang)" }}>
            {l.error}
          </p>
        )}
      </div>

      {state && (
        <form action={actions.saveOptions} data-testid="scim-options-form" style={card}>
          <div className="oi-eyebrow">{l.options}</div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
            <span style={{ width: 200, color: "var(--ink-2)" }}>{l.defaultRole}</span>
            <select
              name="defaultRole"
              defaultValue={state.defaultRole}
              className="oi-field"
              style={{
                height: 32,
                padding: "0 10px",
                border: "1px solid var(--line)",
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              <option value="admin">admin</option>
              <option value="responder">responder</option>
              <option value="viewer">viewer</option>
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" name="sendInvites" defaultChecked={state.sendInvites} />{" "}
            {l.sendInvites}
          </label>
          <div>
            <button type="submit" style={button("plain")}>
              {l.save}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
