import { and, asc, eq, inArray } from "drizzle-orm";
import {
  announcementRules,
  announcementTemplates,
  incidentTypes,
  integrationInstalls,
  severities,
  withTenant,
} from "@openincident/db";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { TEMPLATE_VARIABLES } from "@/lib/announcements";
import { ListCard, ListItem, SettingsPage } from "@/components/settings/template";
import { NewRuleButton, RuleRow, TemplateDialog } from "./dialogs";
import { ruleSentence, severityPhrase } from "./sentence";

type ChatConfig = { announceChannelId?: string | null; announceChannelName?: string | null };

/**
 * Settings › Announcements (design V2): the rules, as sentences — "When an
 * incident is declared at SEV1 or SEV2 → Post in Slack #incidents and Teams ›
 * Incidents · template “Declared”" — then the templates with their message.
 *
 * Every matching rule posts its own living post (lib/announcements.ts): it is
 * written when an incident becomes active and matches, edited in place at
 * every change, closed at resolution, and mirrored in the announcement
 * channel chosen in Slack & Teams — the same for every rule. Where a rule
 * posts is read from those installs, never assumed.
 */
export default async function AnnouncementsPage() {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const manages = isManager(member);
  const data = await withTenant(tenant.id, async (tx) => ({
    templates: await tx
      .select()
      .from(announcementTemplates)
      .where(eq(announcementTemplates.tenantId, tenant.id))
      .orderBy(asc(announcementTemplates.position), asc(announcementTemplates.createdAt)),
    rules: await tx
      .select()
      .from(announcementRules)
      .where(eq(announcementRules.tenantId, tenant.id))
      .orderBy(asc(announcementRules.createdAt)),
    sevs: await tx
      .select({ rank: severities.rank, name: severities.name })
      .from(severities)
      .where(eq(severities.tenantId, tenant.id))
      .orderBy(asc(severities.rank)),
    types: await tx
      .select({ id: incidentTypes.id, name: incidentTypes.name })
      .from(incidentTypes)
      .where(eq(incidentTypes.tenantId, tenant.id))
      .orderBy(asc(incidentTypes.position), asc(incidentTypes.createdAt)),
    installs: await tx
      .select({
        kind: integrationInstalls.kind,
        externalId: integrationInstalls.externalId,
        config: integrationInstalls.config,
      })
      .from(integrationInstalls)
      .where(
        and(
          eq(integrationInstalls.tenantId, tenant.id),
          eq(integrationInstalls.status, "active"),
          inArray(integrationInstalls.kind, ["slack", "teams"]),
        ),
      ),
  }));

  // Where every rule posts: the announcement channel of each connected tool.
  const channel = (kind: "slack" | "teams") => {
    const row = data.installs.find((i) => i.kind === kind && i.externalId);
    const config = (row?.config ?? {}) as ChatConfig;
    if (!config.announceChannelId) return null;
    if (kind === "slack")
      return config.announceChannelName
        ? `#${config.announceChannelName}`
        : config.announceChannelId;
    return config.announceChannelName ?? config.announceChannelId;
  };
  const slack = channel("slack");
  const teams = channel("teams");
  const parts = [
    slack ? t("settingsV2.ann.slack", { channel: slack }) : null,
    teams ? t("settingsV2.ann.teams", { channel: teams }) : null,
  ].filter((x): x is string => Boolean(x));
  const where =
    parts.length === 2
      ? t("settingsV2.ann.and", { a: parts[0]!, b: parts[1]! })
      : (parts[0] ?? null);

  const vars = TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(", ");
  const choices = {
    types: data.types,
    severities: data.sevs
      .slice(0, -1)
      .map((s) => ({ rank: s.rank, label: severityPhrase(t, data.sevs, s.rank) ?? s.name })),
    templates: data.templates.map((x) => ({ id: x.id, name: x.name })),
    where,
  };

  return (
    <SettingsPage
      home={t("settingsV2.home")}
      crumb={t("settingsV2.group.incidents")}
      title={t("settingsV2.entry.announcements")}
      lead={t("settingsV2.ann.lead")}
      actions={
        manages ? (
          <>
            <TemplateDialog vars={vars} />
            <NewRuleButton {...choices} />
          </>
        ) : null
      }
      testId="settings-announcements"
    >
      <ListCard
        title={t("settingsV2.ann.rules")}
        hint={t("settingsV2.ann.rulesHint")}
        testId="ann-rules"
      >
        {data.rules.map((r, i) => {
          const template = data.templates.find((x) => x.id === r.templateId)?.name ?? "—";
          const sentence = ruleSentence(t, data.sevs, {
            minSeverityRank: r.minSeverityRank,
            typeName: r.typeId ? (data.types.find((x) => x.id === r.typeId)?.name ?? null) : null,
          });
          return (
            <RuleRow
              key={r.id}
              {...choices}
              canManage={manages}
              rule={{
                id: r.id,
                n: i + 1,
                sentence,
                sub: where
                  ? t("settingsV2.ann.postIn", { where, template })
                  : t("settingsV2.ann.nowhere", { template }),
                active: r.active,
                typeId: r.typeId,
                minSeverityRank: r.minSeverityRank,
                templateId: r.templateId,
              }}
            />
          );
        })}
        {data.rules.length === 0 && <Empty>{t("settingsV2.ann.noRules")}</Empty>}
      </ListCard>

      <ListCard title={t("settingsV2.ann.templates")} testId="ann-templates">
        {data.templates.map((tpl) => {
          const usedBy = data.rules.filter((r) => r.templateId === tpl.id).length;
          return (
            <ListItem
              key={tpl.id}
              testId="template-row"
              data={{ template: tpl.name }}
              title={tpl.name}
              sub={tpl.body}
              button={
                manages ? (
                  <TemplateDialog
                    vars={vars}
                    usedBy={usedBy}
                    template={{ id: tpl.id, name: tpl.name, body: tpl.body }}
                  />
                ) : undefined
              }
            />
          );
        })}
        {data.templates.length === 0 && <Empty>{t("settingsV2.ann.noTemplates")}</Empty>}
      </ListCard>
    </SettingsPage>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "11px 18px",
        borderTop: "1px solid var(--line-2)",
        fontSize: 12.5,
        color: "var(--ink-3)",
      }}
    >
      {children}
    </div>
  );
}
