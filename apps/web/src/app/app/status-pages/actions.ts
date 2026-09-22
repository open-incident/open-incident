"use server";

import { promises as dns } from "node:dns";
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  componentImpactHistory,
  deleteStatusSnapshot,
  monitors,
  statusPageComponents,
  statusPageIncidentUpdates,
  statusPageIncidents,
  statusPageMaintenanceUpdates,
  statusPageMaintenances,
  statusPageSubscribers,
  statusPageTemplates,
  statusPages,
  withTenant,
} from "@openincident/db";
import { refreshStatusSnapshot, setComponentState } from "@openincident/statuspages";
import { recordAudit } from "@/lib/audit";
import { requireManager, requireMember, requireResponder } from "@/lib/session";

const PAGE = "/app/status-pages";
const uuid = z.string().uuid();
const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/);

export async function createStatusPage(formData: FormData) {
  const current = await requireManager();
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(80),
      slug: slugSchema,
      locale: z.enum(["en", "fr", "de"]),
      accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect(`${PAGE}?error=invalid`);
  const input = parsed.data;
  const id = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .insert(statusPages)
      .values({
        tenantId: current.tenant.id,
        name: input.name,
        slug: input.slug,
        locale: input.locale,
        accentColor: input.accentColor,
        createdByMemberId: current.member.id,
      })
      .returning({ id: statusPages.id });
    for (const [i, tpl] of (
      [
        [
          "Investigating — SEV1/SEV2",
          "investigating",
          "We are investigating an issue affecting some customers and will share an update within 30 minutes.",
        ],
        [
          "Monitoring",
          "monitoring",
          "A fix has been deployed. Response times are back within normal thresholds; we are monitoring.",
        ],
        [
          "Resolved",
          "resolved",
          "The issue is resolved and the service has been stable. Thank you for your patience.",
        ],
      ] as const
    ).entries()) {
      await tx.insert(statusPageTemplates).values({
        tenantId: current.tenant.id,
        pageId: row!.id,
        name: tpl[0],
        status: tpl[1],
        body: tpl[2],
        position: i,
      });
    }
    await recordAudit(tx, current, "config", "status_page.created", {
      name: input.name,
      slug: input.slug,
    });
    return row!.id;
  }).catch(() => null);
  if (!id) redirect(`${PAGE}?error=slug`);
  await refreshStatusSnapshot(current.tenant.id, id);
  revalidatePath(PAGE);
  redirect(`${PAGE}?page=${id}&created=1`);
}

