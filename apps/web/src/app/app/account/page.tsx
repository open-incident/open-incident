import { getT } from "@/i18n/server";
import { LOCALES } from "@/i18n/locales";
import { requireMember } from "@/lib/session";
import { avatarTone, initials } from "@/lib/avatar";
import { saveProfile } from "./actions";
import { ChangeEmailForm, ChangePasswordForm, DeleteAccountForm } from "./account-forms";

/**
 * My account: the profile (name, own language and timezone — the on-call
 * member's, not the workspace's), then the three things a complete sign-in
 * story owes: change the address (confirmed from the old one), change the
 * password, delete the account (confirmed by email).
 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; email?: string }>;
}) {
  const { member, workspace, sessionEmail } = await requireMember();
  const t = await getT();
  const { saved, email } = await searchParams;
  const tone = avatarTone(member.name);
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

  return (
    <section style={{ flex: 1, minWidth: 0, overflow: "auto", padding: "18px 22px 28px" }}>
      <div
        className="oi-rise"
        style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span
            aria-hidden
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: tone.bg,
              color: tone.ink,
              display: "grid",
              placeItems: "center",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {initials(member.name)}
          </span>
          <div>
            <h1 className="oi-title" style={{ margin: 0 }}>
              {member.name}
            </h1>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
              {sessionEmail} · {t(`member.role.${member.role}`)}
            </div>
          </div>
          <span style={{ flex: 1 }} />
          {saved === "1" && (
            <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
              {t("common.saved")}
            </span>
          )}
          {email === "changed" && (
            <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
              {t("account.emailChanged")}
            </span>
          )}
        </div>

        <form
          action={saveProfile}
          className="oi-panel"
          style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>{t("account.profile")}</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>{t("account.name")}</span>
              <input
                name="name"
                defaultValue={member.name}
                required
                maxLength={80}
                className="oi-field"
                style={control}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>{t("account.locale")}</span>
              <select
                name="locale"
                defaultValue={member.locale ?? ""}
                className="oi-field"
                style={control}
              >
                <option value="">
                  {t("account.followWorkspace", {
                    value:
                      LOCALES.find((l) => l.code === workspace.locale)?.nativeName ??
                      workspace.locale,
                  })}
                </option>
                {LOCALES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.nativeName}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>{t("account.timezone")}</span>
              <select
                name="timezone"
                defaultValue={member.timezone ?? ""}
                className="oi-field"
                style={control}
              >
                <option value="">
                  {t("account.followWorkspace", { value: workspace.timezone })}
                </option>
                {Intl.supportedValuesOf("timeZone").map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>{t("account.theme")}</span>
              <select
                name="theme"
                defaultValue={member.theme ?? ""}
                className="oi-field"
                style={control}
                data-testid="account-theme"
              >
                <option value="">{t("account.themeSystem")}</option>
                <option value="light">{t("account.themeLight")}</option>
                <option value="dark">{t("account.themeDark")}</option>
              </select>
            </label>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
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
        </form>

        <ChangeEmailForm currentEmail={sessionEmail} />
        <ChangePasswordForm />
        <DeleteAccountForm isOwner={member.role === "owner"} />
      </div>
    </section>
  );
}
