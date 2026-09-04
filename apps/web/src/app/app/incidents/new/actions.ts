"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { alertEvents, alerts, incidentEvents, incidentTypes, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireMember, requireResponder } from "@/lib/session";
import { similarOpenIncidents } from "@/lib/incidents";
import {
  afterIncidentChange,
  coerceCustomFields,
  declareIncidentCore,
} from "@/lib/incident-writes";

const schema = z.object({
  name: z.string().trim().min(3).max(200),
  mode: z.enum(["live", "retrospective", "test"]).default("live"),
  typeId: z.string().uuid(),
  severityId: z.string().uuid().optional().or(z.literal("")),
  serviceEntryId: z.string().uuid().optional().or(z.literal("")),
  summary: z.string().trim().max(4000).optional(),
  declaredAt: z.string().optional(),
});

/** The live anti-duplicate hint: open incidents whose title resembles the one being typed. */
export async function findSimilar(
  title: string,
): Promise<Array<{ number: number; name: string; declaredAt: string }>> {
  const current = await requireMember();
  const rows = await withTenant(current.tenant.id, (tx) =>
    similarOpenIncidents(tx, current.tenant.id, title),
  );
  return rows.map((r) => ({
    number: r.number,
    name: r.name,
    declaredAt: r.declaredAt.toISOString(),
  }));
}

/**
 * Declares an incident from the web form — the same write path as
 * `POST /api/v1/incidents` (lib/incident-writes.ts): the row, the first status
 * of the type, the declarer as lead, the type's custom fields, the events.
 */
export async function declareIncident(formData: FormData): Promise<{ error: string } | void> {
  const current = await requireResponder();
  const t = await getT();
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: t("incidents.declare.invalid") };
  const input = parsed.data;
  const tenantId = current.tenant.id;

  const created = await withTenant(tenantId, async (tx) => {
    const [type] = await tx
      .select()
      .from(incidentTypes)
      .where(and(eq(incidentTypes.tenantId, tenantId), eq(incidentTypes.id, input.typeId)));
    if (!type) throw new Error("unknown type");
    const raw: Record<string, unknown> = {};
    for (const [k, v] of formData.entries()) if (k.startsWith("field.")) raw[k.slice(6)] = v;
    return declareIncidentCore(
      tx,
      tenantId,
      { kind: "member", memberId: current.member.id, name: current.member.name },
      {
        name: input.name,
        summary: input.summary,
        mode: input.mode,
        typeId: type.id,
        severityId: input.severityId || null,
        serviceEntryId: input.serviceEntryId || null,
        customFields: await coerceCustomFields(tx, tenantId, raw),
        declaredAt:
          input.mode === "retrospective" && input.declaredAt
            ? new Date(input.declaredAt)
            : undefined,
        source: "web",
      },
    );
  });
  // Declared from an alert: the alert is attached, both timelines say so.
  const alertId = String(formData.get("alertId") ?? "");
  if (/^[0-9a-f-]{36}$/i.test(alertId)) {
    await withTenant(tenantId, async (tx) => {
      const [a] = await tx
        .select()
        .from(alerts)
        .where(and(eq(alerts.tenantId, tenantId), eq(alerts.id, alertId)));
      if (!a) return;
      const now = new Date();
      await tx.update(alerts).set({ incidentId: created.id }).where(eq(alerts.id, a.id));
      await tx.update(alerts).set({ incidentId: created.id }).where(eq(alerts.groupId, a.id));
      await tx.insert(alertEvents).values({
        tenantId,
        alertId: a.id,
        kind: "incident_linked",
        actorKind: "member",
        actorMemberId: current.member.id,
        actorName: current.member.name,
        payload: { number: created.number },
        occurredAt: now,
      });
      await tx.insert(incidentEvents).values({
        tenantId,
        incidentId: created.id,
        kind: "alert_attached",
        actorKind: "member",
        actorMemberId: current.member.id,
        actorName: current.member.name,
        payload: {
          source: a.attributes.source_name ?? a.attributes.source ?? "alert",
          title: a.title,
          alertId: a.id,
        },
        occurredAt: now,
      });
    });
  }
  await afterIncidentChange(tenantId, created.id, ["incident.created"]);

  revalidatePath("/app/incidents");
  redirect(`/app/incidents/${created.number}`);
}
