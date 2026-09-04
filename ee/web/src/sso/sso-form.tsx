"use client";

import { useState } from "react";

const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};
const control: React.CSSProperties = {
  height: 36,
  padding: "0 12px",
  border: "1px solid var(--line)",
  borderRadius: 10,
  outline: "none",
  fontSize: 13,
  background: "var(--panel)",
  width: "100%",
};
const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 12 };
const hint: React.CSSProperties = { fontSize: 11.5, color: "var(--ink-3)" };

type Labels = Record<
  | "add"
  | "title"
  | "kind"
  | "oidc"
  | "saml"
  | "label"
  | "labelHint"
  | "domains"
  | "domainsHint"
  | "defaultRole"
  | "jit"
  | "enforce"
  | "issuer"
  | "issuerHint"
  | "clientId"
  | "clientSecret"
  | "entryPoint"
  | "entityId"
  | "cert"
  | "metadata"
  | "metadataHint"
  | "save",
  string
>;

/** The new-connection form: the protocol picks which fields are shown; the server validates. */
export function SsoForm({
  action,
  labels: l,
}: {
  action: (formData: FormData) => Promise<void>;
  labels: Labels;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"oidc" | "saml">("oidc");
  if (!open)
    return (
      <button
        type="button"
        data-testid="sso-add"
        onClick={() => setOpen(true)}
        style={{
          alignSelf: "flex-start",
          height: 34,
          padding: "0 14px",
          borderRadius: 9,
          background: "var(--brand)",
          color: "#fff",
          border: 0,
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {l.add}
      </button>
    );
  const field = (
    name: string,
    text: string,
    extra?: React.InputHTMLAttributes<HTMLInputElement>,
    sub?: string,
  ) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={label}>{text}</span>
      <input
        name={name}
        className="oi-field"
        style={{ ...control, ...(extra?.style ?? {}) }}
        {...extra}
      />
      {sub && <span style={hint}>{sub}</span>}
    </label>
  );
  return (
    <form
      action={action}
      data-testid="sso-form"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        padding: "16px 18px",
      }}
    >
      <div style={{ fontFamily: "var(--font-title)", fontSize: 15.5, fontWeight: 600 }}>
        {l.title}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={label}>{l.kind}</span>
          <select
            name="kind"
            data-testid="sso-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "oidc" | "saml")}
            className="oi-field"
            style={control}
          >
            <option value="oidc">{l.oidc}</option>
            <option value="saml">{l.saml}</option>
          </select>
        </label>
        {field("label", l.label, { required: true, placeholder: "Okta" }, l.labelHint)}
        {field(
          "domains",
          l.domains,
          { placeholder: "acme.com, acme.io", style: mono },
          l.domainsHint,
        )}
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={label}>{l.defaultRole}</span>
          <select name="defaultRole" defaultValue="responder" className="oi-field" style={control}>
            <option value="admin">admin</option>
            <option value="responder">responder</option>
            <option value="viewer">viewer</option>
          </select>
        </label>
      </div>
      {kind === "oidc" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            {field(
              "issuer",
              l.issuer,
              { type: "url", required: true, placeholder: "https://acme.okta.com", style: mono },
              l.issuerHint,
            )}
          </div>
          {field("clientId", l.clientId, { required: true, style: mono })}
          {field("clientSecret", l.clientSecret, { required: true, type: "password", style: mono })}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>{l.metadata}</span>
            <textarea
              name="metadata"
              rows={4}
              className="oi-field"
              style={{
                ...control,
                ...mono,
                height: "auto",
                padding: "8px 12px",
                resize: "vertical",
              }}
            />
            <span style={hint}>{l.metadataHint}</span>
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {field("entityId", l.entityId, {
              placeholder: "https://idp.example.com/saml",
              style: mono,
            })}
            {field("entryPoint", l.entryPoint, {
              type: "url",
              placeholder: "https://idp.example.com/sso",
              style: mono,
            })}
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>{l.cert}</span>
            <textarea
              name="cert"
              rows={4}
              placeholder="-----BEGIN CERTIFICATE-----"
              className="oi-field"
              style={{
                ...control,
                ...mono,
                height: "auto",
                padding: "8px 12px",
                resize: "vertical",
              }}
            />
          </label>
        </div>
      )}
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input type="checkbox" name="jit" defaultChecked /> {l.jit}
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input type="checkbox" name="enforce" data-testid="sso-enforce" /> {l.enforce}
      </label>
      <div>
        <button
          type="submit"
          data-testid="sso-save"
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
          {l.save}
        </button>
      </div>
    </form>
  );
}
