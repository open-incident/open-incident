/**
 * Who is on call — pure functions over a schedule's rotations and overrides.
 *
 * A rotation hands over at `handoverTime` (schedule zone) every day / week /
 * month, or covers weekends only; its ordered members take turns, starting
 * from `effectiveFrom`. Active hours narrow the coverage inside each day.
 * Overrides win over the rotation; a null-member override is an assumed gap.
 */
import { addDays, localParts, minutesOf, zonedTime } from "./time";

export type RotationLike = {
  id: string;
  name: string;
  interval: "daily" | "weekly" | "monthly" | "weekend";
  handoverDay: number;
  activeStart: string | null;
  activeEnd: string | null;
  memberIds: string[];
  effectiveFrom: Date;
  position: number;
};

export type OverrideLike = {
  id: string;
  rotationId: string | null;
  memberId: string | null;
  startAt: Date;
  endAt: Date;
  reason: string;
};

export type ScheduleLike = { timezone: string; handoverTime: string };

/** One shift: who, on which rotation, between two instants. */
export type Shift = {
  rotationId: string;
  rotationName: string;
  memberId: string | null;
  startAt: Date;
  endAt: Date;
  override: boolean;
  overrideId?: string;
};

const DAY = 86_400_000;

/** The shift boundaries of a rotation around an instant: [start, end) of the turn containing `at`. */
export function turnBounds(
  schedule: ScheduleLike,
  rotation: RotationLike,
  at: Date,
): { start: Date; end: Date; index: number } {
  const tz = schedule.timezone;
  const p = localParts(at, tz);
  const handover = schedule.handoverTime;
  // Anchor: the handover instant of the local day containing `at` (or the previous one if before it).
  let [y, m, d] = [p.year, p.month, p.day];
  let start = zonedTime(y, m, d, handover, tz);
  if (start.getTime() > at.getTime()) {
    [y, m, d] = addDays(y, m, d, -1);
    start = zonedTime(y, m, d, handover, tz);
  }
  if (rotation.interval === "daily") {
    const [ny, nm, nd] = addDays(y, m, d, 1);
    const end = zonedTime(ny, nm, nd, handover, tz);
    const index = Math.floor((start.getTime() - anchorFor(schedule, rotation).getTime()) / DAY);
    return { start, end, index: Math.round(index) };
  }
  if (rotation.interval === "weekly" || rotation.interval === "weekend") {
    // Walk back to the handover weekday.
    let wd = localParts(start, tz).weekday;
    let back = (wd - rotation.handoverDay + 7) % 7;
    if (rotation.interval === "weekend") back = (wd - 6 + 7) % 7; // weekends hand over on Saturday
    [y, m, d] = addDays(y, m, d, -back);
    start = zonedTime(y, m, d, handover, tz);
    wd = localParts(start, tz).weekday;
    const [ny, nm, nd] = addDays(y, m, d, 7);
    const end = zonedTime(ny, nm, nd, handover, tz);
    const index = Math.round(
      (start.getTime() - anchorFor(schedule, rotation).getTime()) / (7 * DAY),
    );
    return { start, end, index };
  }
  // monthly: turns change on the handover day-of-month = effectiveFrom's day
  const eff = localParts(rotation.effectiveFrom, tz);
  let sy = p.year;
  let sm = p.month;
  let s = zonedTime(sy, sm, Math.min(eff.day, daysInMonth(sy, sm)), handover, tz);
  if (s.getTime() > at.getTime()) {
    sm -= 1;
    if (sm === 0) {
      sm = 12;
      sy -= 1;
    }
    s = zonedTime(sy, sm, Math.min(eff.day, daysInMonth(sy, sm)), handover, tz);
  }
  let ey = sy;
  let em = sm + 1;
  if (em === 13) {
    em = 1;
    ey += 1;
  }
  const e = zonedTime(ey, em, Math.min(eff.day, daysInMonth(ey, em)), handover, tz);
  const index = (sy - eff.year) * 12 + (sm - eff.month);
  return { start: s, end: e, index };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The instant the rotation's first turn started: the handover at/before effectiveFrom, aligned on the handover day. */
function anchorFor(schedule: ScheduleLike, rotation: RotationLike): Date {
  const tz = schedule.timezone;
  const p = localParts(rotation.effectiveFrom, tz);
  let [y, m, d] = [p.year, p.month, p.day];
  let start = zonedTime(y, m, d, schedule.handoverTime, tz);
  if (start.getTime() > rotation.effectiveFrom.getTime()) {
    [y, m, d] = addDays(y, m, d, -1);
    start = zonedTime(y, m, d, schedule.handoverTime, tz);
  }
  if (rotation.interval === "weekly" || rotation.interval === "weekend") {
    const wd = localParts(start, tz).weekday;
    const target = rotation.interval === "weekend" ? 6 : rotation.handoverDay;
    const back = (wd - target + 7) % 7;
    [y, m, d] = addDays(y, m, d, -back);
    start = zonedTime(y, m, d, schedule.handoverTime, tz);
  }
  return start;
}

/** Whether the rotation is active at an instant (active hours, weekend-only). */
export function rotationActiveAt(
  schedule: ScheduleLike,
  rotation: RotationLike,
  at: Date,
): boolean {
  const p = localParts(at, schedule.timezone);
  if (rotation.interval === "weekend") {
    // Saturday and Sunday, plus Friday evening / Monday morning inside active hours if set overnight.
    if (p.weekday !== 6 && p.weekday !== 7) return false;
  }
  if (!rotation.activeStart || !rotation.activeEnd) return true;
  const now = p.hour * 60 + p.minute;
  const s = minutesOf(rotation.activeStart);
  const e = minutesOf(rotation.activeEnd) === 0 ? 1440 : minutesOf(rotation.activeEnd);
  return e > s ? now >= s && now < e : now >= s || now < e;
}

/** The member the rotation itself (no override) puts on call at an instant. */
export function rotationMemberAt(
  schedule: ScheduleLike,
  rotation: RotationLike,
  at: Date,
): string | null {
  if (rotation.memberIds.length === 0) return null;
  if (at.getTime() < rotation.effectiveFrom.getTime()) return null;
  if (!rotationActiveAt(schedule, rotation, at)) return null;
  const { index } = turnBounds(schedule, rotation, at);
  const n = rotation.memberIds.length;
  return rotation.memberIds[((index % n) + n) % n] ?? null;
}

/** The override in force for a rotation at an instant, most recent first. */
export function overrideAt(
  overrides: OverrideLike[],
  rotationId: string,
  at: Date,
): OverrideLike | null {
  const t = at.getTime();
  const hits = overrides
    .filter(
      (o) =>
        (o.rotationId === null || o.rotationId === rotationId) &&
        o.startAt.getTime() <= t &&
        o.endAt.getTime() > t,
    )
    .sort((a, b) => b.startAt.getTime() - a.startAt.getTime());
  return hits[0] ?? null;
}

/** Who is on call now, per rotation — the resolved truth the escalation engine pages. */
export function onCallAt(
  schedule: ScheduleLike,
  rotations: RotationLike[],
  overrides: OverrideLike[],
  at: Date,
): Array<{
  rotationId: string;
  rotationName: string;
  memberId: string | null;
  override: boolean;
  until: Date;
}> {
  return rotations
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((r) => {
      const ov = overrideAt(overrides, r.id, at);
      const active = rotationActiveAt(schedule, r, at);
      if (ov)
        return {
          rotationId: r.id,
          rotationName: r.name,
          memberId: ov.memberId,
          override: true,
          until: ov.endAt,
        };
      if (!active) return null;
      const member = rotationMemberAt(schedule, r, at);
      const { end } = turnBounds(schedule, r, at);
      return {
        rotationId: r.id,
        rotationName: r.name,
        memberId: member,
        override: false,
        until: activeEndAfter(schedule, r, at, end),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/** Where the current coverage ends: the active-hours end today, or the turn end for 24/7. */
function activeEndAfter(
  schedule: ScheduleLike,
  rotation: RotationLike,
  at: Date,
  turnEnd: Date,
): Date {
  if (!rotation.activeStart || !rotation.activeEnd) return turnEnd;
  const p = localParts(at, schedule.timezone);
  let end = zonedTime(p.year, p.month, p.day, rotation.activeEnd, schedule.timezone);
  if (end.getTime() <= at.getTime()) {
    const [y, m, d] = addDays(p.year, p.month, p.day, 1);
    end = zonedTime(y, m, d, rotation.activeEnd, schedule.timezone);
  }
  return end.getTime() < turnEnd.getTime() ? end : turnEnd;
}

/** The member who takes over from the current one on a rotation (the "next on-call" target mode). */
export function nextOnCall(
  schedule: ScheduleLike,
  rotation: RotationLike,
  overrides: OverrideLike[],
  at: Date,
): string | null {
  const { end } = turnBounds(schedule, rotation, at);
  const probe = new Date(end.getTime() + 60_000);
  const ov = overrideAt(overrides, rotation.id, probe);
  return ov ? ov.memberId : rotationMemberAt(schedule, rotation, probe);
}

/**
 * The shifts of a rotation between two instants, cut at every handover and
 * override edge — what the calendar draws and what iCal exports.
 */
export function shiftsBetween(
  schedule: ScheduleLike,
  rotation: RotationLike,
  overrides: OverrideLike[],
  from: Date,
  to: Date,
): Shift[] {
  const edges = new Set<number>([from.getTime(), to.getTime()]);
  // Handovers
  let cursor = from;
  for (let guard = 0; guard < 400 && cursor.getTime() < to.getTime(); guard++) {
    const { end } = turnBounds(schedule, rotation, cursor);
    if (end.getTime() > from.getTime() && end.getTime() < to.getTime()) edges.add(end.getTime());
    cursor = new Date(end.getTime() + 1000);
  }
  // Active-hours edges, day by day
  if (rotation.activeStart && rotation.activeEnd) {
    const p = localParts(from, schedule.timezone);
    for (let i = -1; i < Math.ceil((to.getTime() - from.getTime()) / DAY) + 1; i++) {
      const [y, m, d] = addDays(p.year, p.month, p.day, i);
      for (const hhmm of [rotation.activeStart, rotation.activeEnd]) {
        const e = zonedTime(y, m, d, hhmm, schedule.timezone).getTime();
        if (e > from.getTime() && e < to.getTime()) edges.add(e);
      }
    }
  }
  for (const o of overrides) {
    if (o.rotationId !== null && o.rotationId !== rotation.id) continue;
    for (const e of [o.startAt.getTime(), o.endAt.getTime()])
      if (e > from.getTime() && e < to.getTime()) edges.add(e);
  }
  const sorted = [...edges].sort((a, b) => a - b);
  const out: Shift[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = new Date(sorted[i]!);
    const e = new Date(sorted[i + 1]!);
    const mid = new Date((s.getTime() + e.getTime()) / 2);
    const ov = overrideAt(overrides, rotation.id, mid);
    if (ov) {
      out.push({
        rotationId: rotation.id,
        rotationName: rotation.name,
        memberId: ov.memberId,
        startAt: s,
        endAt: e,
        override: true,
        overrideId: ov.id,
      });
      continue;
    }
    if (!rotationActiveAt(schedule, rotation, mid)) continue;
    const member = rotationMemberAt(schedule, rotation, mid);
    const last = out[out.length - 1];
    if (last && !last.override && last.memberId === member && last.endAt.getTime() === s.getTime())
      last.endAt = e;
    else
      out.push({
        rotationId: rotation.id,
        rotationName: rotation.name,
        memberId: member,
        startAt: s,
        endAt: e,
        override: false,
      });
  }
  return out;
}

/* ---------- Sampling many instants: turn bounds reused across a turn ---------- */

export type TurnCache = Map<string, { start: number; end: number; index: number }>;

/**
 * Who is on call at an instant, for callers that sample thousands of instants
 * (coverage, pay). Same answer as `onCallAt`, but each rotation's turn bounds
 * are computed once per turn instead of once per sample, and the wall clock
 * is read once per sample for every rotation.
 */
export function sampleOnCall(
  schedule: ScheduleLike,
  rotations: RotationLike[],
  overrides: OverrideLike[],
  at: Date,
  cache: TurnCache,
): { expected: boolean; members: Set<string> } {
  const t = at.getTime();
  const p = localParts(at, schedule.timezone);
  const members = new Set<string>();
  let expected = false;
  for (const r of rotations) {
    // Active window, from the shared wall clock.
    let active = true;
    if (r.interval === "weekend" && p.weekday !== 6 && p.weekday !== 7) active = false;
    if (active && r.activeStart && r.activeEnd) {
      const now = p.hour * 60 + p.minute;
      const s = minutesOf(r.activeStart);
      const e = minutesOf(r.activeEnd) === 0 ? 1440 : minutesOf(r.activeEnd);
      active = e > s ? now >= s && now < e : now >= s || now < e;
    }
    const ov = overrideAt(overrides, r.id, at);
    if (ov) {
      expected = true;
      if (ov.memberId) members.add(ov.memberId);
      continue;
    }
    if (!active) continue;
    expected = true;
    if (r.memberIds.length === 0 || t < r.effectiveFrom.getTime()) continue;
    let turn = cache.get(r.id);
    if (!turn || t < turn.start || t >= turn.end) {
      const b = turnBounds(schedule, r, at);
      turn = { start: b.start.getTime(), end: b.end.getTime(), index: b.index };
      cache.set(r.id, turn);
    }
    const n = r.memberIds.length;
    const member = r.memberIds[((turn.index % n) + n) % n];
    if (member) members.add(member);
  }
  return { expected, members };
}
