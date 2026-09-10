import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import {
  alertAttributes,
  alertPriorities,
  alertRoutes,
  alertSources,
  escalationPaths,
  incidentFields,
  incidentTypes,
  severities,
  withTenant,
} from "@openincident/db";
import { getSlackInstall, slack } from "@openincident/chat";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { quickTargets } from "@/lib/alerting-setup";
import { RouteEditor } from "./route-editor";

/** The editor of one route — or of a new one when the id is "new". */
export default async function RoutePage({ params }: { params: Promise<{ id: string }> }) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { id } = await params;
  const data = await withTenant(tenant.id, async (tx) => {
    const route =
      id === "new"
        ? null
        : ((
            await tx
              .select()
              .from(alertRoutes)
              .where(and(eq(alertRoutes.tenantId, tenant.id), eq(alertRoutes.id, id)))
          )[0] ?? null);
    if (id !== "new" && !route) return null;
    const attributes = await tx
      .select()
      .from(alertAttributes)
      .where(eq(alertAttributes.tenantId, tenant.id))
      .orderBy(alertAttributes.position);
    const sources = await tx
      .select({ id: alertSources.id, name: alertSources.name, kind: alertSources.kind })
      .from(alertSources)
      .where(and(eq(alertSources.tenantId, tenant.id), eq(alertSources.managed, false)))
      .orderBy(alertSources.name);
    const paths = await tx
      .select({
        id: escalationPaths.id,
        name: escalationPaths.name,
        current: escalationPaths.currentVersionId,
      })
      .from(escalationPaths)
      .where(eq(escalationPaths.tenantId, tenant.id))
      .orderBy(escalationPaths.name);
    const types = await tx
      .select({
        id: incidentTypes.id,
        name: incidentTypes.name,
        isDefault: incidentTypes.isDefault,
      })
      .from(incidentTypes)
      .where(eq(incidentTypes.tenantId, tenant.id))
      .orderBy(incidentTypes.position);
    const sevs = await tx
      .select({ id: severities.id, name: severities.name })
      .from(severities)
      .where(eq(severities.tenantId, tenant.id))
      .orderBy(severities.rank);
    const prios = await tx
      .select({
        id: alertPriorities.id,
        name: alertPriorities.name,
        isDefault: alertPriorities.isDefault,
      })
      .from(alertPriorities)
      .where(eq(alertPriorities.tenantId, tenant.id))
      .orderBy(alertPriorities.rank);
    const fields = await tx
      .select({ key: incidentFields.key, label: incidentFields.label })
      .from(incidentFields)
      .where(eq(incidentFields.tenantId, tenant.id));
    const targets = await quickTargets(tx, tenant.id);
    const install = await getSlackInstall(tx, tenant.id);
    let channels: Array<{ id: string; name: string }> = [];
    if (install) {
      try {
        channels = (await slack(install.token).listChannels()).map((c) => ({
          id: c.id,
          name: c.name,
        }));
      } catch {
        channels = [];
      }
    }
    return {
      route,
      attributes,
      sources,
      paths,
      types,
      sevs,
      prios,
      fields,
      targets,
      slack: Boolean(install),
      channels,
    };
  });
  if (!data) notFound();
  if (!isManager(member))
    return (
      <div className="oi-rise" style={{ maxWidth: 760 }}>
        <p style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("setup.managersOnly")}</p>
      </div>
    );
  return (
    <div
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1040 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Link href="/app/settings/alert-routes" className="oi-link" style={{ fontSize: 12.5 }}>
          ← {t("settings.routes.title")}
        </Link>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {data.route ? data.route.name : t("settings.routes.newTitle")}
        </h1>
      </div>
      <RouteEditor
        route={data.route}
        attributes={data.attributes.map((a) => ({
          key: a.key,
          label: a.label,
          type: a.type,
          catalogTypeKey: a.catalogTypeKey,
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
    </div>
  );
}
