"use server";

/**
 * Giving a service an owner — the one click that replaces a catalogue.
 *
 * From the moment it succeeds, an alert naming this service pages that team's
 * policy. Nothing else has to be configured, which is why the button sits in
 * the list rather than behind a form.
 */

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { services, teams, withTenant } from "@openincident/db";
import { recordAudit } from "@/lib/audit";
import { requireResponder } from "@/lib/session";

const uuid = z.string().uuid();

export async function assignOwner(formData: FormData) {
  const current = await requireResponder();
  const serviceId = uuid.parse(formData.get("serviceId"));
  const teamId = uuid.parse(formData.get("teamId"));
  await withTenant(current.tenant.id, async (tx) => {
    const [team] = await tx
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(and(eq(teams.tenantId, current.tenant.id), eq(teams.id, teamId)));
    if (!team) return;
    const [svc] = await tx
      .update(services)
      .set({ ownerTeamId: team.id, confirmed: true, updatedAt: new Date() })
      .where(and(eq(services.tenantId, current.tenant.id), eq(services.id, serviceId)))
      .returning({ key: services.key });
    if (svc) {
      await recordAudit(tx, current, "config", "service.owner_set", {
        service: svc.key,
        team: team.name,
      });
    }
  });
  revalidatePath("/app/services");
  revalidatePath("/app");
}

/** Undo — the service goes back to "seen in traffic", nothing else changes. */
export async function clearOwner(formData: FormData) {
  const current = await requireResponder();
  const serviceId = uuid.parse(formData.get("serviceId"));
  await withTenant(current.tenant.id, async (tx) => {
    const [svc] = await tx
      .update(services)
      .set({ ownerTeamId: null, confirmed: false, updatedAt: new Date() })
      .where(and(eq(services.tenantId, current.tenant.id), eq(services.id, serviceId)))
      .returning({ key: services.key });
    if (svc)
      await recordAudit(tx, current, "config", "service.owner_cleared", { service: svc.key });
  });
  revalidatePath("/app/services");
  revalidatePath("/app");
}

/** Adopting a service without naming an owner yet — it leaves the traffic list. */
export async function confirmService(formData: FormData) {
  const current = await requireResponder();
  const serviceId = uuid.parse(formData.get("serviceId"));
  await withTenant(current.tenant.id, (tx) =>
    tx
      .update(services)
      .set({ confirmed: true, updatedAt: new Date() })
      .where(and(eq(services.tenantId, current.tenant.id), eq(services.id, serviceId))),
  );
  revalidatePath("/app/services");
}
