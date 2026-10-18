import { redirect } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  incidentFields,
  incidentStatuses,
  incidentTypes,
  incidents,
  postIncidentTaskDefs,
  severities,
  statusPages,
  teams,
  withTenant,
} from "@openincident/db";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { templateFor } from "@/lib/post-mortem";
import {
  FormCard,
  ReadOnly,
  Row,
  SettingsPage,
  fieldStyle,
  selectStyle,
} from "@/components/settings/template";
import { Toggle } from "@/components/settings/controls";
import { SettingsForm } from "@/components/settings/settings-form";
import { saveTypeRules } from "./actions";
import { Lifecycle } from "./lifecycle";
import { NewTypeDialog } from "./new-type";
import { DeclareFormDialog, DeleteTypeDialog, TemplateDialog } from "./type-dialogs";

const SYSTEM_FIELDS = ["severity", "service", "summary"] as const;

/**
 * Settings › Types & lifecycle (design V2): the type switcher and the four
 * phases of the selected type on one line — Active opens its statuses,
 * Post-incident the flow's tasks — then "Rules for <type>", one form with one
 * save bar: who may declare it, whether it starts private, from which
 * severity it enters the post-incident flow, its declaration form and name.
 *
 * What is the same for every type says so where it is shown: the status page
 * proposal (the threshold of the status page) and the post-mortem template.
 */
