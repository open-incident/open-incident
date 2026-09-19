/**
 * Everything the rule editor needs to render, loaded once.
 *
 * The editor opens in two places — inline on the rules list, where the design
 * draws it, and on its own URL, which the smoke suite and any bookmark still
 * reach — so the query block lives here rather than in either page.
 */
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
import { quickTargets } from "@/lib/alerting-setup";

export async function loadEditorData(tenantId: string, routeId: string | null) {
  return withTenant(tenantId, async (tx) => {
    const route = routeId
      ? ((
          await tx
            .select()
            .from(alertRoutes)
            .where(and(eq(alertRoutes.tenantId, tenantId), eq(alertRoutes.id, routeId)))
        )[0] ?? null)
      : null;
    if (routeId && !route) return null;
    const attributes = await tx
      .select()
      .from(alertAttributes)
      .where(eq(alertAttributes.tenantId, tenantId))
      .orderBy(alertAttributes.position);
    const sources = await tx
      .select({ id: alertSources.id, name: alertSources.name, kind: alertSources.kind })
      .from(alertSources)
      .where(and(eq(alertSources.tenantId, tenantId), eq(alertSources.managed, false)))
      .orderBy(alertSources.name);
    const paths = await tx
      .select({
        id: escalationPaths.id,
        name: escalationPaths.name,
        current: escalationPaths.currentVersionId,
      })
      .from(escalationPaths)
      .where(eq(escalationPaths.tenantId, tenantId))
      .orderBy(escalationPaths.name);
    const types = await tx
      .select({
        id: incidentTypes.id,
        name: incidentTypes.name,
        isDefault: incidentTypes.isDefault,
      })
      .from(incidentTypes)
      .where(eq(incidentTypes.tenantId, tenantId))
      .orderBy(incidentTypes.position);
    const sevs = await tx
      .select({ id: severities.id, name: severities.name })
      .from(severities)
      .where(eq(severities.tenantId, tenantId))
      .orderBy(severities.rank);
    const prios = await tx
      .select({
        id: alertPriorities.id,
        name: alertPriorities.name,
        isDefault: alertPriorities.isDefault,
      })
      .from(alertPriorities)
      .where(eq(alertPriorities.tenantId, tenantId))
      .orderBy(alertPriorities.rank);
    const fields = await tx
      .select({ key: incidentFields.key, label: incidentFields.label })
      .from(incidentFields)
      .where(eq(incidentFields.tenantId, tenantId));
    const targets = await quickTargets(tx, tenantId);
    const install = await getSlackInstall(tx, tenantId);
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
}

export type EditorData = NonNullable<Awaited<ReturnType<typeof loadEditorData>>>;
