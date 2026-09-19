"use server";

/**
 * Giving a service an owner — the one click that is the whole configuration.
 *
 * From the moment it succeeds, an alert naming this service pages that team's
 * policy. Nothing else has to be configured, which is why the button sits in
 * the list rather than behind a form.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  atlasDocuments,
  escalationPaths,
  runbooks,
  services,
  teams,
  withTenant,
} from "@openincident/db";
import { indexRunbook, refreshRunbook } from "@openincident/ai";
import { recordAudit } from "@/lib/audit";
import { requireManager, requireResponder } from "@/lib/session";

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

/**
 * Giving the owner team the policy it is paged through.
 *
 * The chain is service → team → policy, and until this action existed the
 * middle link could be written from nowhere in the product: a service could be
 * given an owner, and that owner could still not be reached. The control sits
 * here, next to the assignment, because that is where the reader learns the
 * link is missing.
 */
export async function setTeamPolicy(formData: FormData) {
  const current = await requireResponder();
  const serviceId = uuid.parse(formData.get("serviceId"));
  const teamId = uuid.parse(formData.get("teamId"));
  const pathId = uuid.parse(formData.get("pathId"));
  await withTenant(current.tenant.id, async (tx) => {
    const [path] = await tx
      .select({ id: escalationPaths.id, name: escalationPaths.name })
      .from(escalationPaths)
      .where(and(eq(escalationPaths.tenantId, current.tenant.id), eq(escalationPaths.id, pathId)));
    if (!path) return;
    const [team] = await tx
      .update(teams)
      .set({ policyPathId: path.id, updatedAt: new Date() })
      .where(and(eq(teams.tenantId, current.tenant.id), eq(teams.id, teamId)))
      .returning({ name: teams.name });
    if (team) {
      await recordAudit(tx, current, "config", "team.policy_set", {
        team: team.name,
        policy: path.name,
      });
    }
  });
  revalidatePath(`/app/services/${serviceId}`);
  revalidatePath("/app/services");
  revalidatePath("/app/on-call");
}

/* ---------- Runbooks ---------- */

const runbookSchema = z.object({
  serviceId: z.string().uuid(),
  title: z.string().trim().min(2).max(160),
  sourceUrl: z.string().trim().url().max(500).or(z.literal("")),
  content: z.string().max(60_000).default(""),
});

/** A runbook for a service: a file at a URL (fetched now, refreshed by the worker) or pasted text. */
export async function createRunbook(formData: FormData) {
  const current = await requireManager();
  const parsed = runbookSchema.safeParse(Object.fromEntries(formData.entries()));
  const back = (suffix: string) =>
    redirect(`/app/services/${String(formData.get("serviceId") ?? "")}${suffix}`);
  if (!parsed.success) return back("?error=runbook");
  const input = parsed.data;
  if (!input.sourceUrl && !input.content.trim()) return back("?error=runbook");
  const id = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .insert(runbooks)
      .values({
        tenantId: current.tenant.id,
        serviceId: input.serviceId,
        title: input.title,
        sourceUrl: input.sourceUrl || null,
        content: input.sourceUrl ? "" : input.content.trim(),
        createdByMemberId: current.member.id,
      })
      .returning({ id: runbooks.id });
    await recordAudit(tx, current, "config", "runbook.created", {
      title: input.title,
      url: input.sourceUrl || null,
    });
    return row!.id;
  });
  if (input.sourceUrl) await refreshRunbook(current.tenant.id, id);
  else await indexRunbook(current.tenant.id, id);
  revalidatePath(`/app/services/${input.serviceId}`);
  redirect(`/app/services/${input.serviceId}`);
}

export async function deleteRunbook(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  const serviceId = String(formData.get("serviceId") ?? "");
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .delete(runbooks)
      .where(and(eq(runbooks.tenantId, current.tenant.id), eq(runbooks.id, id)))
      .returning({ title: runbooks.title });
    await tx
      .delete(atlasDocuments)
      .where(
        and(
          eq(atlasDocuments.tenantId, current.tenant.id),
          eq(atlasDocuments.source, "runbook"),
          eq(atlasDocuments.refId, id),
        ),
      );
    if (row) await recordAudit(tx, current, "config", "runbook.deleted", { title: row.title });
  });
  revalidatePath(`/app/services/${serviceId}`);
  redirect(`/app/services/${serviceId}`);
}

export async function refreshRunbookAction(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  const serviceId = String(formData.get("serviceId") ?? "");
  await refreshRunbook(current.tenant.id, id);
  revalidatePath(`/app/services/${serviceId}`);
  redirect(`/app/services/${serviceId}`);
}
