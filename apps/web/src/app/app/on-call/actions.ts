"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  coverRequests,
  members,
  rotations,
  scheduleOverrides,
  schedules,
  withTenant,
} from "@openincident/db";
import { notifyMember, zonedTime, localParts } from "@openincident/oncall";
import { recordAudit } from "@/lib/audit";
import { TIMEZONES } from "@/lib/oncall";
import { requireManager, requireMember, requireResponder } from "@/lib/session";
import { requestOrigin } from "@/lib/tenant";
import { headers } from "next/headers";

const uuid = z.string().uuid();
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);

async function origin(): Promise<string> {
  const h = await headers();
  return requestOrigin({ headers: h, nextUrl: new URL(`http://${h.get("host") ?? "localhost"}/`) });
}

/** "+ New schedule": a draft with one rotation — it pages nobody until published. */
export async function createSchedule(formData: FormData) {
  const current = await requireManager();
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(80),
      timezone: z
        .string()
        .refine((v) => TIMEZONES.includes(v) || /^[A-Za-z_]+\/[A-Za-z_]+$/.test(v)),
      handoverTime: hhmm,
      interval: z.enum(["weekly", "daily", "weekend"]),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect("/app/on-call?error=invalid");
  const memberIds = formData
    .getAll("members")
    .map(String)
    .filter((x) => uuid.safeParse(x).success);
  const input = parsed.data;
  const id = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .insert(schedules)
      .values({
        tenantId: current.tenant.id,
        name: input.name,
        timezone: input.timezone,
        handoverTime: input.handoverTime,
        status: "draft",
        icalToken: randomBytes(16).toString("hex"),
        createdByMemberId: current.member.id,
      })
      .returning({ id: schedules.id });
    await tx.insert(rotations).values({
      tenantId: current.tenant.id,
      scheduleId: row!.id,
      name: input.interval === "weekend" ? "Week-ends" : "Primary",
      interval: input.interval,
      handoverDay: 1,
      memberIds,
      position: 0,
    });
    await recordAudit(tx, current, "config", "schedule.created", { name: input.name });
    return row!.id;
  });
  revalidatePath("/app/on-call");
  redirect(`/app/on-call?schedule=${id}&created=1`);
}

export async function publishSchedule(formData: FormData) {
  const current = await requireManager();
  const id = uuid.parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [s] = await tx
      .select()
      .from(schedules)
      .where(and(eq(schedules.tenantId, current.tenant.id), eq(schedules.id, id)));
    if (!s) return;
    await tx
      .update(schedules)
      .set({ status: "published", updatedAt: new Date() })
      .where(eq(schedules.id, id));
    await recordAudit(tx, current, "config", "schedule.published", { name: s.name });
  });
  revalidatePath("/app/on-call");
}

/** Rotation membership: order, add, remove. Applies from the next computation — past slots never move. */
export async function updateRotationMembers(formData: FormData) {
  const current = await requireManager();
  const rotationId = uuid.parse(formData.get("rotationId"));
  const op = z.enum(["up", "down", "remove", "add"]).parse(formData.get("op"));
  const memberId = uuid.parse(formData.get("memberId"));
  const scheduleId = await withTenant(current.tenant.id, async (tx) => {
    const [r] = await tx
      .select()
      .from(rotations)
      .where(and(eq(rotations.tenantId, current.tenant.id), eq(rotations.id, rotationId)));
    if (!r) return null;
    const list = [...r.memberIds];
    const i = list.indexOf(memberId);
    if (op === "add" && i === -1) list.push(memberId);
    if (op === "remove" && i >= 0) list.splice(i, 1);
    if (op === "up" && i > 0) [list[i - 1], list[i]] = [list[i]!, list[i - 1]!];
    if (op === "down" && i >= 0 && i < list.length - 1)
      [list[i + 1], list[i]] = [list[i]!, list[i + 1]!];
    await tx.update(rotations).set({ memberIds: list }).where(eq(rotations.id, r.id));
    await recordAudit(tx, current, "config", "rotation.members_changed", { rotation: r.name, op });
    return r.scheduleId;
  });
  revalidatePath("/app/on-call");
  if (scheduleId) redirect(`/app/on-call?schedule=${scheduleId}&manage=${rotationId}`);
}

