/**
 * Resolving what an API client names — a type, a severity, a service — by id
 * or by name, inside the tenant transaction. The web forms pass ids; an
 * integrator writes "SEV2" and "checkout-api".
 */
import { and, eq, or } from "drizzle-orm";
import { catalogEntries, catalogTypes, incidentTypes, severities, type Tx } from "@openincident/db";
import { buildTranslate } from "@/i18n/server";
import { resolveLocale } from "@/i18n/locales";
import { workspaces } from "@openincident/db";

const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function resolveType(tx: Tx, tenantId: string, ref: string | undefined | null) {
  if (!ref) {
    const [def] = await tx
      .select()
      .from(incidentTypes)
      .where(and(eq(incidentTypes.tenantId, tenantId), eq(incidentTypes.isDefault, true)));
    return def ?? null;
  }
  const [row] = await tx
    .select()
    .from(incidentTypes)
    .where(
      and(
        eq(incidentTypes.tenantId, tenantId),
        isUuid(ref)
          ? or(eq(incidentTypes.id, ref), eq(incidentTypes.name, ref))
          : eq(incidentTypes.name, ref),
      ),
    );
  return row ?? null;
}

export async function resolveSeverity(tx: Tx, tenantId: string, ref: string | undefined | null) {
  if (!ref) return null;
  const [row] = await tx
    .select()
    .from(severities)
    .where(
      and(
        eq(severities.tenantId, tenantId),
        isUuid(ref)
          ? or(eq(severities.id, ref), eq(severities.name, ref))
          : eq(severities.name, ref),
      ),
    );
  return row ?? null;
}

export async function resolveService(tx: Tx, tenantId: string, ref: string | undefined | null) {
  if (!ref) return null;
  const [type] = await tx
    .select({ id: catalogTypes.id })
    .from(catalogTypes)
    .where(and(eq(catalogTypes.tenantId, tenantId), eq(catalogTypes.key, "service")));
  if (!type) return null;
  const [row] = await tx
    .select()
    .from(catalogEntries)
    .where(
      and(
        eq(catalogEntries.typeId, type.id),
        isUuid(ref)
          ? or(eq(catalogEntries.id, ref), eq(catalogEntries.name, ref))
          : eq(catalogEntries.name, ref),
      ),
    );
  return row ?? null;
}

/** The workspace's own words — the API has no member to read a language from. */
export async function workspaceTranslate(tx: Tx, tenantId: string) {
  const [ws] = await tx
    .select({ locale: workspaces.locale, timezone: workspaces.timezone })
    .from(workspaces)
    .where(eq(workspaces.tenantId, tenantId));
  return buildTranslate(resolveLocale(ws?.locale), ws?.timezone ?? "Europe/Paris");
}
