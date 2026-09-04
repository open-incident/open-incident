import { getT } from "@/i18n/server";
import { LOCALES } from "@/i18n/locales";
import { requireMember } from "@/lib/session";
import { getEdition } from "@openincident/config";
import { WorkspaceMark } from "@/components/shell/mark";
import { saveGeneral } from "./actions";
import { removeLogo, uploadLogo } from "./logo-actions";
import { storageConfigured } from "@openincident/storage";

/**
 * Settings → General & brand: identity (name, immutable slug, language,
 * timezone) and brand (accent, logo). The logo needs object storage: without
 * S3_* on the instance the row says so, and the square shows the initial on
 * the accent, which is what every screen uses.
 *
 * The danger zone tells the truth of the edition: on a self-hosted instance
 * deleting a workspace is the operator's command, not a button in the product
 * — the row says which command. Suspension is a control-plane act and is not
 * offered here.
 */
export default async function GeneralSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { tenant, workspace, member } = await requireMember();
  const t = await getT();
  const { saved, error } = await searchParams;
  const storage = storageConfigured();
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
    fontSize: 13.5,
    background: "var(--panel)",
    width: "100%",
  };
  const smallBtn: React.CSSProperties = {
    height: 30,
    padding: "0 10px",
    border: "1px solid var(--line)",
    borderRadius: 8,
    background: "var(--panel)",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "inherit",
  };

  return (
    <form
      action={saveGeneral}
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 860 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("settings.general.title")}
        </h1>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {t("settings.general.subtitle")}
        </span>
        <span style={{ flex: 1 }} />
        {saved === "1" && (
          <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
            {t("common.saved")}
          </span>
        )}
        <button
          type="submit"
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
          {t("common.save")}
        </button>
      </div>
      <div
        className="oi-panel"
        style={{ padding: "16px 18px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={label}>{t("settings.general.name")}</span>
          <input
            name="name"
            defaultValue={workspace.name}
            required
            maxLength={120}
            className="oi-field"
            style={control}
          />
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={label}>{t("settings.general.slug")}</span>
          <div
            style={{
              ...control,
              background: "var(--sunk)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontFamily: "var(--font-mono)",
              fontSize: 12.5,
              color: "var(--ink-2)",
            }}
          >
            {tenant.slug}
            <span style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--ink-3)" }}>
              · {t("settings.general.numbering")}
            </span>
          </div>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={label}>{t("settings.general.locale")}</span>
          <select
            name="locale"
            defaultValue={workspace.locale}
            className="oi-field"
            style={control}
          >
            {LOCALES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.nativeName} — {t("settings.general.localeOverride")}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={label}>{t("settings.general.timezone")}</span>
          <select
            name="timezone"
            defaultValue={workspace.timezone}
            className="oi-field"
            style={control}
          >
            {Intl.supportedValuesOf("timeZone").map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        className="oi-panel"
        style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}
      >
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t("settings.general.brand")}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <WorkspaceMark
            name={workspace.name}
            accent={workspace.branding.accentColor}
            logoUrl={workspace.branding.logoUrl}
            size={40}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{t("settings.general.logo")}</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              {storage ? t("settings.general.logoHint") : t("settings.general.logoUnavailable")}
            </div>
          </div>
          {storage && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <label style={smallBtn} title={t("settings.general.logoLight")}>
                {t("settings.general.logoLight")}
                <input
                  type="file"
                  name="logo"
                  accept="image/svg+xml,image/png"
                  data-testid="logo-file"
                  style={{ width: 118, fontSize: 11 }}
                />
              </label>
              <label style={smallBtn} title={t("settings.general.logoDark")}>
                {t("settings.general.logoDark")}
                <input
                  type="file"
                  name="logoDark"
                  accept="image/svg+xml,image/png"
                  style={{ width: 118, fontSize: 11 }}
                />
              </label>
              <button
                type="submit"
                formAction={uploadLogo}
                data-testid="logo-upload"
                style={{ ...smallBtn, fontWeight: 600, cursor: "pointer" }}
              >
                {workspace.branding.logoUrl
                  ? t("settings.general.logoReplace")
                  : t("settings.general.logoUpload")}
              </button>
              {workspace.branding.logoUrl && (
                <button
                  type="submit"
                  formAction={removeLogo}
                  data-testid="logo-remove"
                  style={{ ...smallBtn, color: "var(--dang)", cursor: "pointer" }}
                >
                  {t("settings.general.logoRemove")}
                </button>
              )}
            </div>
          )}
        </div>
        {error && ["storage", "nofile", "logotype"].includes(error) && (
          <div role="alert" style={{ fontSize: 12.5, color: "var(--dang)" }}>
            {t(`settings.general.logoError.${error as "storage" | "nofile" | "logotype"}`)}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: 11,
              background: workspace.branding.accentColor ?? "var(--brand)",
              flex: "none",
              border: "1px solid var(--line)",
            }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{t("settings.general.accent")}</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              {t("settings.general.accentHint")}
            </div>
          </div>
          <input
            name="accentColor"
            defaultValue={workspace.branding.accentColor ?? ""}
            pattern="^#[0-9a-fA-F]{6}$"
            placeholder="#B4552D"
            aria-label={t("settings.general.accent")}
            className="oi-field"
            style={{
              height: 30,
              padding: "0 12px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              width: 120,
              outline: "none",
            }}
          />
        </div>
      </div>
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--dang)",
          borderRadius: 14,
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--dang)" }}>
            {t("settings.general.dangerTitle")}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {getEdition() === "cloud"
              ? t("settings.general.dangerCloud")
              : t("settings.general.dangerSelfHosted")}
          </div>
        </div>
        {getEdition() !== "cloud" && member.role === "owner" && (
          <code
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              background: "var(--sunk)",
              borderRadius: 8,
              padding: "6px 10px",
              color: "var(--ink-2)",
            }}
          >
            pnpm workspace:delete -- --slug {tenant.slug}
          </code>
        )}
      </div>
    </form>
  );
}