export default async function TypesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; seg?: string; open?: string }>;
}) {
  const params = await searchParams;
  // Severities used to be a segment of this screen; they have their own now.
  if (params.seg === "severities") redirect("/app/settings/severities");

  const { tenant, workspace, member } = await requireMember();
  const t = await getT();
  const manages = isManager(member);
  const data = await withTenant(tenant.id, async (tx) => {
    const types = await tx
      .select()
      .from(incidentTypes)
      .where(eq(incidentTypes.tenantId, tenant.id))
      .orderBy(asc(incidentTypes.position), asc(incidentTypes.createdAt));
    const counts = await tx
      .select({ typeId: incidents.typeId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(incidents)
      .where(eq(incidents.tenantId, tenant.id))
      .groupBy(incidents.typeId);
    const statuses = await tx
      .select()
      .from(incidentStatuses)
      .where(eq(incidentStatuses.tenantId, tenant.id))
      .orderBy(asc(incidentStatuses.rank));
    const inStatus = await tx
      .select({ statusId: incidents.statusId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenant.id), eq(incidents.phase, "active")))
      .groupBy(incidents.statusId);
    const sevs = await tx
      .select()
      .from(severities)
      .where(eq(severities.tenantId, tenant.id))
      .orderBy(asc(severities.rank));
    const fields = await tx
      .select()
      .from(incidentFields)
      .where(eq(incidentFields.tenantId, tenant.id))
      .orderBy(asc(incidentFields.position));
    const defs = await tx
      .select()
      .from(postIncidentTaskDefs)
      .where(eq(postIncidentTaskDefs.tenantId, tenant.id))
      .orderBy(asc(postIncidentTaskDefs.phase), asc(postIncidentTaskDefs.position));
    const teamRows = await tx
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.tenantId, tenant.id))
      .orderBy(asc(teams.name));
    // The page an incident proposes to update: the workspace's first.
    const [page] = await tx
      .select({ name: statusPages.name, minSeverityRank: statusPages.minSeverityRank })
      .from(statusPages)
      .where(eq(statusPages.tenantId, tenant.id))
      .orderBy(asc(statusPages.createdAt))
      .limit(1);
    return {
      types,
      counts: new Map(counts.map((c) => [c.typeId, c.n])),
      statuses,
      inStatus: new Map(inStatus.map((c) => [c.statusId, c.n])),
      sevs,
      fields,
      defs,
      teams: teamRows,
      page: page ?? null,
    };
  });

  const type =
    data.types.find((ty) => ty.id === params.type) ??
    data.types.find((ty) => ty.isDefault) ??
    data.types[0];
  const list = (names: string[]) =>
    new Intl.ListFormat(t.locale.tag, { type: "conjunction" }).format(names);

  const header = {
    home: t("settingsV2.home"),
    crumb: t("settingsV2.group.incidents"),
    title: t("settingsV2.entry.types"),
    lead: t("settingsV2.types.lead"),
  };
  const newType = manages ? (
    <NewTypeDialog
      types={data.types.map((ty) => ({ id: ty.id, name: ty.name, isDefault: ty.isDefault }))}
    />
  ) : null;
  if (!type) return <SettingsPage {...header} actions={newType} testId="settings-types" />;

  const statuses = data.statuses.filter((s) => s.typeId === type.id);
  const used = data.counts.get(type.id) ?? 0;

  /* "SEV2 and above", "SEV1 only", "Every severity" — a threshold in words. */
  const last = data.sevs.length - 1;
  const threshold = (rank: number): string => {
    if (rank < 0 || rank >= last) return t("settingsV2.types.post.every");
    const sev = data.sevs.find((s) => s.rank === rank) ?? data.sevs[rank];
    if (!sev) return t("settingsV2.types.post.every");
    return rank === 0 || sev === data.sevs[0]
      ? t("settingsV2.types.post.only", { severity: sev.name })
      : t("settingsV2.types.post.from", { severity: sev.name });
  };

  // The post-incident threshold: every severity, then narrower, then never.
  const fromRank = type.postIncidentFromRank;
  const rule = fromRank === null ? "never" : fromRank === -1 ? "always" : String(fromRank);
  const ranks = data.sevs
    .filter((s) => s.rank < last || s.rank === fromRank)
    .map((s) => s.rank)
    .reverse();
  // Severities that start the flow on their own, below this type's threshold.
  const startsAlone = data.sevs.filter(
    (s) =>
      (s.postIncident === "always" || s.postIncident === "yes") &&
      fromRank !== -1 &&
      (fromRank === null || s.rank > fromRank),
  );

  // The declaration form: the system fields, then the custom fields it may carry.
  const formFields = [
    ...SYSTEM_FIELDS.map((key) => ({
      key,
      name: t(`settings.types.systemField.${key}`),
      custom: false,
    })),
    ...data.fields
      .filter((f) => f.incidentTypeId === null || f.incidentTypeId === type.id)
      .map((f) => ({ key: f.key, name: f.label, custom: true })),
  ].map((f) => {
    const inForm = type.declareForm.find((x) => x.key === f.key);
    return {
      ...f,
      ask: (inForm ? (inForm.required ? "required" : "optional") : "off") as
        "required" | "optional" | "off",
    };
  });
  const required = formFields.filter((f) => f.ask === "required").length;
  const optional = formFields.filter((f) => f.ask === "optional").length;
  const formSummary =
    required + optional === 0
      ? t("settingsV2.types.formNothing")
      : [
          required ? t("settingsV2.types.formRequired", { count: required }) : null,
          optional ? t("settingsV2.types.formOptional", { count: optional }) : null,
        ]
          .filter(Boolean)
          .join(" · ");

  const sections = templateFor(workspace, t);
  const pmDefault = !workspace.postMortemTemplate || workspace.postMortemTemplate.length === 0;
  const teamId = type.isDefault ? "" : (type.restrictedToTeamIds?.[0] ?? "");
  const open =
    params.open === "post-incident"
      ? "post-incident"
      : params.open === "statuses"
        ? "statuses"
        : null;

  return (
    <SettingsPage {...header} actions={newType} testId="settings-types">
      <Lifecycle
        types={data.types.map((ty) => ({
          id: ty.id,
          name: ty.name,
          count: data.counts.get(ty.id) ?? 0,
          href: `/app/settings/types?type=${ty.id}`,
        }))}
        typeId={type.id}
        typeName={type.name}
        statuses={statuses.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          updateReminderMinutes: s.updateReminderMinutes,
          publicStatus: s.publicStatus,
          countsInMttr: s.countsInMttr,
          inIt: data.inStatus.get(s.id) ?? 0,
        }))}
        tasks={data.defs.map((d) => ({
          id: d.id,
          phase: d.phase,
          title: d.title,
          defaultAssigneeRole: d.defaultAssigneeRole,
          dueAfterDays: d.dueAfterDays,
        }))}
        canManage={manages}
        initialOpen={open}
      />

      <SettingsForm key={type.id} action={saveTypeRules} testId="type-rules">
        <input type="hidden" name="typeId" value={type.id} />
        <FormCard title={t("settingsV2.types.rulesFor", { type: type.name })}>
          <Row
            label={t("settingsV2.types.declare")}
            help={type.isDefault ? t("settingsV2.types.declareDefault") : undefined}
          >
            <select
              name="teamId"
              defaultValue={teamId}
              disabled={!manages || type.isDefault}
              aria-label={t("settingsV2.types.declare")}
              className="oi-field"
              style={selectStyle}
            >
              <option value="">{t("settingsV2.types.everyone")}</option>
              {data.teams.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {t("settingsV2.types.teamOnly", { team: tm.name })}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t("settingsV2.types.private")} help={t("settingsV2.types.privateHelp")}>
            <Toggle
              name="privateByDefault"
              defaultChecked={type.privateByDefault}
              label={t("settingsV2.types.private")}
              disabled={!manages}
              testId="type-private"
            />
          </Row>
          <Row
            label={t("settingsV2.types.post")}
            help={
              startsAlone.length
                ? t("settingsV2.types.postExcept", {
                    count: startsAlone.length,
                    names: list(startsAlone.map((s) => s.name)),
                  })
                : t("settingsV2.types.postHelp")
            }
          >
            <select
              name="rule"
              defaultValue={rule}
              disabled={!manages}
              aria-label={t("settingsV2.types.post")}
              data-testid="type-post-rule"
              className="oi-field"
              style={selectStyle}
            >
              <option value="always">{t("settingsV2.types.post.every")}</option>
              {ranks.map((r) => (
                <option key={r} value={r}>
                  {threshold(r)}
                </option>
              ))}
              <option value="never">{t("settingsV2.types.post.never")}</option>
            </select>
          </Row>
          <Row
            label={t("settingsV2.types.status")}
            help={
              data.page
                ? t("settingsV2.types.statusHelp", { page: data.page.name })
                : t("settingsV2.types.statusNoneHelp")
            }
          >
            <ReadOnly testId="type-status-proposal">
              {data.page ? threshold(data.page.minSeverityRank) : t("settingsV2.types.statusNone")}
            </ReadOnly>
          </Row>
          <Row label={t("settingsV2.types.pm")} help={t("settingsV2.types.pmHelp")}>
            <ReadOnly testId="type-pm-template">
              {pmDefault
                ? t("settingsV2.types.pmDefault", { count: sections.length })
                : t("settingsV2.types.pmCustom", { count: sections.length })}
            </ReadOnly>
            {manages && (
              <TemplateDialog
                sections={sections}
                isDefault={pmDefault}
                term={workspace.postMortemTerm ?? ""}
                placeholder={t("postMortem.title")}
              />
            )}
          </Row>
          <Row label={t("settingsV2.types.form")} help={t("settingsV2.types.formHelp")}>
            <ReadOnly testId="type-form-summary">{formSummary}</ReadOnly>
            {manages && (
              <DeclareFormDialog typeId={type.id} typeName={type.name} fields={formFields} />
            )}
          </Row>
          <Row
            label={t("settingsV2.types.name")}
            help={
              type.isDefault
                ? t("settingsV2.types.nameHelpDefault")
                : used > 0
                  ? t("settingsV2.types.nameHelpUsed", { count: used })
                  : t("settingsV2.types.nameHelpFree")
            }
          >
            <input
              name="name"
              defaultValue={type.name}
              required
              minLength={2}
              maxLength={60}
              disabled={!manages}
              aria-label={t("settingsV2.types.name")}
              data-testid="type-name"
              className="oi-field"
              style={fieldStyle()}
            />
            {manages && !type.isDefault && used === 0 && (
              <DeleteTypeDialog typeId={type.id} typeName={type.name} />
            )}
          </Row>
        </FormCard>
      </SettingsForm>
    </SettingsPage>
  );
}
