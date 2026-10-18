"use client";

import { useState, useTransition } from "react";
import { useT } from "@/i18n/client";
import {
  DialogField,
  DialogReadOnly,
  DialogSegmented,
  SettingsDialog,
  dialogInputStyle,
  dialogSelectStyle,
} from "@/components/settings/dialog";
import { flash } from "@/components/settings/controls";
import { pageActionStyle, type ChipSpec } from "@/components/settings/template";
import {
  createApiKey,
  createWebhook,
  deleteWebhook,
  resendWebhookFailures,
  revokeApiKey,
  sendWebhookTest,
  toggleWebhook,
  type RowResult,
} from "./actions";
import { ClickRow } from "./click-row";
import { PlainDialog, smallButton } from "./plain-dialog";

/** Runs a row's server action, then says what happened in the toast. */
export function useRowAction(): [
  boolean,
  (run: () => Promise<RowResult>, after?: () => void) => void,
] {
  const t = useT();
  const [pending, start] = useTransition();
  return [
    pending,
    (run, after) =>
      start(async () => {
        try {
          const r = await run();
          flash(r.message);
          if (r.ok) after?.();
        } catch {
          flash(t("settingsV2.error.generic"));
        }
      }),
  ];
}

/* ---------- New API key ---------- */

export function NewKeyDialog() {
  const t = useT();
  return (
    <SettingsDialog
      testId="key-dialog"
      title={t("settingsV2.api.keyTitle")}
      primary={t("settingsV2.api.keyCreate")}
      action={createApiKey}
      trigger={(open) => (
        <button
          type="button"
          data-testid="key-open"
          onClick={open}
          className="oi-hover-brand-2"
          style={pageActionStyle(true)}
        >
          {t("settingsV2.api.newKey")}
        </button>
      )}
    >
      <DialogField label={t("settingsV2.api.keyName")} help={t("settingsV2.api.keyNameHelp")}>
        <input
          name="name"
          required
          maxLength={80}
          autoFocus
          placeholder="terraform-ci"
          className="oi-field"
          style={dialogInputStyle(true)}
        />
      </DialogField>
      <DialogSegmented
        label={t("settingsV2.api.access")}
        name="access"
        defaultValue="read"
        options={[
          { value: "read", label: t("settingsV2.api.accessRead") },
          { value: "write", label: t("settingsV2.api.accessWrite") },
        ]}
      />
      <DialogField label={t("settingsV2.api.scope")}>
        <select
          name="scope"
          defaultValue="incidents"
          className="oi-field"
          style={dialogSelectStyle}
        >
          <option value="incidents">{t("settingsV2.api.scopeIncidents")}</option>
          <option value="incidents,monitors">{t("settingsV2.api.scopeIncidentsMonitors")}</option>
          <option value="services">{t("settingsV2.api.scopeServices")}</option>
          <option value="status_pages">{t("settingsV2.api.scopeStatusPages")}</option>
          <option value="all">{t("settingsV2.api.scopeAll")}</option>
        </select>
      </DialogField>
      <DialogField label={t("settingsV2.api.expires")}>
        <select name="expires" defaultValue="90" className="oi-field" style={dialogSelectStyle}>
          <option value="30">{t("settingsV2.api.expires30")}</option>
          <option value="90">{t("settingsV2.api.expires90")}</option>
          <option value="365">{t("settingsV2.api.expires365")}</option>
          <option value="never">{t("settingsV2.api.expiresNever")}</option>
        </select>
      </DialogField>
    </SettingsDialog>
  );
}

/* ---------- New endpoint ---------- */

export function NewEndpointDialog({ choices }: { choices: Array<{ key: string; label: string }> }) {
  const t = useT();
  return (
    <SettingsDialog
      testId="webhook-dialog"
      title={t("settingsV2.api.hookTitle")}
      primary={t("settingsV2.api.hookCreate")}
      action={createWebhook}
      trigger={(open) => (
        <button
          type="button"
          data-testid="webhook-open"
          onClick={open}
          className="oi-hover"
          style={pageActionStyle(false)}
        >
          {t("settingsV2.api.newEndpoint")}
        </button>
      )}
    >
      <DialogField label={t("settingsV2.api.url")} help={t("settingsV2.api.urlHelp")}>
        <input
          name="url"
          required
          autoFocus
          placeholder="https://hooks.example.com/open-incident"
          className="oi-field"
          style={dialogInputStyle(true)}
        />
      </DialogField>
      <DialogField label={t("settingsV2.api.events")}>
        <select
          name="events"
          defaultValue="incident.*"
          className="oi-field"
          style={dialogSelectStyle}
        >
          {choices.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </DialogField>
      <SignedLine />
    </SettingsDialog>
  );
}

/**
 * "Sign the payloads (HMAC-SHA256)": every delivery is signed — the dispatch
 * has no unsigned path — so the switch is drawn on and fixed, and says why.
 */
function SignedLine() {
  const t = useT();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{t("settingsV2.api.sign")}</span>
        <span
          role="switch"
          aria-checked="true"
          aria-disabled="true"
          aria-label={t("settingsV2.api.sign")}
          style={{
            position: "relative",
            width: 36,
            height: 20,
            borderRadius: 999,
            background: "var(--brand)",
            flex: "none",
            opacity: 0.7,
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 2,
              left: 18,
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: "#fff",
              boxShadow: "0 1px 2px rgba(0,0,0,.2)",
            }}
          />
        </span>
      </div>
      <span style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.45 }}>
        {t("settingsV2.api.signHelp")}
      </span>
    </div>
  );
}

