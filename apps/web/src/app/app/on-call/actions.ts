"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  coverRequests,
  escalationPaths,
  members,
  rotations,
  scheduleOverrides,
  schedules,
  services,
  teamMembers,
  teams,
  withTenant,
} from "@openincident/db";
import { availableChannels, notifyMember } from "@openincident/oncall";
import { recordAudit } from "@/lib/audit";
import { getT } from "@/i18n/server";
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
  if (!parsed.success) redirect("/app/on-call?tab=schedules&error=invalid");
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
  redirect(`/app/on-call?tab=schedules&members=${id}`);
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
  if (scheduleId) redirect(`/app/on-call?tab=schedules&members=${scheduleId}`);
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
  if (!parsed.success) redirect("/app/on-call?tab=now&error=invalid");
  const input = parsed.data;
  const start = new Date(input.startAt);
  const end = new Date(input.endAt);
  if (end <= start) redirect("/app/on-call?tab=now&error=invalid");
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
  redirect("/app/on-call?tab=now");
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
  if (scheduleId) redirect("/app/on-call?tab=now");
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
  if (!parsed.success) redirect("/app/on-call?tab=now&error=invalid");
  const input = parsed.data;
  const base = await origin();
  const notified = await withTenant(current.tenant.id, async (tx) => {
    const [rot] = await tx
      .select()
      .from(rotations)
      .where(and(eq(rotations.tenantId, current.tenant.id), eq(rotations.id, input.rotationId)));
    const [sched] = await tx.select().from(schedules).where(eq(schedules.id, input.scheduleId));
    if (!rot || !sched) return 0;
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
    const reachable = rows.filter((r) => others.includes(r.id) && r.status === "active");
    for (const m of reachable) {
      await notifyMember(tx, current.tenant.id, m, {
        kind: "cover_request",
        urgency: "low",
        subject: `${current.member.name} asks for cover · ${sched.name}`,
        text: `${rot.name} — ${new Date(input.startAt).toISOString()} → ${new Date(input.endAt).toISOString()}. First to accept takes the shift.`,
        url: `${base}/app/on-call?tab=now&cover=${req!.id}`,
        origin: base,
      });
    }
    await recordAudit(tx, current, "config", "cover.requested", {
      schedule: sched.name,
      startAt: input.startAt,
      endAt: input.endAt,
      notified: reachable.length,
    });
    return reachable.length;
  });
  revalidatePath("/app/on-call");
  redirect(`/app/on-call?tab=now&coverSent=${notified}`);
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
        url: `${base}/app/on-call?tab=now`,
        origin: base,
      });
    await recordAudit(tx, current, "config", "cover.accepted", { requestId: id });
    return req.scheduleId;
  });
  revalidatePath("/app/on-call");
  if (scheduleId) redirect("/app/on-call?tab=now&covered=1");
}

/**
 * "Page Jordan": a real high-urgency notification to whoever holds the pager,
 * through THEIR own rule — push, then a call, exactly as an escalation would.
 *
 * It is worth a button only because nothing about it is simulated, which is
 * also why an instance with no channel is told to say so rather than to draw a
 * button that rings nothing.
 */
export async function pageOnCall(formData: FormData) {
  const current = await requireResponder();
  const t = await getT();
  const memberId = uuid.parse(formData.get("memberId"));
  if (availableChannels().length === 0) redirect("/app/on-call?tab=now&pageError=1");
  const base = await origin();
  const name = await withTenant(current.tenant.id, async (tx) => {
    const [target] = await tx
      .select({ id: members.id, name: members.name, email: members.email, status: members.status })
      .from(members)
      .where(and(eq(members.tenantId, current.tenant.id), eq(members.id, memberId)));
    if (!target || target.status !== "active") return null;
    await notifyMember(
      tx,
      current.tenant.id,
      { id: target.id, name: target.name, email: target.email },
      {
        kind: "escalation",
        urgency: "high",
        subject: t("oc2.page.subject", { name: current.member.name }),
        text: t("oc2.page.body", { name: current.member.name }),
        url: `${base}/app/on-call?tab=now`,
        origin: base,
      },
    );
    await recordAudit(tx, current, "config", "oncall.paged", { memberId, name: target.name });
    return target.name;
  });
  revalidatePath("/app/on-call");
  redirect(
    name ? `/app/on-call?tab=now&paged=${encodeURIComponent(name)}` : "/app/on-call?tab=now",
  );
}

/* ---------- Teams ---------- */

/**
 * A team: a name, and the escalation path it is paged through.
 *
 * Until now the only way a team existed was the seed. Everything that pages
 * "the owner" of a service resolves to a team, so a fresh workspace could
 * declare services and route alerts and still have nobody to hand them to —
 * the one thing the product asks for in its first hour.
 *
 * The policy is optional at creation and the list says so, loudly: a team with
 * no path is a team the engine reaches and cannot page.
 */
