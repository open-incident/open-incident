import { listSsoConnections, ssoUrls } from "@openincident/ee-web/sso";
import { getT } from "@/i18n/server";
import { entitlementsFor } from "@/lib/entitlements";
import { isManager, requireMember } from "@/lib/session";
import { currentOrigin } from "@/lib/tenant";
import { CopyValue } from "@/components/settings/controls";
import {
  FormCard,
  ListCard,
  ListItem,
  Note,
  Row,
  SettingsPage,
  Unavailable,
} from "@/components/settings/template";
import { ago } from "../members/format";
import { NewConnectionDialog } from "./sso-dialog";
import { RemoveConnection } from "./remove-connection";

/**
 * Settings › Single sign-on (design V2, enterprise): the connections — what
 * each covers, who it creates, whether passwords still count — then what to
 * give the provider, read from the connection and this workspace's address.
 */
export default async function SsoPage() {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const entitled = entitlementsFor(tenant).sso;
  const home = t("settingsV2.home");
  const crumb = t("settingsV2.group.people");
  const title = t("settingsV2.entry.sso");

  if (!entitled)
    return (
      <SettingsPage home={home} crumb={crumb} title={title} lead={t("settingsV2.sso.leadEe")}>
        <Unavailable
          testId="ee-unavailable"
          title={t("settingsV2.unavailable")}
          text={t("settingsV2.eeText")}
          code="OI_ENTITLEMENTS=sso,customRoles"
        />
      </SettingsPage>
    );

  const manages = isManager(member);
  const origin = (await currentOrigin()).replace(/\/$/, "");
  const connections = (await listSsoConnections(tenant.id)).sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const roleLabel = (r: string) =>
    t(`member.role.${r as "owner" | "admin" | "responder" | "viewer"}`);
  const several = connections.length > 1;
  const domain = member.email.split("@")[1] ?? "example.com";

  return (
    <SettingsPage
      home={home}
      crumb={crumb}
      title={title}
      lead={t("settingsV2.sso.lead")}
      actions={manages ? <NewConnectionDialog domain={domain} /> : undefined}
      testId="settings-sso"
    >
      <ListCard title={t("settingsV2.sso.connections")} testId="sso-connections">
        {connections.map((c) => (
          <ListItem
            key={c.id}
            testId="sso-row"
            data={{ label: c.label }}
            glyph={{ text: c.label.slice(0, 2) }}
            title={`${c.label} · ${t(`settingsV2.sso.kind.${c.kind}`)}`}
            sub={t("settingsV2.sso.sub", {
              domains: c.allowedDomains.length
                ? c.allowedDomains.join(", ")
                : t("settingsV2.sso.anyDomain"),
              jit: c.jitProvisioning ? t("settingsV2.sso.jit") : t("settingsV2.sso.noJit"),
              role: roleLabel(c.defaultRole),
            })}
            chips={[
              c.enforce
                ? { label: t("settingsV2.sso.enforced"), tone: "brand", testId: "sso-enforced" }
                : { label: t("settingsV2.sso.passwords"), tone: "mute" },
            ]}
            right={
              c.lastSignInAt
                ? t("settingsV2.sso.lastSignIn", { when: ago(t, c.lastSignInAt) })
                : t("settingsV2.sso.neverUsed")
            }
            button={manages ? <RemoveConnection id={c.id} /> : undefined}
          />
        ))}
        {connections.length === 0 && (
          <div
            style={{
              padding: "12px 18px",
              borderTop: "1px solid var(--line-2)",
              fontSize: 12.5,
              color: "var(--ink-3)",
            }}
          >
            {t("settingsV2.sso.none")}
          </div>
        )}
      </ListCard>

      <FormCard
        title={t("settingsV2.sso.give")}
        hint={t("settingsV2.sso.giveHint")}
        testId="sso-urls"
      >
        {connections.map((c) => {
          const urls = ssoUrls(origin, c.providerId);
          const help = several ? c.label : undefined;
          return c.kind === "oidc" ? (
            <Row key={c.id} label={t("settingsV2.sso.redirect")} help={help}>
              <CopyValue value={urls.redirectUri} testId="sso-redirect-uri" />
            </Row>
          ) : (
            <div key={c.id} style={{ display: "contents" }}>
              <Row label={t("settingsV2.sso.acs")} help={help}>
                <CopyValue value={urls.acsUrl} testId="sso-acs-url" />
              </Row>
              <Row label={t("settingsV2.sso.entity")} help={help}>
                <CopyValue value={urls.entityId} testId="sso-entity-id" />
              </Row>
              <Row label={t("settingsV2.sso.metadataUrl")} help={help}>
                <CopyValue value={urls.metadataUrl} testId="sso-metadata-url" />
              </Row>
            </div>
          );
        })}
        <Row label={t("settingsV2.sso.signInPage")}>
          <CopyValue value={`${origin}/login`} testId="sso-sign-in-page" />
        </Row>
      </FormCard>

      <Note tone="wait">{t("settingsV2.sso.note")}</Note>
    </SettingsPage>
  );
}