/** One override on one slot — the rotation is untouched, everything is traced. Member empty = NOBODY. */
export async function createOverride(formData: FormData) {
  const current = await requireResponder();
  const parsed = z
    .object({
      scheduleId: uuid,
      rotationId: uuid.or(z.literal("")),
      memberId: uuid.or(z.literal("")),
      startAt: z.string().datetime(),
      endAt: z.string().datetime(),
      reason: z.enum(["override", "cover"]).default("override"),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect("/app/on-call?error=invalid");
  const input = parsed.data;
  const start = new Date(input.startAt);
  const end = new Date(input.endAt);
  if (end <= start) redirect(`/app/on-call?schedule=${input.scheduleId}&error=invalid`);
  await withTenant(current.tenant.id, async (tx) => {
    await tx.insert(scheduleOverrides).values({
      tenantId: current.tenant.id,
      scheduleId: input.scheduleId,
      rotationId: input.rotationId || null,
      memberId: input.memberId || null,
      startAt: start,
      endAt: end,
      reason: input.reason,
      createdByMemberId: current.member.id,
    });
    await recordAudit(tx, current, "config", "override.created", {
      scheduleId: input.scheduleId,
      memberId: input.memberId || null,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
    });
  });
  revalidatePath("/app/on-call");
  redirect(`/app/on-call?schedule=${input.scheduleId}`);
}

export async function deleteOverride(formData: FormData) {
  const current = await requireResponder();
  const id = uuid.parse(formData.get("id"));
  const scheduleId = await withTenant(current.tenant.id, async (tx) => {
    const [o] = await tx
      .select()
      .from(scheduleOverrides)
      .where(and(eq(scheduleOverrides.tenantId, current.tenant.id), eq(scheduleOverrides.id, id)));
    if (!o) return null;
    await tx.delete(scheduleOverrides).where(eq(scheduleOverrides.id, id));
    await recordAudit(tx, current, "config", "override.deleted", { scheduleId: o.scheduleId });
    return o.scheduleId;
  });
  revalidatePath("/app/on-call");
  if (scheduleId) redirect(`/app/on-call?schedule=${scheduleId}`);
}

/**
 * "Cover me": offers one of my shifts to the other members of the rotation.
 * Everyone is notified; the first to accept gets the override.
 */
export async function requestCover(formData: FormData) {
  const current = await requireMember();
  const parsed = z
    .object({
      scheduleId: uuid,
      rotationId: uuid,
      startAt: z.string().datetime(),
      endAt: z.string().datetime(),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect("/app/on-call?error=invalid");
  const input = parsed.data;
  const base = await origin();
  await withTenant(current.tenant.id, async (tx) => {
    const [rot] = await tx
      .select()
      .from(rotations)
      .where(and(eq(rotations.tenantId, current.tenant.id), eq(rotations.id, input.rotationId)));
    const [sched] = await tx.select().from(schedules).where(eq(schedules.id, input.scheduleId));
    if (!rot || !sched) return;
    const [req] = await tx
      .insert(coverRequests)
      .values({
        tenantId: current.tenant.id,
        scheduleId: input.scheduleId,
        rotationId: input.rotationId,
        requesterMemberId: current.member.id,
        startAt: new Date(input.startAt),
        endAt: new Date(input.endAt),
        status: "open",
      })
      .returning({ id: coverRequests.id });
    const others = rot.memberIds.filter((m) => m !== current.member.id);
    const rows = others.length
      ? await tx
          .select({
            id: members.id,
            name: members.name,
            email: members.email,
            status: members.status,
          })
          .from(members)
          .where(and(eq(members.tenantId, current.tenant.id)))
      : [];
    for (const m of rows.filter((r) => others.includes(r.id) && r.status === "active")) {
      await notifyMember(tx, current.tenant.id, m, {
        kind: "cover_request",
        urgency: "low",
        subject: `${current.member.name} asks for cover · ${sched.name}`,
        text: `${rot.name} — ${new Date(input.startAt).toISOString()} → ${new Date(input.endAt).toISOString()}. First to accept takes the shift.`,
        url: `${base}/app/on-call?schedule=${sched.id}&cover=${req!.id}`,
        origin: base,
      });
    }
    await recordAudit(tx, current, "config", "cover.requested", {
      schedule: sched.name,
      startAt: input.startAt,
      endAt: input.endAt,
      notified: others.length,
    });
  });
  revalidatePath("/app/on-call");
  redirect(`/app/on-call?schedule=${input.scheduleId}&coverSent=1`);
}

/** Accepting a cover request creates the override and closes the request — once. */
export async function acceptCover(formData: FormData) {
  const current = await requireMember();
  const id = uuid.parse(formData.get("id"));
  const scheduleId = await withTenant(current.tenant.id, async (tx) => {
    const [req] = await tx
      .select()
      .from(coverRequests)
      .where(and(eq(coverRequests.tenantId, current.tenant.id), eq(coverRequests.id, id)));
    if (!req || req.status !== "open" || req.requesterMemberId === current.member.id)
      return req?.scheduleId ?? null;
    const now = new Date();
    await tx
      .update(coverRequests)
      .set({ status: "accepted", acceptedByMemberId: current.member.id, acceptedAt: now })
      .where(eq(coverRequests.id, id));
    await tx.insert(scheduleOverrides).values({
      tenantId: current.tenant.id,
      scheduleId: req.scheduleId,
      rotationId: req.rotationId,
      memberId: current.member.id,
      startAt: req.startAt,
      endAt: req.endAt,
      reason: "cover",
      createdByMemberId: current.member.id,
    });
    const [requester] = await tx
      .select({ id: members.id, name: members.name, email: members.email })
      .from(members)
      .where(eq(members.id, req.requesterMemberId));
    const base = await origin();
    if (requester)
      await notifyMember(tx, current.tenant.id, requester, {
        kind: "cover_request",
        urgency: "low",
        subject: `${current.member.name} covers your shift`,
        text: `${req.startAt.toISOString()} → ${req.endAt.toISOString()}`,
        url: `${base}/app/on-call?schedule=${req.scheduleId}`,
        origin: base,
      });
    await recordAudit(tx, current, "config", "cover.accepted", { requestId: id });
    return req.scheduleId;
  });
  revalidatePath("/app/on-call");
  if (scheduleId) redirect(`/app/on-call?schedule=${scheduleId}&covered=1`);
}

/** Helper for the week grid: the local day bounds of a slot in the schedule's zone. */
export async function slotBounds(
  timezone: string,
  dayKey: string,
  activeStart: string | null,
  activeEnd: string | null,
): Promise<{ start: Date; end: Date }> {
  const [y, m, d] = dayKey.split("-").map(Number) as [number, number, number];
  const start = zonedTime(y, m, d, activeStart ?? "00:00", timezone);
  let end = zonedTime(y, m, d, activeEnd ?? "00:00", timezone);
  if (end.getTime() <= start.getTime()) {
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    end = zonedTime(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      next.getUTCDate(),
      activeEnd ?? "00:00",
      timezone,
    );
  }
  void localParts;
  return { start, end };
}
