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

/**
 * Declaring a service before anything names it.
 *
 * The product learns services from traffic, and that is still how almost all
 * of them arrive. This is for the case the discovery cannot cover: the first
 * alert of a new service is the one that most needs to page someone, and it is
 * the one that arrives before anybody has seen the name. Declaring the key in
 * advance means that alert routes on arrival instead of after the fact.
 *
 * The key is normalised exactly as `observeService` normalises what it reads
 * from a signal — trimmed and lowercased — because the two have to meet. When
 * the signal finally arrives it updates this row rather than creating a second
 * one, and the owner set here survives it.
 */
export async function declareService(formData: FormData) {
  const current = await requireResponder();
  const parsed = z
    .object({
      // No stricter than what a signal may carry: a key this form refused but
      // an alert produced would be a service nobody could declare.
      key: z
        .string()
        .trim()
        .min(1)
        .max(120)
        // A control character in a key is not a key; refusing them is the point.
        // eslint-disable-next-line no-control-regex
        .refine((v) => !/[\u0000-\u001f]/.test(v)),
      name: z.string().trim().max(120).optional(),
      teamId: uuid.or(z.literal("")).optional(),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect("/app/services?error=key");
  const input = parsed.data;
  const key = input.key.toLowerCase();

  const outcome = await withTenant(current.tenant.id, async (tx) => {
    let ownerTeamId: string | null = null;
    if (input.teamId) {
      const [team] = await tx
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.tenantId, current.tenant.id), eq(teams.id, input.teamId)));
      if (!team) return { kind: "invalid" as const };
      ownerTeamId = team.id;
    }
    const [row] = await tx
      .insert(services)
      .values({
        tenantId: current.tenant.id,
        key,
        name: input.name || null,
        ownerTeamId,
        // Declared is adopted: it belongs to the workspace from the first
        // second, and it is not "seen in traffic" — nothing has seen it.
        confirmed: true,
        seenIn: [],
      })
      .onConflictDoNothing({ target: [services.tenantId, services.key] })
      .returning({ id: services.id });
    if (!row) {
      // The key is taken. Almost always because traffic already named it, so
      // the useful answer is the service itself rather than a complaint.
      const [existing] = await tx
        .select({ id: services.id })
        .from(services)
        .where(and(eq(services.tenantId, current.tenant.id), eq(services.key, key)));
      return { kind: "exists" as const, id: existing?.id ?? null };
    }
    await recordAudit(tx, current, "config", "service.declared", {
      service: key,
      owner: ownerTeamId,
    });
    return { kind: "created" as const, id: row.id };
  });

  if (outcome.kind === "invalid") redirect("/app/services?error=team");
  revalidatePath("/app/services");
  revalidatePath("/app");
  if (outcome.kind === "exists")
    redirect(outcome.id ? `/app/services/${outcome.id}?exists=1` : "/app/services?error=exists");
  redirect(`/app/services/${outcome.id}`);
}

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

/**
 * Removing a service — only one that was declared and never observed.
 *
 * The key cannot be edited, so a typo would otherwise sit in the list for
 * good. Anything traffic has named is refused: deleting it would achieve
 * nothing, since the next signal carrying the name creates it again. A runbook
 * attached to it is refused too rather than quietly orphaned — the foreign key
 * would set its service to null and the runbook would vanish from every screen
 * while staying in the assistant's index.
 */
export async function deleteService(formData: FormData) {
  const current = await requireManager();
  const serviceId = uuid.parse(formData.get("serviceId"));
  const outcome = await withTenant(current.tenant.id, async (tx) => {
    const [svc] = await tx
      .select({ key: services.key, lastSeenAt: services.lastSeenAt })
      .from(services)
      .where(and(eq(services.tenantId, current.tenant.id), eq(services.id, serviceId)));
    if (!svc) return "gone" as const;
    if (svc.lastSeenAt) return "seen" as const;
    const [book] = await tx
      .select({ id: runbooks.id })
      .from(runbooks)
      .where(and(eq(runbooks.tenantId, current.tenant.id), eq(runbooks.serviceId, serviceId)))
      .limit(1);
    if (book) return "has_runbook" as const;
    await tx.delete(services).where(eq(services.id, serviceId));
    await recordAudit(tx, current, "config", "service.deleted", { service: svc.key });
    return "deleted" as const;
  });
  revalidatePath("/app/services");
  revalidatePath("/app");
  if (outcome === "deleted" || outcome === "gone") redirect("/app/services");
  redirect(`/app/services/${serviceId}?error=${outcome}`);
}

/**
 * Undo — the service goes back to "seen in traffic", nothing else changes.
 *
 * There used to be a third action beside these two, "adopt without naming an
 * owner". It was removed rather than given the button it never had: adopting a
 * service nobody is paged for takes it out of the list whose whole job is to
 * say nobody is paged for it. A workspace with no team to hand it to now makes
 * one, which is what that action was quietly standing in for.
 */
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
