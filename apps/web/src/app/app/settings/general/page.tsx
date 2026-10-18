import { getEdition } from "@openincident/config";
import { getT } from "@/i18n/server";
import { LOCALES } from "@/i18n/locales";
import { isManager, requireMember } from "@/lib/session";
import {
  FormCard,
  ReadOnly,
  Row,
  SettingsPage,
  fieldStyle,
  rowButtonStyle,
  selectStyle,
} from "@/components/settings/template";
import { CodeCard } from "@/components/settings/controls";
import { SettingsForm } from "@/components/settings/settings-form";
import { goPortal } from "../billing/actions";
import { saveGeneral } from "./actions";

/**
 * Settings › General (design V2): the workspace's name, its fixed slug, its
 * language and its default timezone — one card of rows, one save bar that
 * appears when something changed.
 *
 * The danger zone tells the truth of the edition: on a self-hosted instance
 * deleting a workspace is the operator's command, printed to copy; in the
 * cloud it is done from the subscription, in the console.
 */
export default async function GeneralSettingsPage() {
  const { tenant, workspace, member } = await requireMember();
  const t = await getT();
  const cloud = getEdition() === "cloud";
  const manages = isManager(member);

  return (
    <SettingsPage
      home={t("settingsV2.home")}
      crumb={t("settingsV2.group.workspace")}
      title={t("settingsV2.entry.general")}
      lead={t("settingsV2.general.lead")}
      testId="settings-general"
    >
      <SettingsForm action={saveGeneral} testId="general-form">
        <FormCard title={t("settingsV2.general.identity")}>
          <Row label={t("settingsV2.general.name")}>
            <input
              name="name"
              defaultValue={workspace.name}
              required
              maxLength={120}
              disabled={!manages}
              aria-label={t("settingsV2.general.name")}
              className="oi-field"
              style={fieldStyle()}
            />
          </Row>
          <Row label={t("settingsV2.general.slug")} help={t("settingsV2.general.slugHelp")}>
            <ReadOnly mono>{tenant.slug}</ReadOnly>
          </Row>
          <Row label={t("settingsV2.general.language")} help={t("settingsV2.general.languageHelp")}>
            <select
              name="locale"
              defaultValue={workspace.locale}
              disabled={!manages}
              aria-label={t("settingsV2.general.language")}
              className="oi-field"
              style={selectStyle}
            >
              {LOCALES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.nativeName}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t("settingsV2.general.timezone")} help={t("settingsV2.general.timezoneHelp")}>
            <select
              name="timezone"
              defaultValue={workspace.timezone}
              disabled={!manages}
              aria-label={t("settingsV2.general.timezone")}
              className="oi-field"
              style={selectStyle}
            >
              {Intl.supportedValuesOf("timeZone").map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </Row>
        </FormCard>
      </SettingsForm>

      {cloud ? (
        <FormCard title={t("settingsV2.general.danger")} hint={t("settingsV2.general.dangerCloud")}>
          <Row label={t("settingsV2.general.delete")} help={t("settingsV2.general.deleteHelp")}>
            {member.role === "owner" && (
              <form action={goPortal}>
                <button type="submit" className="oi-hover" style={rowButtonStyle(true)}>
                  {t("settingsV2.general.deleteBtn")}
                </button>
              </form>
            )}
          </Row>
        </FormCard>
      ) : (
        <CodeCard
          title={t("settingsV2.general.danger")}
          hint={t("settingsV2.general.dangerSelfHosted")}
          code={`pnpm workspace:delete -- --slug ${tenant.slug}`}
          testId="general-danger"
        />
      )}
    </SettingsPage>
  );
}