export async function createTeam(formData: FormData) {
  const current = await requireManager();
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(80),
      policyPathId: uuid.or(z.literal("")).optional(),
      chatChannel: z.string().trim().max(120).optional(),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect("/app/on-call?tab=teams&error=invalid");
  const input = parsed.data;
  const memberIds = formData
    .getAll("members")
    .map(String)
    .filter((x) => uuid.safeParse(x).success);

  const outcome = await withTenant(current.tenant.id, async (tx) => {
    if (input.policyPathId) {
      const [path] = await tx
        .select({ id: escalationPaths.id })
        .from(escalationPaths)
        .where(
          and(
            eq(escalationPaths.tenantId, current.tenant.id),
            eq(escalationPaths.id, input.policyPathId),
          ),
        );
      if (!path) return "invalid" as const;
    }
    const [row] = await tx
      .insert(teams)
      .values({
        tenantId: current.tenant.id,
        name: input.name,
        policyPathId: input.policyPathId || null,
        chatChannel: input.chatChannel || null,
      })
      .onConflictDoNothing({ target: [teams.tenantId, teams.name] })
      .returning({ id: teams.id });
    // The name is unique per workspace, and two teams called Payments are two
    // teams nobody can tell apart on an escalation.
    if (!row) return "taken" as const;
    if (memberIds.length > 0) {
      const own = await tx
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.tenantId, current.tenant.id), inArray(members.id, memberIds)));
      if (own.length > 0)
        await tx.insert(teamMembers).values(
          own.map((m) => ({
            tenantId: current.tenant.id,
            teamId: row.id,
            memberId: m.id,
          })),
        );
    }
    await recordAudit(tx, current, "config", "team.created", {
      name: input.name,
      members: memberIds.length,
    });
    return "created" as const;
  });
  if (outcome !== "created") redirect(`/app/on-call?tab=teams&error=${outcome}`);
  revalidatePath("/app/on-call");
  revalidatePath("/app/services");
  redirect("/app/on-call?tab=teams");
}

/** Rename a team, change the path it is paged through, or its chat channel. */
export async function updateTeam(formData: FormData) {
  const current = await requireManager();
  const parsed = z
    .object({
      id: uuid,
      name: z.string().trim().min(2).max(80),
      policyPathId: uuid.or(z.literal("")).optional(),
      chatChannel: z.string().trim().max(120).optional(),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect("/app/on-call?tab=teams&error=invalid");
  const input = parsed.data;
  const outcome = await withTenant(current.tenant.id, async (tx) => {
    const [team] = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.tenantId, current.tenant.id), eq(teams.id, input.id)));
    if (!team) return "invalid" as const;
    const [clash] = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.tenantId, current.tenant.id), eq(teams.name, input.name)));
    if (clash && clash.id !== input.id) return "taken" as const;
    await tx
      .update(teams)
      .set({
        name: input.name,
        policyPathId: input.policyPathId || null,
        chatChannel: input.chatChannel || null,
        updatedAt: new Date(),
      })
      .where(eq(teams.id, input.id));
    await recordAudit(tx, current, "config", "team.updated", { name: input.name });
    return "saved" as const;
  });
  if (outcome !== "saved") redirect(`/app/on-call?tab=teams&error=${outcome}`);
  revalidatePath("/app/on-call");
  revalidatePath("/app/services");
  redirect("/app/on-call?tab=teams");
}

/** Add or remove one member. A team the engine pages is a team with people in it. */
export async function updateTeamMember(formData: FormData) {
  const current = await requireManager();
  const teamId = uuid.parse(formData.get("teamId"));
  const memberId = uuid.parse(formData.get("memberId"));
  const op = z.enum(["add", "remove"]).parse(formData.get("op"));
  await withTenant(current.tenant.id, async (tx) => {
    const [team] = await tx
      .select({ name: teams.name })
      .from(teams)
      .where(and(eq(teams.tenantId, current.tenant.id), eq(teams.id, teamId)));
    if (!team) return;
    if (op === "add") {
      const [m] = await tx
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.tenantId, current.tenant.id), eq(members.id, memberId)));
      if (!m) return;
      await tx
        .insert(teamMembers)
        .values({ tenantId: current.tenant.id, teamId, memberId })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.memberId, memberId)));
    }
    await recordAudit(tx, current, "config", "team.members_changed", { team: team.name, op });
  });
  revalidatePath("/app/on-call");
  redirect(`/app/on-call?tab=teams&members=${teamId}`);
}

/**
 * Remove a team — only one nothing points at.
 *
 * A service handed to it would silently lose its owner (the foreign key sets
 * it to null) and nobody would be paged for it any more; an escalation rule
 * naming it would page nobody. Both are refused with the count, so the reader
 * knows what to undo first.
 */
export async function deleteTeam(formData: FormData) {
  const current = await requireManager();
  const id = uuid.parse(formData.get("id"));
  const outcome = await withTenant(current.tenant.id, async (tx) => {
    const [team] = await tx
      .select({ name: teams.name })
      .from(teams)
      .where(and(eq(teams.tenantId, current.tenant.id), eq(teams.id, id)));
    if (!team) return "gone" as const;
    const owned = await tx
      .select({ id: services.id })
      .from(services)
      .where(and(eq(services.tenantId, current.tenant.id), eq(services.ownerTeamId, id)))
      .limit(1);
    if (owned.length > 0) return "owns" as const;
    await tx.delete(teams).where(eq(teams.id, id));
    await recordAudit(tx, current, "config", "team.deleted", { name: team.name });
    return "deleted" as const;
  });
  if (outcome === "owns") redirect("/app/on-call?tab=teams&error=owns");
  revalidatePath("/app/on-call");
  revalidatePath("/app/services");
  redirect("/app/on-call?tab=teams");
}
