/** Read side of on-call: schedules with who is on call, the calendar shifts, the paths and their versions. */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  alertRoutes,
  coverRequests,
  escalationPathVersions,
  escalationPaths,
  members,
  rotations,
  scheduleOverrides,
  schedules,
  workingHoursSets,
  type EscalationGraph,
  type Tx,
} from "@openincident/db";
import {
  COVERAGE_HORIZON_DAYS,
  coverageOf,
  onCallAt,
  shiftsBetween,
  type Shift,
} from "@openincident/oncall";

export type MemberLite = { id: string; name: string; email: string };

export async function listSchedules(tx: Tx, tenantId: string) {
  return tx
    .select()
    .from(schedules)
    .where(eq(schedules.tenantId, tenantId))
    .orderBy(asc(schedules.createdAt));
}

export async function activeMembers(tx: Tx, tenantId: string): Promise<MemberLite[]> {
  return tx
    .select({ id: members.id, name: members.name, email: members.email })
    .from(members)
    .where(and(eq(members.tenantId, tenantId), eq(members.status, "active")))
    .orderBy(asc(members.name));
}

export type ScheduleDetail = NonNullable<Awaited<ReturnType<typeof getSchedule>>>;

/** A schedule with its rotations, overrides in the window, who is on call now and the shifts of the window. */
export async function getSchedule(
  tx: Tx,
  tenantId: string,
  id: string,
  window: { from: Date; to: Date },
  now = new Date(),
) {
  const [sched] = await tx
    .select()
    .from(schedules)
    .where(and(eq(schedules.tenantId, tenantId), eq(schedules.id, id)));
  if (!sched) return null;
  const rots = await tx
    .select()
    .from(rotations)
    .where(eq(rotations.scheduleId, sched.id))
    .orderBy(asc(rotations.position));
  const ovs = await tx
    .select()
    .from(scheduleOverrides)
    .where(eq(scheduleOverrides.scheduleId, sched.id));
  const current = onCallAt(sched, rots, ovs, now);
  const shifts: Record<string, Shift[]> = {};
  for (const r of rots) shifts[r.id] = shiftsBetween(sched, r, ovs, window.from, window.to);
  const open = await tx
    .select()
    .from(coverRequests)
    .where(and(eq(coverRequests.scheduleId, sched.id), eq(coverRequests.status, "open")))
    .orderBy(desc(coverRequests.createdAt));
  return { schedule: sched, rotations: rots, overrides: ovs, current, shifts, openCovers: open };
}

/** Where the member is on call right now, across published schedules — the rail's card. */
export async function myOnCall(tx: Tx, tenantId: string, memberId: string, now = new Date()) {
  const scheds = await tx
    .select()
    .from(schedules)
    .where(and(eq(schedules.tenantId, tenantId), eq(schedules.status, "published")));
  for (const s of scheds) {
    const rots = await tx.select().from(rotations).where(eq(rotations.scheduleId, s.id));
    const ovs = await tx
      .select()
      .from(scheduleOverrides)
      .where(eq(scheduleOverrides.scheduleId, s.id));
    const hit = onCallAt(s, rots, ovs, now).find((x) => x.memberId === memberId);
    if (hit) return { schedule: s, rotationName: hit.rotationName, until: hit.until };
  }
  return null;
}

/** The member's next own shift on a schedule (for "cover me"), looking two weeks ahead. */
export function nextOwnShift(detail: ScheduleDetail, memberId: string, now: Date): Shift | null {
  const all = Object.values(detail.shifts)
    .flat()
    .filter((s) => s.memberId === memberId && s.endAt.getTime() > now.getTime())
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return all[0] ?? null;
}

export async function listPaths(tx: Tx, tenantId: string) {
  const paths = await tx
    .select()
    .from(escalationPaths)
    .where(eq(escalationPaths.tenantId, tenantId))
    .orderBy(asc(escalationPaths.name));
  const ids = paths.map((p) => p.id);
  const versions = ids.length
    ? await tx
        .select()
        .from(escalationPathVersions)
        .where(inArray(escalationPathVersions.pathId, ids))
        .orderBy(desc(escalationPathVersions.version))
    : [];
  const routes = await tx
    .select({ id: alertRoutes.id, name: alertRoutes.name, pathId: alertRoutes.escalationPathId })
    .from(alertRoutes)
    .where(eq(alertRoutes.tenantId, tenantId));
  return paths.map((p) => {
    const vs = versions.filter((v) => v.pathId === p.id);
    const current = vs.find((v) => v.id === p.currentVersionId) ?? null;
    return {
      path: p,
      versions: vs,
      current,
      routes: routes.filter((r) => r.pathId === p.id),
      graph: (p.draftGraph ?? current?.graph ?? { start: null, nodes: [] }) as EscalationGraph,
      hasDraft: Boolean(p.draftGraph),
    };
  });
}

export async function targetLabels(tx: Tx, tenantId: string) {
  const [scheds, mems, sets] = await Promise.all([
    tx
      .select({ id: schedules.id, name: schedules.name })
      .from(schedules)
      .where(eq(schedules.tenantId, tenantId)),
    activeMembers(tx, tenantId),
    tx.select().from(workingHoursSets).where(eq(workingHoursSets.tenantId, tenantId)),
  ]);
  return { schedules: scheds, members: mems, workingHours: sets };
}

export const TIMEZONES = [
  "Europe/Paris",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "Europe/Warsaw",
  "Europe/Lisbon",
  "Europe/Zurich",
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Australia/Sydney",
];

/** The next sixty days of a schedule: expected hours with nobody, as facts to show and to fix. */
export function scheduleCoverage(detail: ScheduleDetail, now = new Date()) {
  const to = new Date(now.getTime() + COVERAGE_HORIZON_DAYS * 86_400_000);
  return coverageOf(detail.schedule, detail.rotations, detail.overrides, now, to);
}
