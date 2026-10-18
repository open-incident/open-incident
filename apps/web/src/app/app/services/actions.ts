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
import { and, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  atlasDocuments,
  escalationPaths,
  runbooks,
  serviceLinks,
  services,
  teams,
  withTenant,
} from "@openincident/db";
import { indexRunbook, refreshRunbook } from "@openincident/ai";
import { recordAudit } from "@/lib/audit";
import { observeService } from "@/lib/services";
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
    // The names merged into it page the same team: routing reads the owner off
    // whichever name the alert carries.
    await tx
      .update(services)
      .set({ ownerTeamId: team.id, updatedAt: new Date() })
      .where(and(eq(services.tenantId, current.tenant.id), eq(services.mergedIntoId, serviceId)));
    if (svc) {
      await recordAudit(tx, current, "config", "service.owner_set", {
        service: svc.key,
        team: team.name,
      });
    }
  });
  revalidatePath("/app/services");
  revalidatePath(`/app/services/${serviceId}`);
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
    // A name merged into it becomes a service of its own again.
    await tx
      .update(services)
      .set({ mergedIntoId: null, updatedAt: new Date() })
      .where(and(eq(services.tenantId, current.tenant.id), eq(services.mergedIntoId, serviceId)));
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
    await tx
      .update(services)
      .set({ ownerTeamId: null, updatedAt: new Date() })
      .where(and(eq(services.tenantId, current.tenant.id), eq(services.mergedIntoId, serviceId)));
    if (svc)
      await recordAudit(tx, current, "config", "service.owner_cleared", { service: svc.key });
  });
  revalidatePath("/app/services");
  revalidatePath(`/app/services/${serviceId}`);
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

/* ---------- Labels ---------- */

const labelKey = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_./-]{0,39}$/);
// A control character in a label is not a label.
const labelValue = z
  .string()
  .trim()
  .min(1)
  .max(120)
  // eslint-disable-next-line no-control-regex
  .refine((v) => !/[\u0000-\u001f]/.test(v));

/**
 * A label on the service, written `key:value` the way the list shows it. A key
 * that already exists takes the new value: a service has one tier, not two.
 */
export async function setLabel(formData: FormData): Promise<{ ok: boolean }> {
  const current = await requireResponder();
  const serviceId = uuid.parse(formData.get("serviceId"));
  const raw = String(formData.get("label") ?? "");
  const at = raw.indexOf(":");
  const key = labelKey.safeParse(at > 0 ? raw.slice(0, at) : "");
  const value = labelValue.safeParse(at > 0 ? raw.slice(at + 1) : "");
  if (!key.success || !value.success) return { ok: false };
  await withTenant(current.tenant.id, async (tx) => {
    const [svc] = await tx
      .update(services)
      .set({
        labels: sql`${services.labels} || jsonb_build_object(${key.data}::text, ${value.data}::text)`,
        updatedAt: new Date(),
      })
      .where(and(eq(services.tenantId, current.tenant.id), eq(services.id, serviceId)))
      .returning({ key: services.key });
    if (svc)
      await recordAudit(tx, current, "config", "service.label_set", {
        service: svc.key,
        label: `${key.data}:${value.data}`,
      });
  });
  revalidatePath(`/app/services/${serviceId}`);
  revalidatePath("/app/services");
  return { ok: true };
}

export async function removeLabel(formData: FormData) {
  const current = await requireResponder();
  const serviceId = uuid.parse(formData.get("serviceId"));
  const key = labelKey.parse(formData.get("key"));
  await withTenant(current.tenant.id, async (tx) => {
    const [svc] = await tx
      .update(services)
      .set({ labels: sql`${services.labels} - ${key}::text`, updatedAt: new Date() })
      .where(and(eq(services.tenantId, current.tenant.id), eq(services.id, serviceId)))
      .returning({ key: services.key });
    if (svc)
      await recordAudit(tx, current, "config", "service.label_removed", {
        service: svc.key,
        label: key,
      });
  });
  revalidatePath(`/app/services/${serviceId}`);
  revalidatePath("/app/services");
}

/* ---------- Merging two names of one service ---------- */

/** Every table that points at a service, moved over when two names become one. */
const SERVICE_REFERENCES = [
  "incidents",
  "monitors",
  "change_events",
  "heartbeats",
  "runbooks",
  "status_page_components",
  "slos",
  "rum_applications",
  "atlas_actions",
] as const;

/**
 * `storefront` in the traces and `web-storefront` in the alerts are one thing.
 *
 * The folded name keeps its row, marked as merged, so the next signal carrying
 * it is still recognised and counts for the kept service — deleting it would
 * only have it recreated by that signal. Everything that pointed at it moves:
 * incidents, monitors, runbooks, status page components, changes. It is paged
 * through the kept service's owner from now on.
 */
