import { redirect } from "next/navigation";
import { alerts, withTenant } from "@openincident/db";
import { and, eq } from "drizzle-orm";
import { getT } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
import { declareOptions } from "@/lib/incidents";
import { listServices } from "@/lib/services";
import { aiAllowance } from "@/lib/ai-capabilities";
import { DeclareForm } from "./declare-form";

/**
 * IN-03 — declaring an incident. The design draws it as a modal over the list,
 * and it is one there (`/app/incidents?declare=1`); this address renders the
 * same modal so that ⌘K, an alert's "create an incident" and a plain link all
 * reach it, and the browser's back button closes it.
 */
export default async function DeclarePage({
  searchParams,
}: {
  searchParams: Promise<{ alert?: string }>;
}) {
  const { tenant, member } = await requireMember();
  if (!canRespond(member)) redirect("/app/incidents");
  const t = await getT();
  const { alert: alertId } = await searchParams;
  const { options, services } = await withTenant(tenant.id, async (tx) => ({
    options: await declareOptions(tx, tenant.id),
    services: await listServices(tx, tenant.id),
  }));
  // "Create an incident" from an alert: its title, service and description prefill the form.
  const initial =
    alertId && /^[0-9a-f-]{36}$/i.test(alertId)
      ? await withTenant(tenant.id, async (tx) => {
          const [a] = await tx
            .select()
            .from(alerts)
            .where(and(eq(alerts.tenantId, tenant.id), eq(alerts.id, alertId)));
          return a
            ? {
                alertId: a.id,
                name: a.title,
                // The alert's own service, resolved at ingestion to the row
                // the workspace keeps.
                serviceId: a.attributes.service_id ?? null,
                summary: a.description,
              }
            : undefined;
        })
      : undefined;
  const types = options.types.filter(
    (ty) => !ty.restrictedToTeamIds || ty.restrictedToTeamIds.length === 0,
  );

  return (
    <DeclareForm
      types={types.map((ty) => ({
        id: ty.id,
        name: ty.name,
        isDefault: ty.isDefault,
        declareForm: ty.declareForm,
        privateByDefault: ty.privateByDefault,
      }))}
      initial={initial}
      aiSuggest={(await aiAllowance(tenant.id, "declare_suggest")).ok}
      severities={options.severities}
      services={services.map((s) => ({ id: s.id, key: s.key }))}
      fields={options.fields.map((f) => ({
        id: f.id,
        key: f.key,
        label: f.label,
        type: f.type,
        options: f.options,
        incidentTypeId: f.incidentTypeId,
      }))}
      timeZone={t.timeZone}
      closeHref="/app/incidents"
    />
  );
}