/** Brand, language, indexing, legal links, publication threshold. */
export async function saveStatusPage(formData: FormData) {
  const current = await requireManager();
  const parsed = z
    .object({
      id: uuid,
      name: z.string().trim().min(2).max(80),
      locale: z.enum(["en", "fr", "de"]),
      accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      noindex: z.string().optional(),
      visibility: z.enum(["public", "internal"]).default("public"),
      privacyUrl: z.string().trim().url().or(z.literal("")),
      legalUrl: z.string().trim().url().or(z.literal("")),
      replyTo: z.string().trim().email().or(z.literal("")),
      minSeverityRank: z.coerce.number().int().min(0).max(5),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect(`${PAGE}?error=invalid`);
  const input = parsed.data;
  await withTenant(current.tenant.id, async (tx) => {
    await tx
      .update(statusPages)
      .set({
        name: input.name,
        locale: input.locale,
        accentColor: input.accentColor,
        noindex: input.noindex === "on",
        visibility: input.visibility,
        privacyUrl: input.privacyUrl || null,
        legalUrl: input.legalUrl || null,
        replyTo: input.replyTo || null,
        minSeverityRank: input.minSeverityRank,
        updatedAt: new Date(),
      })
      .where(and(eq(statusPages.tenantId, current.tenant.id), eq(statusPages.id, input.id)));
    await recordAudit(tx, current, "config", "status_page.updated", { name: input.name });
  });
  await refreshStatusSnapshot(current.tenant.id, input.id);
  revalidatePath(PAGE);
  redirect(`${PAGE}?page=${input.id}&saved=1`);
}

/** Custom domain: saved, then verified by a real DNS lookup (CNAME → status.<base domain>). TLS is the proxy's job. */
export async function saveCustomDomain(formData: FormData) {
  const current = await requireManager();
  const id = uuid.parse(formData.get("id"));
  const domain = z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9.-]{3,253}$/)
    .or(z.literal(""))
    .parse(formData.get("customDomain") ?? "");
  let verified: Date | null = null;
  let detail = "";
  if (domain) {
    const expected = `status.${(process.env.BASE_DOMAIN ?? "localhost:3100").split(":")[0]}`;
    try {
      const cnames = await dns.resolveCname(domain);
      if (cnames.some((c) => c.replace(/\.$/, "") === expected)) verified = new Date();
      else detail = `cname=${cnames.join(",")}`;
    } catch (err) {
      detail = err instanceof Error ? err.message : "lookup failed";
    }
  }
  await withTenant(current.tenant.id, async (tx) => {
    await tx
      .update(statusPages)
      .set({
        customDomain: domain || null,
        customDomainVerifiedAt: verified,
        updatedAt: new Date(),
      })
      .where(and(eq(statusPages.tenantId, current.tenant.id), eq(statusPages.id, id)));
    await recordAudit(tx, current, "config", "status_page.domain", {
      domain: domain || null,
      verified: Boolean(verified),
      detail,
    });
  }).catch(() => redirect(`${PAGE}?page=${id}&error=domain`));
  await refreshStatusSnapshot(current.tenant.id, id);
  revalidatePath(PAGE);
  redirect(`${PAGE}?page=${id}&domain=${domain ? (verified ? "verified" : "pending") : "cleared"}`);
}

export async function deleteStatusPage(formData: FormData) {
  const current = await requireManager();
  const id = uuid.parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [p] = await tx
      .select()
      .from(statusPages)
      .where(and(eq(statusPages.tenantId, current.tenant.id), eq(statusPages.id, id)));
    if (!p) return;
    await tx.delete(statusPages).where(eq(statusPages.id, id));
    await recordAudit(tx, current, "config", "status_page.deleted", { name: p.name });
  });
  await deleteStatusSnapshot(id).catch(() => {});
  revalidatePath(PAGE);
  redirect(PAGE);
}

/**
 * A component is born either manual — a human says how it is, from the
 * incidents — or tracking a monitor, and then nobody says anything: its state,
 * its uptime and its bars are read off that monitor.
 */
