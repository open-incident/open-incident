"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { alertRoutes, withTenant, type RouteFilter } from "@openincident/db";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";

const PAGE = "/app/settings/alert-routes";
const uuid = z.string().uuid();
const optional = z.string().uuid().or(z.literal("")).optional();

function filtersFrom(formData: FormData): RouteFilter[] {
  const out: RouteFilter[] = [];
  for (let i = 0; i < 3; i++) {
    const attribute = String(formData.get(`f${i}_attribute`) ?? "").trim();
    const op = String(formData.get(`f${i}_op`) ?? "eq");
    const value = String(formData.get(`f${i}_value`) ?? "").trim();
    if (!attribute) continue;
    if (!["eq", "neq", "in", "exists"].includes(op)) continue;
    out.push({
      attribute,
      op: op as RouteFilter["op"],
      value: op === "exists" ? undefined : value,
    });
  }
  return out;
}

const schema = z.object({
  id: uuid.optional().or(z.literal("")),
  name: z.string().trim().min(2).max(80),
  escalationMode: z.enum(["static", "dynamic", "none"]),
  escalationPathId: optional,
  urgencyOverride: z.enum(["", "high", "low"]).default(""),
  priorityId: optional,
  incidentMode: z.enum(["never", "always", "conditional"]),
  incidentTypeId: optional,
  deferMinutes: z.coerce.number().int().min(0).max(10).default(0),
  testMode: z.string().optional(),
  resolveClosesEscalation: z.string().optional(),
});

/** Creates or edits a route. */
export async function saveRoute(formData: FormData) {
  const current = await requireManager();
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect(`${PAGE}?error=invalid`);
  const input = parsed.data;
  const filters = filtersFrom(formData);
  await withTenant(current.tenant.id, async (tx) => {
    const values = {
      name: input.name,
      filters,
      escalationMode: input.escalationMode,
      escalationPathId: input.escalationPathId || null,
      urgencyOverride: input.urgencyOverride || null,
      priorityId: input.priorityId || null,
      incidentMode: input.incidentMode,
      incidentTypeId: input.incidentTypeId || null,
      deferMinutes: input.deferMinutes,
      testMode: input.testMode === "on",
      resolveClosesEscalation: input.resolveClosesEscalation !== "off",
      updatedAt: new Date(),
    } as const;
    if (input.id) {
      await tx
        .update(alertRoutes)
        .set(values)
        .where(and(eq(alertRoutes.tenantId, current.tenant.id), eq(alertRoutes.id, input.id)));
      await recordAudit(tx, current, "config", "alert_route.updated", { name: input.name });
    } else {
      const [max] = await tx
        .select({ max: sql<number>`coalesce(max(${alertRoutes.position}), -1)`.mapWith(Number) })
        .from(alertRoutes)
        .where(eq(alertRoutes.tenantId, current.tenant.id));
      await tx.insert(alertRoutes).values({
        tenantId: current.tenant.id,
        ...values,
        active: true,
        position: (max?.max ?? -1) + 1,
      });
      await recordAudit(tx, current, "config", "alert_route.created", { name: input.name });
    }
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?saved=1`);
}

export async function toggleRoute(formData: FormData) {
  const current = await requireManager();
  const id = uuid.parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [r] = await tx
      .select()
      .from(alertRoutes)
      .where(and(eq(alertRoutes.tenantId, current.tenant.id), eq(alertRoutes.id, id)));
    if (!r) return;
    // "Activate" on a test-mode route leaves test mode; on an inactive route, switches it on.
    if (r.testMode)
      await tx
        .update(alertRoutes)
        .set({ testMode: false, active: true, updatedAt: new Date() })
        .where(eq(alertRoutes.id, id));
    else
      await tx
        .update(alertRoutes)
        .set({ active: !r.active, updatedAt: new Date() })
        .where(eq(alertRoutes.id, id));
    await recordAudit(tx, current, "config", "alert_route.toggled", { name: r.name });
  });
  revalidatePath(PAGE);
}

/** Duplicates in test mode — activate it once the filter is verified. */
export async function duplicateRoute(formData: FormData) {
  const current = await requireManager();
  const id = uuid.parse(formData.get("id"));
  const name = await withTenant(current.tenant.id, async (tx) => {
    const [r] = await tx
      .select()
      .from(alertRoutes)
      .where(and(eq(alertRoutes.tenantId, current.tenant.id), eq(alertRoutes.id, id)));
    if (!r) return null;
    const copyName = `${r.name} (copie)`.slice(0, 80);
    const [max] = await tx
      .select({ max: sql<number>`coalesce(max(${alertRoutes.position}), -1)`.mapWith(Number) })
      .from(alertRoutes)
      .where(eq(alertRoutes.tenantId, current.tenant.id));
    await tx.insert(alertRoutes).values({
      tenantId: current.tenant.id,
      name: copyName,
      active: true,
      testMode: true,
      filters: r.filters,
      escalationMode: r.escalationMode,
      escalationPathId: r.escalationPathId,
      urgencyOverride: r.urgencyOverride,
      priorityId: r.priorityId,
      incidentMode: r.incidentMode,
      incidentTypeId: r.incidentTypeId,
      deferMinutes: r.deferMinutes,
      resolveClosesEscalation: r.resolveClosesEscalation,
      position: (max?.max ?? -1) + 1,
    });
    await recordAudit(tx, current, "config", "alert_route.duplicated", {
      from: r.name,
      name: copyName,
    });
    return r.name;
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?duplicated=${encodeURIComponent(name ?? "")}`);
}

export async function deleteRoute(formData: FormData) {
  const current = await requireManager();
  const id = uuid.parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [r] = await tx
      .select()
      .from(alertRoutes)
      .where(and(eq(alertRoutes.tenantId, current.tenant.id), eq(alertRoutes.id, id)));
    if (!r) return;
    await tx.delete(alertRoutes).where(eq(alertRoutes.id, id));
    await recordAudit(tx, current, "config", "alert_route.deleted", { name: r.name });
  });
  revalidatePath(PAGE);
}
