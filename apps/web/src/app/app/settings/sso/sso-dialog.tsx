"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import {
  DialogField,
  DialogSegmented,
  DialogToggle,
  SettingsDialog,
  dialogInputStyle,
  dialogSelectStyle,
  dialogTextareaStyle,
} from "@/components/settings/dialog";
import { pageActionStyle } from "@/components/settings/template";
import { createSso } from "./actions";

/**
 * "+ Add a connection": the protocol chooses the provider's fields —
 * issuer, client ID and secret for OpenID Connect; the IdP metadata, or its
 * entity ID, sign-on URL and certificate, for SAML 2.0.
 */
export function NewConnectionDialog({ domain }: { domain: string }) {
  const t = useT();
  return (
    <SettingsDialog
      testId="sso-form"
      title={t("settingsV2.sso.dialog.title")}
      primary={t("settingsV2.sso.dialog.primary")}
      action={createSso}
      trigger={(open) => (
        <button
          type="button"
          data-testid="sso-add"
          onClick={open}
          className="oi-hover-brand-2"
          style={pageActionStyle(true)}
        >
          {t("settingsV2.sso.add")}
        </button>
      )}
    >
      <Fields domain={domain} />
    </SettingsDialog>
  );
}

function Fields({ domain }: { domain: string }) {
  const t = useT();
  const [kind, setKind] = useState("oidc");
  const mono = dialogInputStyle(true);
  return (
    <>
      <DialogSegmented
        label={t("settingsV2.sso.dialog.protocol")}
        name="kind"
        defaultValue="oidc"
        onChange={setKind}
        options={[
          { value: "oidc", label: t("settingsV2.sso.kind.oidc") },
          { value: "saml", label: t("settingsV2.sso.kind.saml") },
        ]}
      />
      <DialogField
        label={t("settingsV2.sso.dialog.label")}
        help={t("settingsV2.sso.dialog.labelHelp")}
      >
        <input
          name="label"
          required
          maxLength={60}
          placeholder="Entra ID"
          className="oi-field"
          style={dialogInputStyle()}
        />
      </DialogField>
      <DialogField
        label={t("settingsV2.sso.dialog.domains")}
        help={t("settingsV2.sso.dialog.domainsHelp")}
      >
        <input
          name="domains"
          placeholder={domain}
          className="oi-field"
          style={dialogInputStyle()}
        />
      </DialogField>
      <DialogField label={t("settingsV2.sso.dialog.role")}>
        <select
          name="defaultRole"
          defaultValue="responder"
          className="oi-field"
          style={dialogSelectStyle}
        >
          <option value="responder">{t("member.role.responder")}</option>
          <option value="viewer">{t("member.role.viewer")}</option>
          <option value="admin">{t("member.role.admin")}</option>
        </select>
      </DialogField>
      <DialogToggle name="jit" label={t("settingsV2.sso.dialog.jit")} defaultChecked />
      <DialogToggle
        name="enforce"
        label={t("settingsV2.sso.dialog.enforce")}
        defaultChecked={false}
        testId="sso-enforce"
      />
      {kind === "saml" ? (
        <>
          <DialogField
            label={t("settingsV2.sso.dialog.metadata")}
            help={t("settingsV2.sso.dialog.metadataHelp")}
          >
            <textarea
              name="metadata"
              rows={3}
              placeholder="<EntityDescriptor …>"
              className="oi-field"
              style={{ ...dialogTextareaStyle, fontFamily: "var(--mono)", fontSize: 12 }}
            />
          </DialogField>
          <DialogField label={t("settingsV2.sso.dialog.entityId")}>
            <input
              name="entityId"
              placeholder="https://idp.example.com/saml"
              className="oi-field"
              style={mono}
            />
          </DialogField>
          <DialogField label={t("settingsV2.sso.dialog.entryPoint")}>
            <input
              name="entryPoint"
              type="url"
              placeholder="https://idp.example.com/saml/sso"
              className="oi-field"
              style={mono}
            />
          </DialogField>
          <DialogField label={t("settingsV2.sso.dialog.cert")}>
            <textarea
              name="cert"
              rows={3}
              placeholder="-----BEGIN CERTIFICATE-----"
              className="oi-field"
              style={{ ...dialogTextareaStyle, fontFamily: "var(--mono)", fontSize: 12 }}
            />
          </DialogField>
        </>
      ) : (
        <>
          <DialogField
            label={t("settingsV2.sso.dialog.issuer")}
            help={t("settingsV2.sso.dialog.issuerHelp")}
          >
            <input
              name="issuer"
              type="url"
              required
              placeholder="https://login.microsoftonline.com/…/v2.0"
              className="oi-field"
              style={mono}
            />
          </DialogField>
          <DialogField label={t("settingsV2.sso.dialog.clientId")}>
            <input name="clientId" required className="oi-field" style={mono} />
          </DialogField>
          <DialogField label={t("settingsV2.sso.dialog.clientSecret")}>
            <input
              name="clientSecret"
              type="password"
              required
              autoComplete="off"
              className="oi-field"
              style={mono}
            />
          </DialogField>
        </>
      )}
    </>
  );
}
