"use server";

/**
 * Creating, pausing and checking a monitor.
 *
 * A monitor is created with criteria already written — the sentence the screen
 * showed — so it does something the minute it exists. "Check now" really runs
 * the check in-process and shows the answer, because a monitor you cannot try
 * is a monitor you do not trust.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { monitorChecks, monitors, withTenant, type MonitorType } from "@openincident/db";
import { performCheck, stateFromSample } from "@openincident/oncall";
import { recordAudit } from "@/lib/audit";
import { requireResponder } from "@/lib/session";
import { DEFAULT_ACTION, defaultCriteria } from "@/lib/monitors";
import { observeService } from "@/lib/services";

const TYPES = ["http", "api", "port", "dns", "ssl", "incoming", "manual"] as const;

const createSchema = z.object({
  type: z.enum(TYPES),
  name: z.string().trim().min(1).max(120),
  target: z.string().trim().max(500),
  intervalSeconds: z.coerce.number().int().min(30).max(86_400),
  service: z.string().trim().max(120).optional(),
  page: z.enum(["owner", "me", "nobody"]).default("owner"),
  incident: z.enum(["triage", "p1", "p2", "never"]).default("p2"),
  autoResolve: z.enum(["on", "off"]).default("on"),
});

export async function createMonitor(formData: FormData) {
  const current = await requireResponder();
  const parsed = createSchema.safeParse({
    type: formData.get("type"),
    name: formData.get("name"),
    target: formData.get("target"),
    intervalSeconds: formData.get("intervalSeconds") ?? 60,
    service: formData.get("service") ?? undefined,
    page: formData.get("page") ?? "owner",
    incident: formData.get("incident") ?? "p2",
    autoResolve: formData.get("autoResolve") ?? "on",
  });
  if (!parsed.success) redirect("/app/monitors?error=invalid");
  const v = parsed.data;

  const id = await withTenant(current.tenant.id, async (tx) => {
    const serviceId = v.service
      ? await observeService(tx, current.tenant.id, v.service, "monitor")
      : null;
    const [row] = await tx
      .insert(monitors)
      .values({
        tenantId: current.tenant.id,
        name: v.name,
        type: v.type as MonitorType,
        target: v.target,
        intervalSeconds: v.intervalSeconds,
        criteria: defaultCriteria(v.type as MonitorType),
        action: {
          ...DEFAULT_ACTION,
          page:
            v.page === "me"
              ? { kind: "member", memberId: current.member.id }
              : v.page === "nobody"
                ? { kind: "nobody" }
                : { kind: "owner" },
          incident: { from: v.incident },
          autoResolve: v.autoResolve === "on",
        },
        serviceId,
        state: "waiting",
        createdByMemberId: current.member.id,
      })
      .returning({ id: monitors.id });
    await recordAudit(tx, current, "config", "monitor.created", {
      name: v.name,
      type: v.type,
    });
    return row!.id;
  });

  revalidatePath("/app/monitors");
  revalidatePath("/app");
  redirect(`/app/monitors/${id}`);
}

export async function togglePause(formData: FormData) {
  const current = await requireResponder();
  const id = z.string().uuid().parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select({ paused: monitors.paused, name: monitors.name })
      .from(monitors)
      .where(and(eq(monitors.tenantId, current.tenant.id), eq(monitors.id, id)));
    if (!row) return;
    await tx
      .update(monitors)
      .set({
        paused: !row.paused,
        state: !row.paused ? "paused" : "waiting",
        updatedAt: new Date(),
      })
      .where(eq(monitors.id, id));
    await recordAudit(tx, current, "config", row.paused ? "monitor.resumed" : "monitor.paused", {
      name: row.name,
    });
  });
  revalidatePath(`/app/monitors/${id}`);
  revalidatePath("/app/monitors");
}

/** Runs the check now, in this request, and records it like any other. */
export async function checkNow(formData: FormData) {
  const current = await requireResponder();
  const id = z.string().uuid().parse(formData.get("id"));
  const monitor = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select({
        id: monitors.id,
        type: monitors.type,
        target: monitors.target,
        config: monitors.config,
        criteria: monitors.criteria,
      })
      .from(monitors)
      .where(and(eq(monitors.tenantId, current.tenant.id), eq(monitors.id, id)));
    return row ?? null;
  });
  if (!monitor) redirect("/app/monitors");

  const sample = await performCheck({
    type: monitor.type,
    target: monitor.target,
    config: monitor.config,
  });
  const { state, why } = stateFromSample(monitor.criteria, sample);
  const now = new Date();
  await withTenant(current.tenant.id, async (tx) => {
    await tx.insert(monitorChecks).values({
      tenantId: current.tenant.id,
      monitorId: id,
      at: now,
      state,
      latencyMs: sample.latencyMs ?? null,
      detail: why.slice(0, 500),
    });
    await tx
      .update(monitors)
      .set({
        state,
        lastCheckAt: now,
        lastLatencyMs: sample.latencyMs ?? null,
        lastDetail: why.slice(0, 500),
        updatedAt: now,
      })
      .where(eq(monitors.id, id));
  });
  revalidatePath(`/app/monitors/${id}`);
}

export async function deleteMonitor(formData: FormData) {
  const current = await requireResponder();
  const id = z.string().uuid().parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .delete(monitors)
      .where(and(eq(monitors.tenantId, current.tenant.id), eq(monitors.id, id)))
      .returning({ name: monitors.name });
    if (row) await recordAudit(tx, current, "config", "monitor.deleted", { name: row.name });
  });
  revalidatePath("/app/monitors");
  redirect("/app/monitors");
}
