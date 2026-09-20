"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { slos, withTenant } from "@openincident/db";
import { recordAudit } from "@/lib/audit";
import { requireResponder } from "@/lib/session";
import { observeService } from "@/lib/services";
import { sloQueryError } from "@/lib/slos";
import { DEFAULT_ACTION } from "@/lib/monitors";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  service: z.string().trim().max(120).optional(),
  goodQuery: z.string().trim().min(1).max(2_000),
  totalQuery: z.string().trim().min(1).max(2_000),
  // Below 50 an objective is not an objective, and 100 leaves no budget at all
  // — an SLO with no budget cannot have a burn rate, so it cannot alert.
  objective: z.coerce.number().min(50).max(99.999),
  windowKind: z.enum(["rolling", "calendar"]).default("rolling"),
  windowDays: z.coerce.number().int().min(1).max(365).default(28),
  burnAlerts: z.enum(["on", "off"]).default("on"),
  page: z.enum(["owner", "me", "nobody"]).default("owner"),
});

export async function createSlo(form: FormData): Promise<void> {
  const current = await requireResponder();
  const parsed = schema.safeParse({
    name: form.get("name"),
    description: form.get("description") ?? undefined,
    service: form.get("service") ?? undefined,
    goodQuery: form.get("goodQuery"),
    totalQuery: form.get("totalQuery"),
    objective: form.get("objective"),
    windowKind: form.get("windowKind") ?? "rolling",
    windowDays: form.get("windowDays") ?? 28,
    burnAlerts: form.get("burnAlerts") === "on" ? "on" : "off",
    page: form.get("page") ?? "owner",
  });
  if (!parsed.success) redirect("/app/slos?error=invalid");
  const v = parsed.data;

  const refusal = sloQueryError(v.goodQuery, v.totalQuery);
  if (refusal) redirect(`/app/slos?error=query&why=${encodeURIComponent(refusal)}`);

  const id = await withTenant(current.tenant.id, async (tx) => {
    const serviceId = v.service
      ? await observeService(tx, current.tenant.id, v.service, "slo")
      : null;
    const [row] = await tx
      .insert(slos)
      .values({
        tenantId: current.tenant.id,
        name: v.name,
        description: v.description ?? null,
        serviceId,
        goodQuery: v.goodQuery,
        totalQuery: v.totalQuery,
        objective: v.objective,
        windowKind: v.windowKind,
        windowDays: v.windowDays,
        burnAlerts: v.burnAlerts === "on",
        action: {
          ...DEFAULT_ACTION,
          page:
            v.page === "me"
              ? { kind: "member", memberId: current.member.id }
              : v.page === "nobody"
                ? { kind: "nobody" }
                : { kind: "owner" },
        },
        createdByMemberId: current.member.id,
      })
      .returning({ id: slos.id });
    await recordAudit(tx, current, "config", "slo.created", { name: v.name });
    return row!.id;
  });
  revalidatePath("/app/slos");
  redirect(`/app/slos/${id}`);
}

export async function toggleSloPause(form: FormData): Promise<void> {
  const current = await requireResponder();
  const id = z.string().uuid().parse(form.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select({ paused: slos.paused, name: slos.name })
      .from(slos)
      .where(and(eq(slos.tenantId, current.tenant.id), eq(slos.id, id)));
    if (!row) return;
    await tx
      .update(slos)
      .set({ paused: !row.paused, updatedAt: new Date() })
      .where(eq(slos.id, id));
    await recordAudit(tx, current, "config", row.paused ? "slo.resumed" : "slo.paused", {
      name: row.name,
    });
  });
  revalidatePath(`/app/slos/${id}`);
  redirect(`/app/slos/${id}`);
}

export async function deleteSlo(form: FormData): Promise<void> {
  const current = await requireResponder();
  const id = z.string().uuid().parse(form.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .delete(slos)
      .where(and(eq(slos.tenantId, current.tenant.id), eq(slos.id, id)))
      .returning({ name: slos.name });
    if (row) await recordAudit(tx, current, "config", "slo.deleted", { name: row.name });
  });
  revalidatePath("/app/slos");
  redirect("/app/slos");
}
