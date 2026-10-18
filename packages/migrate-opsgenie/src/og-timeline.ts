/**
 * Opsgenie's schedule arithmetic: the turns of a rotation, cut by its time
 * restriction, then by overrides — the base and final timelines Opsgenie
 * serves. The demo account computes its timeline endpoint with it; the
 * conversion uses it to tell whether a time restriction is expressible.
 *
 * When rotations overlap, the later one in the schedule wins in the final
 * timeline: an upper layer hides the layers under it for as long as it has
 * someone on call. The import reads the result rather than assuming the rule,
 * so an account whose timeline says otherwise is converted for what it says.
 */
import type { OgOverride, OgParticipant, OgPeriod, OgRotation, OgTimeRestriction } from "./types";
import { DAY_NUMBER, partsOf, plusLocalDays, startOfLocalDay, wallClock } from "./zone";

export type Span = { start: number; end: number };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The windows a restriction opens between two instants; null = no restriction. */
export function restrictionWindows(
  r: OgTimeRestriction | null | undefined,
  from: Date,
  to: Date,
  tz: string,
): Span[] | null {
  if (!r) return null;
  const out: Span[] = [];
  const first = startOfLocalDay(new Date(from.getTime() - 8 * DAY), tz);
  if (r.type === "time-of-day") {
    const { startHour, startMin, endHour, endMin } = r.restriction;
    for (let d = first; d.getTime() < to.getTime() + DAY; d = plusLocalDays(d, 1, tz)) {
      const p = partsOf(d, tz);
      const s = wallClock(p.year, p.month, p.day, startHour, startMin, tz);
      let e = wallClock(p.year, p.month, p.day, endHour, endMin, tz);
      if (e.getTime() <= s.getTime()) e = plusLocalDays(e, 1, tz);
      out.push({ start: s.getTime(), end: e.getTime() });
    }
  } else {
    // Weekly ranges: from (startDay, time) to (endDay, time), wrapping past Sunday.
    for (let d = first; d.getTime() < to.getTime() + DAY; d = plusLocalDays(d, 1, tz)) {
      const p = partsOf(d, tz);
      for (const x of r.restrictions) {
        if (DAY_NUMBER[x.startDay] !== p.weekday) continue;
        const s = wallClock(p.year, p.month, p.day, x.startHour, x.startMin, tz);
        let ahead = ((DAY_NUMBER[x.endDay] ?? 1) - p.weekday + 7) % 7;
        const sameDayEnd = x.endHour * 60 + x.endMin <= x.startHour * 60 + x.startMin;
        if (ahead === 0 && sameDayEnd) ahead = 7;
        const endDay = plusLocalDays(d, ahead, tz);
        const q = partsOf(endDay, tz);
        const e = wallClock(q.year, q.month, q.day, x.endHour, x.endMin, tz);
        if (e.getTime() > s.getTime()) out.push({ start: s.getTime(), end: e.getTime() });
      }
    }
  }
  return merge(out.filter((w) => w.end > from.getTime() && w.start < to.getTime()));
}

