"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { encryptSecret } from "@openincident/crypto";
import { heartbeats, withTenant } from "@openincident/db";
import {
  MIN_INTERVAL_SECONDS,
  ensureHeartbeatSource,
  newHeartbeatToken,
} from "@openincident/oncall";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";

const PAGE = "/app/settings/heartbeats";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  serviceEntryId: z.string().uuid().or(z.literal("")).optional(),
  intervalSeconds: z.coerce
    .number()
    .int()
    .min(MIN_INTERVAL_SECONDS)
    .max(31 * 86_400),
  graceSeconds: z.coerce
    .number()
    .int()
    .min(0)
    .max(7 * 86_400),
});

/** A new heartbeat: its ping URL exists from now on, alerts only after the first ping. */
export async function createHeartbeat(formData: FormData) {
  const current = await requireManager();
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect(`${PAGE}?new=1&error=invalid`);
  const input = parsed.data;
  const id = await withTenant(current.tenant.id, async (tx) => {
    await ensureHeartbeatSource(tx, current.tenant.id);
    const [row] = await tx
      .insert(heartbeats)
      .values({
        tenantId: current.tenant.id,
        name: input.name,
        description: input.description || null,
        serviceEntryId: input.serviceEntryId || null,
        intervalSeconds: input.intervalSeconds,
        graceSeconds: input.graceSeconds,
        encryptedToken: encryptSecret(newHeartbeatToken()),
      })
      .returning({ id: heartbeats.id });
    await recordAudit(tx, current, "config", "heartbeat.created", {
      name: input.name,
      intervalSeconds: input.intervalSeconds,
    });
    return row!.id;
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?created=${id}`);
}

export async function toggleHeartbeat(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(heartbeats)
      .where(and(eq(heartbeats.tenantId, current.tenant.id), eq(heartbeats.id, id)));
    if (!row) return;
    // Pausing also forgets the last ping: resuming waits for a fresh one instead of alerting at once.
    await tx
      .update(heartbeats)
      .set(
        row.active
          ? { active: false, status: "waiting", lastPingAt: null, updatedAt: new Date() }
          : { active: true, status: "waiting", lastPingAt: null, updatedAt: new Date() },
      )
      .where(eq(heartbeats.id, id));
    await recordAudit(
      tx,
      current,
      "config",
      row.active ? "heartbeat.paused" : "heartbeat.resumed",
      { name: row.name },
    );
  });
  revalidatePath(PAGE);
  redirect(PAGE);
}

export async function deleteHeartbeat(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .delete(heartbeats)
      .where(and(eq(heartbeats.tenantId, current.tenant.id), eq(heartbeats.id, id)))
      .returning({ name: heartbeats.name });
    if (row) await recordAudit(tx, current, "config", "heartbeat.deleted", { name: row.name });
  });
  revalidatePath(PAGE);
  redirect(PAGE);
}

/** A new token: the old URL stops working at once. */
export async function rotateHeartbeatToken(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .update(heartbeats)
      .set({ encryptedToken: encryptSecret(newHeartbeatToken()), updatedAt: new Date() })
      .where(and(eq(heartbeats.tenantId, current.tenant.id), eq(heartbeats.id, id)))
      .returning({ name: heartbeats.name });
    if (row)
      await recordAudit(tx, current, "config", "heartbeat.token_rotated", { name: row.name });
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?rotated=${id}`);
}
