import type { ScreenDeps } from "./deps";
import { ssoUrls, type SsoConnectionRow } from "./store";
import { SsoForm } from "./sso-form";

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 14,
  padding: "14px 16px",
  boxShadow: "var(--shadow-card)",
};

/**
 * Settings → Single sign-on. The connections with what the provider was told
 * (redirect URI, ACS, metadata), the form for a new one, and the removal.
 * Actions come from the shell: this component only renders.
 */
export function SsoSettings({
  deps,
  connections,
  notice,
  actions,
}: {
  deps: ScreenDeps;
  connections: SsoConnectionRow[];
  notice?: { kind: "saved" | "removed" | "error"; code?: string; detail?: string };
  actions: {
    create: (formData: FormData) => Promise<void>;
    remove: (formData: FormData) => Promise<void>;
  };
}) {
  const { t } = deps;
  if (!deps.entitled) return <>{deps.unavailable}</>;
  const errorText = (code: string | undefined) =>
    code === "lockout" ? t("ee.sso.error.lockout") : t("ee.sso.error.invalid");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 760 }}>
      <div>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("ee.sso.title")}
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
          {t("ee.sso.lead")}
        </p>
      </div>
      {notice?.kind === "saved" && (
        <p
          role="status"
          data-testid="sso-saved"
          style={{ margin: 0, fontSize: 13, color: "var(--ok)" }}
        >
          {t("ee.sso.saved")}
        </p>
      )}
      {notice?.kind === "removed" && (
        <p role="status" style={{ margin: 0, fontSize: 13, color: "var(--ok)" }}>
          {t("ee.sso.removed")}
        </p>
      )}
      {notice?.kind === "error" && (
        <p
          role="alert"
          data-testid="sso-error"
          style={{
            margin: 0,
            padding: "10px 12px",
            borderRadius: 10,
            background: "var(--dang-t)",
            border: "1px solid var(--dang)",
            color: "var(--dang)",
            fontSize: 13,
          }}
        >
          {errorText(notice.code)}
          {notice.detail && (
            <span
              style={{
                display: "block",
                marginTop: 4,
                fontSize: 12,
                fontFamily: "var(--font-mono)",
              }}
            >
              {t("ee.sso.error.detail", { detail: notice.detail })}
            </span>
          )}
        </p>
      )}

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="oi-eyebrow">{t("ee.sso.connections")}</div>
        {connections.length === 0 && (
          <div style={{ ...card, color: "var(--ink-3)", fontSize: 13 }}>{t("ee.sso.none")}</div>
        )}
        {connections.map((c) => {
          const urls = ssoUrls(deps.origin, c.providerId);
          return (
            <div
              key={c.id}
              data-testid="sso-row"
              style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{c.label}</span>
                <span
                  style={{
                    padding: "1px 8px",
                    borderRadius: 999,
                    background: "var(--brand-t)",
                    color: "var(--brand)",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {t(`ee.sso.kind.${c.kind}`)}
                </span>
                {c.enforce && (
                  <span
                    data-testid="sso-enforced"
                    style={{
                      padding: "1px 8px",
                      borderRadius: 999,
                      background: "var(--dang-t)",
                      color: "var(--dang)",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {t("ee.sso.enforced")}
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <form action={actions.remove}>
                  <input type="hidden" name="id" value={c.id} />
                  <button
                    type="submit"
                    data-testid="sso-remove"
                    className="oi-hover-dang"
                    style={{
                      height: 28,
                      padding: "0 10px",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      background: "var(--panel)",
                      color: "var(--dang)",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    {t("ee.sso.remove")}
                  </button>
                </form>
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--ink-2)",
                  display: "flex",
                  gap: 14,
                  flexWrap: "wrap",
                }}
              >
                <span>
                  {t("ee.sso.field.domains")}:{" "}
                  <span style={{ fontFamily: "var(--font-mono)" }}>
                    {c.allowedDomains.length
                      ? c.allowedDomains.join(", ")
                      : t("ee.sso.domains.any")}
                  </span>
                </span>
                <span>
                  {t("ee.sso.defaultRole")}: {c.defaultRole}
                </span>
                <span>{c.jitProvisioning ? t("ee.sso.jit") : t("ee.sso.noJit")}</span>
                <span style={{ color: "var(--ink-3)" }}>
                  {c.lastSignInAt
                    ? t("ee.sso.lastSignIn", { when: t.fmt.relative(c.lastSignInAt) })
                    : t("ee.sso.neverUsed")}
                </span>
              </div>
              <div
                data-testid="sso-urls"
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  gap: "4px 12px",
                  fontSize: 12,
                  padding: "10px 12px",
                  background: "var(--sunk)",
                  borderRadius: 10,
                }}
              >
                <span style={{ color: "var(--ink-3)", gridColumn: "1 / -1", fontWeight: 600 }}>
                  {t("ee.sso.urls.title")}
                </span>
                {c.kind === "oidc" ? (
                  <>
                    <span style={{ color: "var(--ink-3)" }}>{t("ee.sso.urls.redirect")}</span>
                    <code
                      data-testid="sso-redirect-uri"
                      style={{ fontFamily: "var(--font-mono)", wordBreak: "break-all" }}
                    >
                      {urls.redirectUri}
                    </code>
                  </>
                ) : (
                  <>
                    <span style={{ color: "var(--ink-3)" }}>{t("ee.sso.urls.acs")}</span>
                    <code
                      data-testid="sso-acs-url"
                      style={{ fontFamily: "var(--font-mono)", wordBreak: "break-all" }}
                    >
                      {urls.acsUrl}
                    </code>
                    <span style={{ color: "var(--ink-3)" }}>{t("ee.sso.urls.entity")}</span>
                    <code style={{ fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>
                      {urls.entityId}
                    </code>
                    <span style={{ color: "var(--ink-3)" }}>{t("ee.sso.urls.metadata")}</span>
                    <a
                      data-testid="sso-metadata-url"
                      href={urls.metadataUrl}
                      className="oi-link"
                      style={{ fontFamily: "var(--font-mono)", wordBreak: "break-all" }}
                    >
                      {urls.metadataUrl}
                    </a>
                  </>
                )}
              </div>
            </div>
          );
        })}
        <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
          {t("ee.sso.urls.note")}
        </div>
      </section>

      <SsoForm
        action={actions.create}
        labels={{
          add: t("ee.sso.add"),
          title: t("ee.sso.addTitle"),
          kind: t("ee.sso.field.kind"),
          oidc: t("ee.sso.kind.oidc"),
          saml: t("ee.sso.kind.saml"),
          label: t("ee.sso.field.label"),
          labelHint: t("ee.sso.field.labelHint"),
          domains: t("ee.sso.field.domains"),
          domainsHint: t("ee.sso.field.domainsHint"),
          defaultRole: t("ee.sso.field.defaultRole"),
          jit: t("ee.sso.field.jit"),
          enforce: t("ee.sso.field.enforce"),
          issuer: t("ee.sso.field.issuer"),
          issuerHint: t("ee.sso.field.issuerHint", { issuer: "https://idp.example.com" }),
          clientId: t("ee.sso.field.clientId"),
          clientSecret: t("ee.sso.field.clientSecret"),
          entryPoint: t("ee.sso.field.entryPoint"),
          entityId: t("ee.sso.field.entityId"),
          cert: t("ee.sso.field.cert"),
          metadata: t("ee.sso.field.metadata"),
          metadataHint: t("ee.sso.field.metadataHint"),
          save: t("ee.sso.save"),
        }}
      />
    </div>
  );
}
