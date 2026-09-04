import { redirect } from "next/navigation";
import { alerts, withTenant } from "@openincident/db";
import { and, eq } from "drizzle-orm";
import { getT } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
import { declareOptions } from "@/lib/incidents";
import { DeclareForm } from "./declare-form";
import { aiAllowance } from "@/lib/ai-capabilities";

/**
 * IN-03 — Declaring an incident. The design draws it as a modal over the list;
 * it is a page here (`/app/incidents/new`) so that ⌘K, the top bar and a plain
 * link all reach it — and so the browser's back button closes it. It renders
 * the modal frame over the canvas.
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
  const options = await withTenant(tenant.id, (tx) => declareOptions(tx, tenant.id));
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
                serviceEntryId: a.attributes.service_id ?? null,
                summary: a.description,
              }
            : undefined;
        })
      : undefined;
  const types = options.types.filter(
    (ty) => !ty.restrictedToTeamIds || ty.restrictedToTeamIds.length === 0,
  );

  return (
    <section
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "8vh",
        background: "rgba(8,12,14,.45)",
      }}
    >
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
        services={options.services.map((s) => ({ id: s.id, name: s.name }))}
        fields={options.fields.map((f) => ({
          id: f.id,
          key: f.key,
          label: f.label,
          type: f.type,
          options: f.options,
          incidentTypeId: f.incidentTypeId,
        }))}
        timeZone={t.timeZone}
      />
    </section>
  );
}
