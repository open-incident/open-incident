"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import { createRule, createTemplate } from "./actions";

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
const AUDIENCES = ["workspace", "owner_team", "role_holders"] as const;

function Frame({
  title,
  onClose,
  children,
  testId,
  action,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  testId: string;
  action: (fd: FormData) => void | Promise<void>;
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
      <form
        data-testid={testId}
        action={action}
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "14px 20px",
            borderTop: "1px solid var(--line)",
          }}
        >
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
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
    </div>
  );
}

export function NewTemplateDialog() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="template-open"
        onClick={() => setOpen(true)}
        className="oi-hover-edge-fill"
        style={{
          height: 28,
          padding: "0 11px",
          border: "1px solid var(--line)",
          borderRadius: 8,
          background: "var(--panel)",
          fontSize: 11.5,
          fontWeight: 600,
          color: "var(--brand)",
          cursor: "pointer",
        }}
      >
        {t("settings.announcements.newTemplate")}
      </button>
      {open && (
        <Frame
          title={t("settings.announcements.newTemplateTitle")}
          onClose={() => setOpen(false)}
          testId="template-form"
          action={createTemplate}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>{t("settings.announcements.name")}</span>
              <input
                name="name"
                required
                autoFocus
                maxLength={120}
                placeholder={t("settings.announcements.templatePlaceholder")}
                className="oi-field"
                style={control}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>{t("settings.announcements.audienceLabel")}</span>
              <select name="audience" defaultValue="workspace" className="oi-field" style={control}>
                {AUDIENCES.map((a) => (
                  <option key={a} value={a}>
                    {t(`settings.announcements.audience.${a}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>{t("settings.announcements.body")}</span>
            <textarea
              name="body"
              required
              rows={3}
              defaultValue="{severity} · {title} — {status}, prochain point {next_update}"
              className="oi-field"
              style={{
                ...control,
                height: "auto",
                padding: "10px 12px",
                resize: "vertical",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
              }}
            />
          </label>
          <div className="oi-note" style={{ borderRadius: 11, padding: "11px 13px", fontSize: 12 }}>
            {t("settings.announcements.templateNote")}
          </div>
        </Frame>
      )}
    </>
  );
}

export function NewRuleDialog({
  templates,
  severities,
  types,
}: {
  templates: Array<{ id: string; name: string }>;
  severities: Array<{ rank: number; name: string }>;
  types: Array<{ id: string; name: string }>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="rule-open"
        onClick={() => setOpen(true)}
        disabled={templates.length === 0}
        title={templates.length === 0 ? t("settings.announcements.needTemplate") : undefined}
        className="oi-hover-edge-fill"
        style={{
          height: 28,
          padding: "0 11px",
          border: "1px solid var(--line)",
          borderRadius: 8,
          background: "var(--panel)",
          fontSize: 11.5,
          fontWeight: 600,
          color: "var(--brand)",
          cursor: templates.length === 0 ? "not-allowed" : "pointer",
          opacity: templates.length === 0 ? 0.5 : 1,
        }}
      >
        {t("settings.announcements.newRule")}
      </button>
      {open && (
        <Frame
          title={t("settings.announcements.newRuleTitle")}
          onClose={() => setOpen(false)}
          testId="rule-form"
          action={createRule}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>{t("settings.announcements.name")}</span>
            <input
              name="name"
              required
              autoFocus
              maxLength={120}
              placeholder={t("settings.announcements.rulePlaceholder")}
              className="oi-field"
              style={control}
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>{t("settings.announcements.ifSeverityLabel")}</span>
              <select name="minSeverityRank" defaultValue="1" className="oi-field" style={control}>
                <option value="">{t("settings.announcements.anySeverity")}</option>
                {severities.map((s) => (
                  <option key={s.rank} value={s.rank}>
                    ≥ {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>{t("settings.announcements.andTypeLabel")}</span>
              <select name="typeId" defaultValue="" className="oi-field" style={control}>
                <option value="">{t("settings.fields.allTypes")}</option>
                {types.map((ty) => (
                  <option key={ty.id} value={ty.id}>
                    {ty.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>{t("settings.announcements.thenTemplate")}</span>
              <select name="templateId" required className="oi-field" style={control}>
                {templates.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>{t("settings.announcements.audienceLabel")}</span>
              <select name="audience" defaultValue="workspace" className="oi-field" style={control}>
                {AUDIENCES.map((a) => (
                  <option key={a} value={a}>
                    {t(`settings.announcements.audience.${a}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="oi-note" style={{ borderRadius: 11, padding: "11px 13px", fontSize: 12 }}>
            {t("settings.announcements.ruleNote")}
          </div>
        </Frame>
      )}
    </>
  );
}