export async function createComponent(formData: FormData) {
  const current = await requireManager();
  const parsed = z
    .object({
      pageId: uuid,
      name: z.string().trim().min(1).max(60),
      description: z.string().trim().max(120).optional(),
      groupName: z.string().trim().max(60).optional(),
      serviceId: uuid.or(z.literal("")).optional(),
      source: z.enum(["monitor", "manual"]).default("manual"),
      monitorId: uuid.or(z.literal("")).optional(),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect(`${PAGE}?error=invalid`);
  const input = parsed.data;
  if (input.source === "monitor" && !input.monitorId)
    redirect(`${PAGE}?page=${input.pageId}&error=invalid`);
  const ok = await withTenant(current.tenant.id, async (tx) => {
    // The monitor must be the workspace's own — the form is not the authority.
    let monitorId: string | null = null;
    if (input.source === "monitor" && input.monitorId) {
      const [m] = await tx
        .select({ id: monitors.id })
        .from(monitors)
        .where(and(eq(monitors.tenantId, current.tenant.id), eq(monitors.id, input.monitorId)));
      if (!m) return false;
      monitorId = m.id;
    }
    const [max] = await tx
      .select({
        max: sql<number>`coalesce(max(${statusPageComponents.position}), -1)`.mapWith(Number),
      })
      .from(statusPageComponents)
      .where(eq(statusPageComponents.pageId, input.pageId));
    await tx.insert(statusPageComponents).values({
      tenantId: current.tenant.id,
      pageId: input.pageId,
      name: input.name,
      description: input.description || null,
      groupName: input.groupName || null,
      serviceId: monitorId ? null : input.serviceId || null,
      monitorId,
      position: (max?.max ?? -1) + 1,
    });
    await recordAudit(tx, current, "config", "status_component.created", {
      name: input.name,
      source: monitorId ? "monitor" : "manual",
      monitorId,
    });
    return true;
  });
  if (!ok) redirect(`${PAGE}?page=${input.pageId}&error=invalid`);
  await refreshStatusSnapshot(current.tenant.id, input.pageId);
  revalidatePath(PAGE);
  redirect(`${PAGE}?page=${input.pageId}`);
}

/**
 * The two things about a component a human writes: its public name and the one
 * line under it. Everything else — its state, its bars — is either the
 * monitor's word or an incident's, and neither is edited from a form.
 */
export async function updateComponent(formData: FormData) {
  const current = await requireManager();
  const parsed = z
    .object({
      id: uuid,
      name: z.string().trim().min(1).max(60),
      description: z.string().trim().max(120).optional(),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect(`${PAGE}?error=invalid`);
  const input = parsed.data;
  const pageId = await withTenant(current.tenant.id, async (tx) => {
    const [c] = await tx
      .select({ pageId: statusPageComponents.pageId, name: statusPageComponents.name })
      .from(statusPageComponents)
      .where(
        and(
          eq(statusPageComponents.tenantId, current.tenant.id),
          eq(statusPageComponents.id, input.id),
        ),
      );
    if (!c) return null;
    await tx
      .update(statusPageComponents)
      .set({ name: input.name, description: input.description || null })
      .where(eq(statusPageComponents.id, input.id));
    await recordAudit(tx, current, "config", "status_component.updated", { name: input.name });
    return c.pageId;
  });
  if (!pageId) redirect(`${PAGE}?error=invalid`);
  await refreshStatusSnapshot(current.tenant.id, pageId);
  revalidatePath(PAGE);
  redirect(`${PAGE}?page=${pageId}`);
}

/*
 * What follows acts on what the public sees — a component's state, a
 * maintenance, the wording of a published update — and every one of these is
 * drawn only for a member who may respond. `requireResponder` is that same
 * gate on the server: a screen that hides a button and an action that accepts
 * it from anyone is a screen that hides nothing.
 */
export async function updateComponentState(formData: FormData) {
  const current = await requireResponder();
  const id = uuid.parse(formData.get("id"));
  const state = z
    .enum(["operational", "degraded", "partial_outage", "major_outage", "maintenance"])
    .parse(formData.get("state"));
  const pageId = await withTenant(current.tenant.id, async (tx) => {
    const [c] = await tx
      .select()
      .from(statusPageComponents)
      .where(
        and(eq(statusPageComponents.tenantId, current.tenant.id), eq(statusPageComponents.id, id)),
      );
    if (!c) return null;
    // A tracked component's state is the monitor's word; the screen offers no
    // control for it, and a crafted request does not get one either.
    if (c.monitorId) return c.pageId;
    await setComponentState(tx, current.tenant.id, id, state);
    await recordAudit(tx, current, "config", "status_component.state", { name: c.name, state });
    return c.pageId;
  });
  if (pageId) await refreshStatusSnapshot(current.tenant.id, pageId);
  revalidatePath(PAGE);
  if (pageId) redirect(`${PAGE}?page=${pageId}`);
}

export async function deleteComponent(formData: FormData) {
  const current = await requireManager();
  const id = uuid.parse(formData.get("id"));
  const pageId = await withTenant(current.tenant.id, async (tx) => {
    const [c] = await tx
      .select()
      .from(statusPageComponents)
      .where(
        and(eq(statusPageComponents.tenantId, current.tenant.id), eq(statusPageComponents.id, id)),
      );
    if (!c) return null;
    await tx.delete(componentImpactHistory).where(eq(componentImpactHistory.componentId, id));
    await tx.delete(statusPageComponents).where(eq(statusPageComponents.id, id));
    await recordAudit(tx, current, "config", "status_component.deleted", { name: c.name });
    return c.pageId;
  });
  if (pageId) await refreshStatusSnapshot(current.tenant.id, pageId);
  revalidatePath(PAGE);
  if (pageId) redirect(`${PAGE}?page=${pageId}`);
}

/** "Schedule a maintenance": components, window, automatic transitions. Subscribers are told once. */
export async function createMaintenance(formData: FormData) {
  const current = await requireResponder();
  const parsed = z
    .object({
      pageId: uuid,
      title: z.string().trim().min(2).max(140),
      body: z.string().trim().max(2000),
      startAt: z.string().datetime(),
      endAt: z.string().datetime(),
      autoTransitions: z.string().optional(),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect(`${PAGE}?error=invalid`);
  const input = parsed.data;
  const componentIds = formData
    .getAll("componentIds")
    .map(String)
    .filter((x) => uuid.safeParse(x).success);
  const start = new Date(input.startAt);
  const end = new Date(input.endAt);
  if (end <= start) redirect(`${PAGE}?page=${input.pageId}&error=invalid`);
  await withTenant(current.tenant.id, async (tx) => {
    const [m] = await tx
      .insert(statusPageMaintenances)
      .values({
        tenantId: current.tenant.id,
        pageId: input.pageId,
        title: input.title,
        body: input.body,
        componentIds,
        startAt: start,
        endAt: end,
        status: "scheduled",
        autoTransitions: input.autoTransitions !== "off",
        createdByMemberId: current.member.id,
      })
      .returning({ id: statusPageMaintenances.id });
    await tx.insert(statusPageMaintenanceUpdates).values({
      tenantId: current.tenant.id,
      maintenanceId: m!.id,
      status: "scheduled",
      body: input.body || input.title,
      publishedAt: new Date(),
    });
    await recordAudit(tx, current, "config", "maintenance.scheduled", {
      title: input.title,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
    });
  });
  await refreshStatusSnapshot(current.tenant.id, input.pageId);
  revalidatePath(PAGE);
  redirect(`${PAGE}?page=${input.pageId}&maintenance=1`);
}

export async function cancelMaintenance(formData: FormData) {
  const current = await requireResponder();
  const id = uuid.parse(formData.get("id"));
  const pageId = await withTenant(current.tenant.id, async (tx) => {
    const [m] = await tx
      .select()
      .from(statusPageMaintenances)
      .where(
        and(
          eq(statusPageMaintenances.tenantId, current.tenant.id),
          eq(statusPageMaintenances.id, id),
        ),
      );
    if (!m || m.status === "completed") return m?.pageId ?? null;
    await tx
      .update(statusPageMaintenances)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(statusPageMaintenances.id, id));
    await tx.insert(statusPageMaintenanceUpdates).values({
      tenantId: current.tenant.id,
      maintenanceId: id,
      status: "cancelled",
      body: "Maintenance cancelled.",
      publishedAt: new Date(),
    });
    for (const cid of m.componentIds)
      await setComponentState(tx, current.tenant.id, cid, "operational");
    await recordAudit(tx, current, "config", "maintenance.cancelled", { title: m.title });
    return m.pageId;
  });
  if (pageId) await refreshStatusSnapshot(current.tenant.id, pageId);
  revalidatePath(PAGE);
  if (pageId) redirect(`${PAGE}?page=${pageId}`);
}

export async function saveTemplate(formData: FormData) {
  const current = await requireManager();
  const parsed = z
    .object({
      pageId: uuid,
      id: uuid.or(z.literal("")).optional(),
      name: z.string().trim().min(2).max(80),
      status: z.enum(["investigating", "identified", "monitoring", "resolved"]),
      body: z.string().trim().min(1).max(2000),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect(`${PAGE}?error=invalid`);
  const input = parsed.data;
  await withTenant(current.tenant.id, async (tx) => {
    if (input.id)
      await tx
        .update(statusPageTemplates)
        .set({ name: input.name, status: input.status, body: input.body })
        .where(
          and(
            eq(statusPageTemplates.tenantId, current.tenant.id),
            eq(statusPageTemplates.id, input.id),
          ),
        );
    else {
      const [max] = await tx
        .select({
          max: sql<number>`coalesce(max(${statusPageTemplates.position}), -1)`.mapWith(Number),
        })
        .from(statusPageTemplates)
        .where(eq(statusPageTemplates.pageId, input.pageId));
      await tx.insert(statusPageTemplates).values({
        tenantId: current.tenant.id,
        pageId: input.pageId,
        name: input.name,
        status: input.status,
        body: input.body,
        position: (max?.max ?? -1) + 1,
      });
    }
    await recordAudit(tx, current, "config", "status_template.saved", { name: input.name });
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?page=${input.pageId}`);
}

export async function deleteTemplate(formData: FormData) {
  const current = await requireManager();
  const id = uuid.parse(formData.get("id"));
  const pageId = await withTenant(current.tenant.id, async (tx) => {
    const [t] = await tx
      .select()
      .from(statusPageTemplates)
      .where(
        and(eq(statusPageTemplates.tenantId, current.tenant.id), eq(statusPageTemplates.id, id)),
      );
    if (!t) return null;
    await tx.delete(statusPageTemplates).where(eq(statusPageTemplates.id, id));
    return t.pageId;
  });
  revalidatePath(PAGE);
  if (pageId) redirect(`${PAGE}?page=${pageId}`);
}

/** CSV import of already-consented subscribers — owners only, audited, confirmed on arrival. */
export async function importSubscribers(formData: FormData) {
  const current = await requireMember();
  if (current.member.role !== "owner") redirect(`${PAGE}?error=owner`);
  const pageId = uuid.parse(formData.get("pageId"));
  const file = formData.get("file");
  const text = file instanceof File ? await file.text() : String(formData.get("csv") ?? "");
  const emails = [
    ...new Set(
      text
        .split(/[\r\n,;]+/)
        .map((x) => x.trim().toLowerCase())
        .filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)),
    ),
  ].slice(0, 5000);
  const imported = await withTenant(current.tenant.id, async (tx) => {
    let n = 0;
    for (const email of emails) {
      const r = await tx
        .insert(statusPageSubscribers)
        .values({
          tenantId: current.tenant.id,
          pageId,
          email,
          confirmedAt: new Date(),
          confirmToken: randomBytes(20).toString("hex"),
          unsubscribeToken: randomBytes(20).toString("hex"),
          source: "import",
        })
        .onConflictDoNothing()
        .returning({ id: statusPageSubscribers.id });
      n += r.length;
    }
    await recordAudit(tx, current, "security", "status_subscribers.imported", {
      count: n,
      rows: emails.length,
    });
    return n;
  });
  await refreshStatusSnapshot(current.tenant.id, pageId);
  revalidatePath(PAGE);
  redirect(`${PAGE}?page=${pageId}&imported=${imported}`);
}

/**
 * Corrects the wording of an update that is already public.
 *
 * The one thing a status page could not do. A published sentence with the
 * wrong service in it, or the wrong hour, stayed wrong: the only way out was
 * another update contradicting the first, which reads as a second incident.
 *
 * What a correction does not do, and the screen says so: it does not
 * re-notify. The subscribers were emailed the old words and an email cannot be
 * recalled — a silent second send would be a different message arriving with
 * the same timestamp. It also keeps the publication time: the page says the
 * text was corrected and when, because somebody read the first version.
 *
 * The status of an update can only be changed on the **latest** one, which is
 * the page's current state. Changing the status of an older update rewrites
 * what the page said at a moment that has passed.
 */
export async function correctIncidentUpdate(formData: FormData) {
  const current = await requireResponder();
  const parsed = z
    .object({
      id: uuid,
      pageId: uuid,
      body: z.string().trim().min(2).max(4000),
      status: z.enum(["investigating", "identified", "monitoring", "resolved"]).optional(),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect(`${PAGE}?error=invalid`);
  const input = parsed.data;

  await withTenant(current.tenant.id, async (tx) => {
    const [update] = await tx
      .select()
      .from(statusPageIncidentUpdates)
      .where(
        and(
          eq(statusPageIncidentUpdates.tenantId, current.tenant.id),
          eq(statusPageIncidentUpdates.id, input.id),
        ),
      );
    if (!update) return;

    // Is this the newest update of its incident? Only that one owns the
    // status the page is currently showing.
    const [newest] = await tx
      .select({ id: statusPageIncidentUpdates.id })
      .from(statusPageIncidentUpdates)
      .where(eq(statusPageIncidentUpdates.statusPageIncidentId, update.statusPageIncidentId))
      .orderBy(desc(statusPageIncidentUpdates.publishedAt))
      .limit(1);
    const isNewest = newest?.id === update.id;
    const status = isNewest && input.status ? input.status : update.status;
    const changed = update.body !== input.body || status !== update.status;
    if (!changed) return;

    await tx
      .update(statusPageIncidentUpdates)
      .set({ body: input.body, status, correctedAt: new Date() })
      .where(eq(statusPageIncidentUpdates.id, update.id));

    // The incident carries the status the page shows; it follows the newest
    // update and nothing else.
    if (isNewest) {
      await tx
        .update(statusPageIncidents)
        .set({
          status,
          resolvedAt: status === "resolved" ? (update.publishedAt ?? new Date()) : null,
        })
        .where(eq(statusPageIncidents.id, update.statusPageIncidentId));
    }
    await recordAudit(tx, current, "config", "status_page.update_corrected", {
      updateId: update.id,
      status,
    });
  });

  await refreshStatusSnapshot(current.tenant.id, input.pageId);
  revalidatePath(PAGE);
  redirect(`${PAGE}?page=${input.pageId}&corrected=1`);
}

/**
 * Moves or rewords a maintenance window that has not started.
 *
 * Scheduling one and then having the date move is the ordinary case, and the
 * only answer the product had was to cancel it and schedule another — which
 * tells every subscriber the window was cancelled and then tells them about a
 * new one, for what is the same maintenance.
 *
 * A window that has started or finished is not edited: its own updates are the
 * record of what happened, and moving the start of something that already
 * started is a statement nobody can act on.
 */
export async function editMaintenance(formData: FormData) {
  const current = await requireResponder();
  const parsed = z
    .object({
      id: uuid,
      pageId: uuid,
      title: z.string().trim().min(2).max(140),
      body: z.string().trim().max(2000),
      startAt: z.string().datetime(),
      endAt: z.string().datetime(),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect(`${PAGE}?error=invalid`);
  const input = parsed.data;
  const componentIds = formData
    .getAll("componentIds")
    .map(String)
    .filter((x) => uuid.safeParse(x).success);
  const start = new Date(input.startAt);
  const end = new Date(input.endAt);
  if (end <= start) redirect(`${PAGE}?page=${input.pageId}&error=invalid`);

  await withTenant(current.tenant.id, async (tx) => {
    const [m] = await tx
      .select()
      .from(statusPageMaintenances)
      .where(
        and(
          eq(statusPageMaintenances.tenantId, current.tenant.id),
          eq(statusPageMaintenances.id, input.id),
        ),
      );
    if (!m || m.status !== "scheduled") return;
    const moved = m.startAt.getTime() !== start.getTime() || m.endAt.getTime() !== end.getTime();
    await tx
      .update(statusPageMaintenances)
      .set({
        title: input.title,
        body: input.body,
        componentIds,
        startAt: start,
        endAt: end,
        updatedAt: new Date(),
      })
      .where(eq(statusPageMaintenances.id, m.id));
    // A move is worth an update on the public timeline; a reworded body is
    // not — the body is what the page already shows.
    if (moved) {
      await tx.insert(statusPageMaintenanceUpdates).values({
        tenantId: current.tenant.id,
        maintenanceId: m.id,
        status: "scheduled",
        body: input.body || input.title,
        publishedAt: new Date(),
      });
    }
    await recordAudit(tx, current, "config", "maintenance.edited", {
      title: input.title,
      moved,
    });
  });

  await refreshStatusSnapshot(current.tenant.id, input.pageId);
  revalidatePath(PAGE);
  redirect(`${PAGE}?page=${input.pageId}&maintenance=edited`);
}
