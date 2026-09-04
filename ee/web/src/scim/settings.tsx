import type { ScreenDeps } from "../sso/deps";
import { ScimPanel } from "./scim-panel";
import type { ScimSettingsRow } from "./store";

/**
 * Settings → Provisioning (SCIM). The endpoint's address and its state, the
 * token issued once, the options a provider-created member starts with.
 */
export function ScimSettings({
  deps,
  settings,
  provisionedCount,
  actions,
}: {
  deps: ScreenDeps;
  settings: ScimSettingsRow | null;
  provisionedCount: number;
  actions: {
    issue: (formData: FormData) => Promise<{ token: string } | { error: string }>;
    toggle: (formData: FormData) => Promise<void>;
    saveOptions: (formData: FormData) => Promise<void>;
  };
}) {
  const { t } = deps;
  if (!deps.entitled) return <>{deps.unavailable}</>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 760 }}>
      <div>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("ee.scim.title")}
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
          {t("ee.scim.lead")}
        </p>
      </div>
      <ScimPanel
        baseUrl={`${deps.origin.replace(/\/$/, "")}/scim/v2`}
        state={
          settings
            ? {
                enabled: settings.enabled,
                tokenHint: settings.tokenHint,
                lastSeen: settings.lastSeenAt ? t.fmt.relative(settings.lastSeenAt) : null,
                defaultRole: settings.defaultRole,
                sendInvites: settings.sendInvites,
                provisionedCount,
              }
            : null
        }
        actions={actions}
        labels={{
          baseUrl: t("ee.scim.baseUrl"),
          baseUrlHint: t("ee.scim.baseUrlHint"),
          notEnabled: t("ee.scim.notEnabled"),
          enable: t("ee.scim.enable"),
          rotate: t("ee.scim.rotate"),
          disable: t("ee.scim.disable"),
          reenable: t("ee.scim.reenable"),
          enabled: t("ee.scim.enabled"),
          disabled: t("ee.scim.disabled"),
          token: t("ee.scim.token"),
          tokenOnce: t("ee.scim.tokenOnce"),
          tokenHint: t("ee.scim.tokenHint"),
          lastSeen: t("ee.scim.lastSeen"),
          neverSeen: t("ee.scim.neverSeen"),
          provisioned: t("ee.scim.provisioned", { count: provisionedCount }),
          options: t("ee.scim.options"),
          defaultRole: t("ee.scim.defaultRole"),
          sendInvites: t("ee.scim.sendInvites"),
          save: t("common.save"),
          mapping: t("ee.scim.mapping"),
          error: t("ee.scim.error"),
        }}
      />
    </div>
  );
}
