import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { auditEvents, members, ssoConnections, teams, withTenant } from "@openincident/db";
import { getScimSettings } from "@openincident/ee-web/scim";
import { getT } from "@/i18n/server";
import { entitlementsFor } from "@/lib/entitlements";
import { isManager, requireMember } from "@/lib/session";
import { currentOrigin } from "@/lib/tenant";
import { CopyValue, Toggle } from "@/components/settings/controls";
import { SettingsForm } from "@/components/settings/settings-form";
import {
  FormCard,
  ReadOnly,
  Row,
  SettingsPage,
  Stats,
  Unavailable,
  selectStyle,
} from "@/components/settings/template";
import { ago, shortDate } from "../members/format";
import { saveScimOptions } from "./actions";
import { ScimToggle, TokenDialog } from "./scim-controls";

const WRITES = [
  "member.provisioned",
  "member.updated_by_provider",
  "member.deactivated_by_provider",
  "team.provisioned",
  "team.updated_by_provider",
  "team.deleted_by_provider",
] as const;

/**
 * Settings › Provisioning (design V2, enterprise): where the SCIM endpoint
 * stands — on or off, its last call, what it provisioned, which groups became
 * teams — then the address and the token to give the provider, and what a
 * provisioned member starts with.
 *
 * The figures come from rows: the endpoint's settings, the members whose
 * source is SCIM, and the audit lines every SCIM write leaves (the teams a
 * provider pushed are the ones those lines name and that still exist).
 */