export function merge(spans: Span[]): Span[] {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

export function intersect(a: Span[], b: Span[]): Span[] {
  const out: Span[] = [];
  for (const x of a)
    for (const y of b) {
      const s = Math.max(x.start, y.start);
      const e = Math.min(x.end, y.end);
      if (e > s) out.push({ start: s, end: e });
    }
  return out.sort((p, q) => p.start - q.start);
}

export function subtract(a: Span, holes: Span[]): Span[] {
  let pieces: Span[] = [a];
  for (const h of holes) {
    const next: Span[] = [];
    for (const p of pieces) {
      if (h.end <= p.start || h.start >= p.end) next.push(p);
      else {
        if (h.start > p.start) next.push({ start: p.start, end: h.start });
        if (h.end < p.end) next.push({ start: h.end, end: p.end });
      }
    }
    pieces = next;
  }
  return pieces;
}

/** Turn duration and the instant turn `k` starts, in the schedule's zone. */
function turnStart(rot: OgRotation, k: number, tz: string): Date {
  const start = new Date(rot.startDate);
  const len = Math.max(1, rot.length ?? 1);
  if (rot.type === "hourly") return new Date(start.getTime() + k * len * HOUR);
  return plusLocalDays(start, k * len * (rot.type === "weekly" ? 7 : 1), tz);
}

function approxTurnMs(rot: OgRotation): number {
  const len = Math.max(1, rot.length ?? 1);
  return rot.type === "hourly" ? len * HOUR : rot.type === "daily" ? len * DAY : len * 7 * DAY;
}

export type RawPeriod = Span & { participant: OgParticipant; turn: number };

/** A rotation's own periods between two instants: its turns, cut by its restriction. */
export function rotationPeriods(rot: OgRotation, tz: string, from: Date, to: Date): RawPeriod[] {
  const n = rot.participants.length;
  if (n === 0) return [];
  const startMs = new Date(rot.startDate).getTime();
  const endMs = rot.endDate ? new Date(rot.endDate).getTime() : Infinity;
  const windows = restrictionWindows(rot.timeRestriction, from, to, tz);
  const out: RawPeriod[] = [];
  let k = Math.max(0, Math.floor((from.getTime() - startMs) / approxTurnMs(rot)) - 1);
  for (let guard = 0; guard < 5000; guard++, k++) {
    const s = turnStart(rot, k, tz).getTime();
    const e = turnStart(rot, k + 1, tz).getTime();
    if (s >= to.getTime() || s >= endMs) break;
    if (e <= from.getTime()) continue;
    const turn: Span = {
      start: Math.max(s, from.getTime(), startMs),
      end: Math.min(e, to.getTime(), endMs),
    };
    if (turn.end <= turn.start) continue;
    const participant = rot.participants[k % n]!;
    const pieces = windows ? intersect([turn], windows) : [turn];
    for (const p of pieces) out.push({ ...p, participant, turn: k });
  }
  return out;
}

export type TimelinePeriod = Span & {
  type: "default" | "override";
  recipient: { type: "user" | "none"; id?: string; name?: string };
};

export type ComputedTimeline = {
  base: Array<{ id: string; name: string; order: number; periods: TimelinePeriod[] }>;
  final: Array<{ id: string; name: string; order: number; periods: TimelinePeriod[] }>;
};

/**
 * Base and final timelines of a schedule: base = each rotation alone; final =
 * overrides applied, then every rotation trimmed by the ones after it.
 */
export function computeTimeline(
  rotations: OgRotation[],
  overrides: OgOverride[],
  tz: string,
  from: Date,
  to: Date,
  usersById: Map<string, { username: string }>,
): ComputedTimeline {
  const recipientOf = (p: OgParticipant): TimelinePeriod["recipient"] =>
    p.type === "user"
      ? { type: "user", id: p.id, name: usersById.get(p.id)?.username ?? p.username }
      : { type: "none" };
  const base = rotations.map((rot, i) => ({
    id: rot.id,
    name: rot.name,
    order: i + 1,
    periods: rotationPeriods(rot, tz, from, to).map((p): TimelinePeriod => ({
      start: p.start,
      end: p.end,
      type: "default",
      recipient: recipientOf(p.participant),
    })),
  }));
  // Overrides replace the rotation's own periods where they apply.
  const withOverrides = base.map((r) => {
    const mine = overrides.filter(
      (o) => !o.rotations || o.rotations.length === 0 || o.rotations.some((x) => x.id === r.id),
    );
    const holes = mine.map((o) => ({
      start: new Date(o.startDate).getTime(),
      end: new Date(o.endDate).getTime(),
    }));
    const periods: TimelinePeriod[] = [];
    for (const p of r.periods)
      for (const piece of subtract(p, holes)) periods.push({ ...p, ...piece });
    for (const o of mine) {
      // An override only covers the rotation where the rotation is active.
      const span = {
        start: Math.max(new Date(o.startDate).getTime(), from.getTime()),
        end: Math.min(new Date(o.endDate).getTime(), to.getTime()),
      };
      const active = intersect(
        [span],
        merge(r.periods.map((p) => ({ start: p.start, end: p.end }))),
      );
      for (const a of active)
        periods.push({
          ...a,
          type: "override",
          recipient:
            o.user.type === "user"
              ? {
                  type: "user",
                  id: o.user.id,
                  name: (o.user.id && usersById.get(o.user.id)?.username) || o.user.username,
                }
              : { type: "none" },
        });
    }
    return { ...r, periods: periods.sort((a, b) => a.start - b.start) };
  });
  // The later rotation wins where both have someone.
  const final = withOverrides.map((r, i) => {
    const above = merge(
      withOverrides
        .slice(i + 1)
        .flatMap((x) => x.periods.filter((p) => p.recipient.type === "user")),
    );
    const periods: TimelinePeriod[] = [];
    for (const p of r.periods)
      for (const piece of subtract(p, above)) periods.push({ ...p, ...piece });
    return { ...r, periods };
  });
  return { base, final };
}

/** The timeline as Opsgenie's API serialises it. */
export function serialiseTimeline(
  t: ComputedTimeline,
  from: Date,
  to: Date,
): {
  startDate: string;
  endDate: string;
  finalTimeline: {
    rotations: Array<{ id: string; name: string; order: number; periods: OgPeriod[] }>;
  };
  baseTimeline: {
    rotations: Array<{ id: string; name: string; order: number; periods: OgPeriod[] }>;
  };
} {
  const ser = (rows: ComputedTimeline["final"]) =>
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      order: r.order,
      periods: r.periods.map((p): OgPeriod => ({
        startDate: new Date(p.start).toISOString(),
        endDate: new Date(p.end).toISOString(),
        type: p.type,
        recipient: p.recipient,
      })),
    }));
  return {
    startDate: from.toISOString(),
    endDate: to.toISOString(),
    finalTimeline: { rotations: ser(t.final) },
    baseTimeline: { rotations: ser(t.base) },
  };
}
