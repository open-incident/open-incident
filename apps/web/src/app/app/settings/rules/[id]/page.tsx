import { notFound } from "next/navigation";
import { alertAttributeTypeOf, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { Note, SettingsPage } from "@/components/settings/template";
import { orderedRoutes } from "../data";
import { DeleteRule } from "../delete-rule";
import { loadEditorData } from "../editor-data";
import { isRule } from "../model";
import { RouteEditor } from "../route-editor";

/**
 * One rule on its own page, with the full editor — what "More options…" in
 * the rules dialog opens: grouping, a Slack channel, a wait before the first
 * page, test mode, conditions the dialog cannot hold. `new` starts a rule
 * from nothing. The shared fallback every source starts from is edited here
 * too, under its own title: it is not a rule.
 */
export default async function RulePage({ params }: { params: Promise<{ id: string }> }) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { id } = await params;
  if (id !== "new" && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await loadEditorData(tenant.id, id === "new" ? null : id);
  if (!data) notFound();
  const route = data.route;
  const order = route
    ? (await withTenant(tenant.id, (tx) => orderedRoutes(tx, tenant.id))).filter(isRule)
    : [];
  const index = route ? order.findIndex((r) => r.id === route.id) + 1 : 0;
  const fallback = Boolean(route) && index === 0;
  const title = !route
    ? t("settingsV2.rules.newTitle")
    : fallback
      ? t("settingsV2.rules.defaultsTitle")
      : t("settingsV2.rules.ruleTitle", { n: index });
  const manages = isManager(member);

  return (
    <SettingsPage
      home={t("settingsV2.home")}
      crumb={t("settingsV2.group.alerts")}
      title={title}
      lead={fallback ? t("settingsV2.rules.defaultsLead") : t("settingsV2.rules.fullLead")}
      testId="settings-rule"
      actions={manages && route && !fallback ? <DeleteRule id={route.id} n={index} /> : undefined}
    >
      {!manages ? (
        <Note>{t("settingsV2.rules.managersOnly")}</Note>
      ) : (
        <RouteEditor
          route={route}
          index={index || undefined}
          cancelHref="/app/settings/rules"
          attributes={data.attributes.map((a) => ({
            key: a.key,
            label: a.label,
            type: alertAttributeTypeOf(a),
          }))}
          sources={data.sources}
          paths={data.paths.map((p) => ({ id: p.id, name: p.name, published: Boolean(p.current) }))}
          types={data.types}
          severities={data.sevs}
          priorities={data.prios}
          fields={data.fields}
          people={data.targets.people.filter((p) => p.id !== member.id)}
          schedules={data.targets.schedules}
          slackInstalled={data.slack}
          channels={data.channels}
        />
      )}
    </SettingsPage>
  );
}