export default async function ScimPage() {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const entitled = entitlementsFor(tenant).sso;
  const home = t("settingsV2.home");
  const crumb = t("settingsV2.group.people");
  const title = t("settingsV2.entry.scim");

  if (!entitled)
    return (
      <SettingsPage home={home} crumb={crumb} title={title} lead={t("settingsV2.scim.leadEe")}>
        <Unavailable
          testId="ee-unavailable"
          title={t("settingsV2.unavailable")}
          text={t("settingsV2.eeText")}
          code="OI_ENTITLEMENTS=sso,customRoles"
        />
      </SettingsPage>
    );

  const manages = isManager(member);
  const settings = await getScimSettings(tenant.id);
  const origin = (await currentOrigin()).replace(/\/$/, "");
  const facts = await withTenant(tenant.id, async (tx) => {
    const provisioned = await tx
      .select({ status: members.status, n: sql<number>`count(*)`.mapWith(Number) })
      .from(members)
      .where(and(eq(members.tenantId, tenant.id), eq(members.source, "scim")))
      .groupBy(members.status);
    const writes = await tx
      .select({
        action: auditEvents.action,
        name: sql<string | null>`${auditEvents.target}->>'name'`,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .where(and(eq(auditEvents.tenantId, tenant.id), inArray(auditEvents.action, [...WRITES])))
      .orderBy(desc(auditEvents.createdAt))
      .limit(500);
    const teamRows = await tx
      .select({ name: teams.name })
      .from(teams)
      .where(eq(teams.tenantId, tenant.id))
      .orderBy(asc(teams.name));
    const [firstConnection] = await tx
      .select({ label: ssoConnections.label })
      .from(ssoConnections)
      .where(eq(ssoConnections.tenantId, tenant.id))
      .orderBy(asc(ssoConnections.createdAt))
      .limit(1);
    // Who issued the token in use: the last rotation's author, else whoever created the endpoint.
    const [rotation] = settings?.rotatedAt
      ? await tx
          .select({ actorName: auditEvents.actorName })
          .from(auditEvents)
          .where(
            and(eq(auditEvents.tenantId, tenant.id), eq(auditEvents.action, "scim.token_rotated")),
          )
          .orderBy(desc(auditEvents.createdAt))
          .limit(1)
      : [];
    const [creator] = settings?.createdByMemberId
      ? await tx
          .select({ name: members.name })
          .from(members)
          .where(and(eq(members.tenantId, tenant.id), eq(members.id, settings.createdByMemberId)))
      : [];
    return {
      provisioned,
      writes,
      teamNames: teamRows.map((r) => r.name),
      provider: firstConnection?.label ?? null,
      issuer: settings?.rotatedAt ? (rotation?.actorName ?? null) : (creator?.name ?? null),
    };
  });

  const provider = facts.provider ?? t("settingsV2.people.provider");
  const providerStart = facts.provider ?? t("settingsV2.people.providerStart");
  const total = facts.provisioned.reduce((s, r) => s + r.n, 0);
  const deactivated = facts.provisioned.find((r) => r.status === "disabled")?.n ?? 0;
  // The groups a provider pushed: named by a team line, not deleted since, and still a team.
  const pushed = new Set<string>();
  for (const w of [...facts.writes].reverse()) {
    if (!w.name) continue;
    if (w.action === "team.provisioned" || w.action === "team.updated_by_provider")
      pushed.add(w.name);
    if (w.action === "team.deleted_by_provider") pushed.delete(w.name);
  }
  const groupTeams = facts.teamNames.filter((n) => pushed.has(n));
  const lastWrite = facts.writes[0];

  const status = !settings
    ? { v: t("settingsV2.scim.stat.notSet"), ink: "var(--ink-3)" }
    : settings.enabled
      ? { v: t("settingsV2.scim.stat.enabled"), ink: "var(--ok)" }
      : { v: t("settingsV2.scim.stat.disabled"), ink: "var(--ink-2)" };
  const tokenHint = settings?.tokenHint.replace(/^…/, "") ?? "";
  const issuedAt = settings ? (settings.rotatedAt ?? settings.createdAt) : null;

  return (
    <SettingsPage
      home={home}
      crumb={crumb}
      title={title}
      lead={t("settingsV2.scim.lead", { provider: providerStart })}
      actions={
        manages && settings ? (
          <ScimToggle enabled={settings.enabled} provider={provider} />
        ) : undefined
      }
      testId="settings-scim"
    >
      <Stats
        testId="scim-stats"
        items={[
          {
            label: t("settingsV2.scim.stat.status"),
            value: <span data-testid="scim-state">{status.v}</span>,
            sub: t("settingsV2.scim.stat.protocol"),
            ink: status.ink,
          },
          {
            label: t("settingsV2.scim.stat.lastCall"),
            value: settings?.lastSeenAt
              ? ago(t, settings.lastSeenAt)
              : t("settingsV2.scim.stat.never"),
            sub: lastWrite
              ? `${t(`settingsV2.scim.write.${lastWrite.action as (typeof WRITES)[number]}`)} · ${ago(t, lastWrite.createdAt)}`
              : settings?.lastSeenAt
                ? t("settingsV2.scim.stat.noChange")
                : t("settingsV2.scim.stat.waiting"),
          },
          {
            label: t("settingsV2.scim.stat.provisioned"),
            value: t("settingsV2.scim.stat.members", { count: total }),
            sub: t("settingsV2.scim.stat.deactivated", { count: deactivated }),
          },
          {
            label: t("settingsV2.scim.stat.groups"),
            value: t.fmt.number(groupTeams.length),
            sub: groupTeams.length ? groupTeams.join(", ") : t("settingsV2.scim.stat.noGroups"),
          },
        ]}
      />

      <FormCard
        title={t("settingsV2.scim.connection")}
        hint={t("settingsV2.scim.connectionHint")}
        testId="scim-connection"
      >
        <Row label={t("settingsV2.scim.baseUrl")}>
          <CopyValue value={`${origin}/scim/v2`} testId="scim-base-url" />
        </Row>
        <Row
          label={t("settingsV2.scim.token")}
          help={
            settings && issuedAt
              ? facts.issuer
                ? t("settingsV2.scim.tokenHelp", {
                    hint: tokenHint,
                    date: shortDate(t, issuedAt),
                    name: facts.issuer,
                  })
                : t("settingsV2.scim.tokenHelpAnon", {
                    hint: tokenHint,
                    date: shortDate(t, issuedAt),
                  })
              : t("settingsV2.scim.tokenNone")
          }
        >
          {manages && <TokenDialog rotate={!!settings} provider={provider} />}
        </Row>
      </FormCard>

      {settings &&
        (manages ? (
          <SettingsForm action={saveScimOptions} testId="scim-options-form">
            <OptionsCard
              defaultRole={settings.defaultRole}
              sendInvites={settings.sendInvites}
              t={t}
            />
          </SettingsForm>
        ) : (
          <OptionsCard
            defaultRole={settings.defaultRole}
            sendInvites={settings.sendInvites}
            t={t}
            readOnly
          />
        ))}
    </SettingsPage>
  );
}

function OptionsCard({
  defaultRole,
  sendInvites,
  t,
  readOnly,
}: {
  defaultRole: string;
  sendInvites: boolean;
  t: Awaited<ReturnType<typeof getT>>;
  readOnly?: boolean;
}) {
  const roleLabel = (r: string) =>
    t(`member.role.${r as "owner" | "admin" | "responder" | "viewer"}`);
  return (
    <FormCard title={t("settingsV2.scim.options")}>
      <Row label={t("settingsV2.scim.defaultRole")}>
        {readOnly ? (
          <ReadOnly>{roleLabel(defaultRole)}</ReadOnly>
        ) : (
          <select
            name="defaultRole"
            defaultValue={defaultRole}
            aria-label={t("settingsV2.scim.defaultRole")}
            className="oi-field"
            style={selectStyle}
          >
            {["responder", "viewer", "admin"].map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        )}
      </Row>
      <Row label={t("settingsV2.scim.sendInvites")}>
        <Toggle
          name="sendInvites"
          defaultChecked={sendInvites}
          label={t("settingsV2.scim.sendInvites")}
          disabled={readOnly}
          testId="scim-send-invites"
        />
      </Row>
    </FormCard>
  );
}
