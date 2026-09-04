"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import { createField } from "./actions";

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
const KINDS = ["text", "select", "number", "link", "catalog_entry"] as const;

/** The design's field modal: api name in mono, incident type, the kind as a segmented control, a required switch. */
export function NewFieldDialog({
  types,
}: {
  types: Array<{ id: string; name: string; isDefault: boolean }>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("text");
  const [required, setRequired] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="field-open"
        onClick={() => setOpen(true)}
        style={{
          height: 32,
          padding: "0 14px",
          borderRadius: 9,
          background: "var(--brand)",
          color: "#fff",
          border: 0,
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {t("settings.fields.new")}
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
          <form
            data-testid="field-form"
            action={createField}
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
                {t("settings.fields.newTitle")}
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("settings.fields.key")}</span>
                  <input
                    name="key"
                    required
                    autoFocus
                    pattern="^[a-z][a-z0-9_]{1,39}$"
                    placeholder="affected_tenant"
                    className="oi-field"
                    style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12.5 }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("settings.fields.incidentType")}</span>
                  <select
                    name="incidentTypeId"
                    defaultValue={types.find((x) => x.isDefault)?.id ?? ""}
                    className="oi-field"
                    style={control}
                  >
                    <option value="">{t("settings.fields.allTypes")}</option>
                    {types.map((ty) => (
                      <option key={ty.id} value={ty.id}>
                        {ty.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("settings.fields.label")}</span>
                <input
                  name="label"
                  maxLength={80}
                  placeholder={t("settings.fields.labelPlaceholder")}
                  className="oi-field"
                  style={control}
                />
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("settings.fields.kind")}</span>
                <div
                  role="radiogroup"
                  style={{
                    display: "flex",
                    gap: 2,
                    background: "var(--sunk)",
                    borderRadius: 9,
                    padding: 3,
                  }}
                >
                  {KINDS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={kind === k}
                      onClick={() => setKind(k)}
                      style={{
                        flex: 1,
                        padding: "6px 0",
                        borderRadius: 7,
                        border: 0,
                        background: kind === k ? "var(--panel)" : "transparent",
                        fontSize: 12,
                        fontWeight: kind === k ? 600 : 500,
                        color: kind === k ? "var(--ink)" : "var(--ink-3)",
                        boxShadow: kind === k ? "var(--shadow-card)" : "none",
                        cursor: "pointer",
                      }}
                    >
                      {t(`settings.fields.type.${k}`)}
                    </button>
                  ))}
                </div>
                <input type="hidden" name="type" value={kind} />
              </div>
              {kind === "select" && (
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("settings.fields.options")}</span>
                  <textarea
                    name="options"
                    rows={3}
                    required
                    placeholder={"eu-west-1\nus-east-1"}
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
              )}
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 12.5,
                  color: "var(--ink-2)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  name="required"
                  checked={required}
                  onChange={(e) => setRequired(e.target.checked)}
                  style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
                />
                <span
                  aria-hidden
                  style={{
                    width: 38,
                    height: 22,
                    borderRadius: 999,
                    background: required ? "var(--brand)" : "var(--line)",
                    position: "relative",
                    flex: "none",
                    transition: "background .15s",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 2.5,
                      left: required ? 18 : 3,
                      width: 17,
                      height: 17,
                      borderRadius: "50%",
                      background: "#fff",
                      boxShadow: "0 1px 3px rgba(0,0,0,.25)",
                      transition: "left .15s",
                    }}
                  />
                </span>
                {t("settings.fields.requiredAtDeclare")}
              </label>
              <div
                className="oi-note"
                style={{ borderRadius: 11, padding: "11px 13px", fontSize: 12 }}
              >
                {t("settings.fields.newNote")}
              </div>
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
      )}
    </>
  );
}