/* ---------- Rows ---------- */

export type KeyRowData = {
  id: string;
  name: string;
  sub: string;
  chip: ChipSpec;
};

export function KeyRow({ k, manages }: { k: KeyRowData; manages: boolean }) {
  const t = useT();
  const [pending, run] = useRowAction();
  return (
    <ClickRow
      testId="api-key-row"
      data={{ key: k.name }}
      title={k.name}
      titleMono
      sub={k.sub}
      chips={[k.chip]}
      button={
        manages ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => revokeApiKey(k.id))}
            className="oi-hover"
            style={smallButton("dang", pending)}
          >
            {t("settingsV2.api.revoke")}
          </button>
        ) : undefined
      }
    />
  );
}

export type EndpointRowData = {
  id: string;
  url: string;
  sub: string;
  chip: ChipSpec;
  off: boolean;
  events: string;
  failed: number;
  signing: string;
  deliveries: Array<{
    id: string;
    at: string;
    event: string;
    status: string;
    ok: boolean;
    ms: string;
  }>;
};

export function EndpointRow({ h, manages }: { h: EndpointRowData; manages: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pending, run] = useRowAction();
  const close = () => setOpen(false);
  return (
    <>
      <ClickRow
        testId="webhook-row"
        data={{ url: h.url }}
        title={h.url}
        titleMono
        sub={h.sub}
        chips={[h.chip]}
        onOpen={() => setOpen(true)}
        button={
          manages ? (
            <button
              type="button"
              data-testid="webhook-test"
              disabled={pending}
              onClick={() => run(() => sendWebhookTest(h.id))}
              className="oi-hover"
              style={smallButton("ink", pending)}
            >
              {t("settingsV2.api.sendTest")}
            </button>
          ) : undefined
        }
      />
      {open && (
        <PlainDialog
          testId="endpoint-dialog"
          title={h.url}
          onClose={close}
          footer={
            manages ? (
              <>
                <button
                  type="button"
                  data-testid="endpoint-delete"
                  disabled={pending}
                  onClick={() => run(() => deleteWebhook(h.id), close)}
                  className="oi-hover"
                  style={smallButton("dang", pending)}
                >
                  {t("settingsV2.api.delete")}
                </button>
                <button
                  type="button"
                  data-testid="endpoint-toggle"
                  disabled={pending}
                  onClick={() => run(() => toggleWebhook(h.id))}
                  className="oi-hover"
                  style={smallButton("ink", pending)}
                >
                  {h.off ? t("settingsV2.api.enable") : t("settingsV2.api.disable")}
                </button>
              </>
            ) : undefined
          }
        >
          <DialogReadOnly label={t("settingsV2.api.events")}>{h.events}</DialogReadOnly>
          <DialogReadOnly label={t("settingsV2.api.signing")}>{h.signing}</DialogReadOnly>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>
                {t("settingsV2.api.deliveries")}
              </span>
              {manages && h.failed > 0 && !h.off && (
                <button
                  type="button"
                  data-testid="endpoint-resend"
                  disabled={pending}
                  onClick={() => run(() => resendWebhookFailures(h.id))}
                  className="oi-hover"
                  style={smallButton("ink", pending)}
                >
                  {t("settingsV2.api.resend", { count: h.failed })}
                </button>
              )}
            </div>
            <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
              {h.deliveries.length === 0 && (
                <div style={{ padding: "9px 11px", fontSize: 12, color: "var(--ink-3)" }}>
                  {t("settingsV2.api.noDeliveries")}
                </div>
              )}
              {h.deliveries.map((d, i) => (
                <div
                  key={d.id}
                  data-testid="delivery-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 11px",
                    borderTop: i ? "1px solid var(--line-2)" : undefined,
                    fontSize: 12,
                  }}
                >
                  <span style={{ color: "var(--ink-3)", width: 96, flex: "none" }}>{d.at}</span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontFamily: "var(--mono)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {d.event}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontWeight: 600,
                      color: d.ok ? "var(--ok)" : "var(--dang)",
                    }}
                  >
                    {d.status}
                  </span>
                  <span style={{ color: "var(--ink-3)", width: 64, textAlign: "right" }}>
                    {d.ms}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </PlainDialog>
      )}
    </>
  );
}