export async function mergeServices(formData: FormData) {
  const current = await requireManager();
  const keepId = uuid.parse(formData.get("keepId"));
  const foldId = uuid.parse(formData.get("foldId"));
  if (keepId === foldId) redirect(`/app/services/${keepId}`);
  const tenantId = current.tenant.id;
  const done = await withTenant(tenantId, async (tx) => {
    const both = await tx
      .select()
      .from(services)
      .where(
        and(eq(services.tenantId, tenantId), or(eq(services.id, keepId), eq(services.id, foldId))),
      );
    const keep = both.find((s) => s.id === keepId);
    const fold = both.find((s) => s.id === foldId);
    if (!keep || !fold || keep.mergedIntoId || fold.mergedIntoId) return false;

    for (const table of SERVICE_REFERENCES) {
      await tx.execute(
        sql`update ${sql.raw(`app.${table}`)} set service_id = ${keepId}
             where tenant_id = ${tenantId} and service_id = ${foldId}`,
      );
    }
    // Links: re-pointed, except those that would duplicate one the kept
    // service already has or would make it depend on itself.
    await tx.execute(sql`
      delete from app.service_links l
       where l.tenant_id = ${tenantId}
         and (l.from_service_id = ${foldId} or l.to_service_id = ${foldId})
         and (
           (case when l.from_service_id = ${foldId} then ${keepId}::uuid else l.from_service_id end)
             = (case when l.to_service_id = ${foldId} then ${keepId}::uuid else l.to_service_id end)
           or exists (
             select 1 from app.service_links k
              where k.tenant_id = ${tenantId}
                and k.from_service_id = (case when l.from_service_id = ${foldId} then ${keepId}::uuid else l.from_service_id end)
                and k.to_service_id = (case when l.to_service_id = ${foldId} then ${keepId}::uuid else l.to_service_id end)
           )
         )`);
    await tx
      .update(serviceLinks)
      .set({ fromServiceId: keepId, updatedAt: new Date() })
      .where(and(eq(serviceLinks.tenantId, tenantId), eq(serviceLinks.fromServiceId, foldId)));
    await tx
      .update(serviceLinks)
      .set({ toServiceId: keepId, updatedAt: new Date() })
      .where(and(eq(serviceLinks.tenantId, tenantId), eq(serviceLinks.toServiceId, foldId)));

    const owner = keep.ownerTeamId ?? fold.ownerTeamId;
    const latest = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a > b ? a : b);
    await tx
      .update(services)
      .set({
        ownerTeamId: owner,
        confirmed: keep.confirmed || fold.confirmed || owner !== null,
        // The kept service's own labels win a disagreement.
        labels: { ...fold.labels, ...keep.labels },
        seenIn: [...new Set([...keep.seenIn, ...fold.seenIn])].slice(0, 12),
        lastSeenAt: latest(keep.lastSeenAt, fold.lastSeenAt),
        telemetryLastSeenAt: latest(keep.telemetryLastSeenAt, fold.telemetryLastSeenAt),
        telemetryFirstSeenAt:
          keep.telemetryFirstSeenAt && fold.telemetryFirstSeenAt
            ? keep.telemetryFirstSeenAt < fold.telemetryFirstSeenAt
              ? keep.telemetryFirstSeenAt
              : fold.telemetryFirstSeenAt
            : (keep.telemetryFirstSeenAt ?? fold.telemetryFirstSeenAt),
        updatedAt: new Date(),
      })
      .where(eq(services.id, keepId));
    // The folded name, and any name that had been merged into it.
    await tx
      .update(services)
      .set({ mergedIntoId: keepId, ownerTeamId: owner, confirmed: true, updatedAt: new Date() })
      .where(
        and(
          eq(services.tenantId, tenantId),
          or(eq(services.id, foldId), eq(services.mergedIntoId, foldId)),
        ),
      );
    await recordAudit(tx, current, "config", "service.merged", {
      service: keep.key,
      merged: fold.key,
    });
    return true;
  });
  revalidatePath("/app/services");
  revalidatePath("/app");
  redirect(done ? `/app/services/${keepId}` : `/app/services/${keepId}?error=merge`);
}

/* ---------- Dependencies ---------- */

/**
 * What a person says about a call between two services: it is real and
 * belongs on the map (`declared`), it is noise to hide (`hidden`), or the
 * decision is taken back (`clear`). The other side may be a name only the
 * traces know: it becomes a service the moment someone settles a call to it,
 * exactly as it would have the day its first alert arrived.
 */
export async function setDependency(formData: FormData) {
  const current = await requireResponder();
  const parsed = z
    .object({
      serviceId: uuid,
      otherId: uuid.or(z.literal("")).optional(),
      otherKey: z.string().trim().max(120).optional(),
      direction: z.enum(["upstream", "downstream"]),
      state: z.enum(["declared", "hidden", "clear"]),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const input = parsed.data;
  const tenantId = current.tenant.id;
  await withTenant(tenantId, async (tx) => {
    const [self] = await tx
      .select({ id: services.id, key: services.key })
      .from(services)
      .where(and(eq(services.tenantId, tenantId), eq(services.id, input.serviceId)));
    if (!self) return;
    let otherId = input.otherId || null;
    if (otherId) {
      const [other] = await tx
        .select({ id: services.id, mergedIntoId: services.mergedIntoId })
        .from(services)
        .where(and(eq(services.tenantId, tenantId), eq(services.id, otherId)));
      otherId = other ? (other.mergedIntoId ?? other.id) : null;
    } else if (input.otherKey) {
      otherId = await observeService(tx, tenantId, input.otherKey, "telemetry");
    }
    if (!otherId || otherId === self.id) return;
    const fromServiceId = input.direction === "downstream" ? self.id : otherId;
    const toServiceId = input.direction === "downstream" ? otherId : self.id;
    if (input.state === "clear") {
      await tx
        .delete(serviceLinks)
        .where(
          and(
            eq(serviceLinks.tenantId, tenantId),
            eq(serviceLinks.fromServiceId, fromServiceId),
            eq(serviceLinks.toServiceId, toServiceId),
          ),
        );
    } else {
      await tx
        .insert(serviceLinks)
        .values({
          tenantId,
          fromServiceId,
          toServiceId,
          state: input.state,
          createdByMemberId: current.member.id,
        })
        .onConflictDoUpdate({
          target: [serviceLinks.tenantId, serviceLinks.fromServiceId, serviceLinks.toServiceId],
          set: { state: input.state, updatedAt: new Date() },
        });
    }
    await recordAudit(tx, current, "config", `service.dependency_${input.state}`, {
      service: self.key,
      direction: input.direction,
      other: otherId,
    });
  });
  revalidatePath(`/app/services/${input.serviceId}`);
}
