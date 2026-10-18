/**
 * The arithmetic behind the On-call grid: which slot of a rotation a cell of
 * the week (or of the week-ends ahead) stands for, and who holds it.
 *
 * A cell is a rotation's own window on one date of the schedule's calendar —
 * its active hours when it has some (09:00 – 21:00), else one handover to the
 * next. Overriding a cell writes an override on exactly that window: never
 * the whole week a weekly turn would span, never the reader's midnight-to-
 * midnight day.
 */
import {
  addDays,
  localParts,
  zonedTime,
  type RotationLike,
  type ScheduleLike,
  type Shift,
} from "@openincident/oncall";

export type Day = [number, number, number];

export const pad = (n: number) => String(n).padStart(2, "0");
export const dayKey = (d: Day) => `${d[0]}-${pad(d[1])}-${pad(d[2])}`;

export function parseDayKey(key: string): Day | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** ISO weekday (1 = Monday) of a calendar date. */
export function weekdayOf(d: Day): number {
  const w = new Date(Date.UTC(d[0], d[1] - 1, d[2])).getUTCDay();
  return w === 0 ? 7 : w;
}

/** The seven dates of the week grid, today first, in the reader's zone. */
export function weekDays(now: Date, timeZone: string): Day[] {
  const p = localParts(now, timeZone);
  return Array.from({ length: 7 }, (_, i) => addDays(p.year, p.month, p.day, i));
}

/**
 * The Saturdays and Sundays of the next `weekends` week-ends, the current one
 * included when today is part of it.
 */
export function weekendDays(now: Date, timeZone: string, weekends = 8): Day[] {
  const p = localParts(now, timeZone);
  const today: Day = [p.year, p.month, p.day];
  const w = weekdayOf(today);
  // On a Sunday the week-end under way still counts, Saturday included.
  const back = w === 7 ? -1 : (6 - w + 7) % 7;
  const saturday = addDays(today[0], today[1], today[2], back);
  const out: Day[] = [];
  for (let i = 0; i < weekends; i++) {
    out.push(addDays(saturday[0], saturday[1], saturday[2], i * 7));
    out.push(addDays(saturday[0], saturday[1], saturday[2], i * 7 + 1));
  }
  return out;
}

/** The window of a rotation on a date of the schedule's calendar; null when it is not on that day. */
export function slotOf(
  schedule: ScheduleLike,
  rotation: Pick<RotationLike, "interval" | "activeStart" | "activeEnd">,
  d: Day,
): { from: Date; to: Date } | null {
  const tz = schedule.timezone;
  const w = weekdayOf(d);
  if (rotation.interval === "weekend" && w !== 6 && w !== 7) return null;
  const next = addDays(d[0], d[1], d[2], 1);
  if (rotation.activeStart && rotation.activeEnd) {
    const from = zonedTime(d[0], d[1], d[2], rotation.activeStart, tz);
    let to = zonedTime(d[0], d[1], d[2], rotation.activeEnd, tz);
    if (to.getTime() <= from.getTime())
      to = zonedTime(next[0], next[1], next[2], rotation.activeEnd, tz);
    return { from, to };
  }
  return {
    from: zonedTime(d[0], d[1], d[2], schedule.handoverTime, tz),
    to: zonedTime(next[0], next[1], next[2], schedule.handoverTime, tz),
  };
}

export type Cell = {
  /** Who holds most of the slot — null member: an override with nobody. */
  shift: Shift | null;
  /** Every override that touches the slot, so each one can be taken back from here. */
  overrides: Array<{ id: string; memberId: string | null; startAt: Date; endAt: Date }>;
  from: Date;
  to: Date;
};

/** What a cell shows: the shift covering most of the slot, and the overrides inside it. */
export function cellOf(
  shifts: Shift[],
  overrides: Array<{
    id: string;
    rotationId: string | null;
    memberId: string | null;
    startAt: Date;
    endAt: Date;
  }>,
  rotationId: string,
  slot: { from: Date; to: Date },
): Cell {
  const a = slot.from.getTime();
  const b = slot.to.getTime();
  let best: Shift | null = null;
  let widest = 0;
  for (const s of shifts) {
    const overlap = Math.min(s.endAt.getTime(), b) - Math.max(s.startAt.getTime(), a);
    if (overlap > widest) {
      widest = overlap;
      best = s;
    }
  }
  const touching = overrides
    .filter(
      (o) =>
        (o.rotationId === null || o.rotationId === rotationId) &&
        o.startAt.getTime() < b &&
        o.endAt.getTime() > a,
    )
    .sort((x, y) => x.startAt.getTime() - y.startAt.getTime())
    .map((o) => ({ id: o.id, memberId: o.memberId, startAt: o.startAt, endAt: o.endAt }));
  return { shift: best, overrides: touching, from: slot.from, to: slot.to };
}

/** "Tue 16" — the grid's column heads, in the reader's language and zone. */
export function dayHead(d: Day, localeTag: string): string {
  return new Date(Date.UTC(d[0], d[1] - 1, d[2], 12)).toLocaleDateString(localeTag, {
    weekday: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "Oct" — the month band above the week-ends. */
export function monthHead(d: Day, localeTag: string): string {
  return new Date(Date.UTC(d[0], d[1] - 1, d[2], 12)).toLocaleDateString(localeTag, {
    month: "long",
    timeZone: "UTC",
  });
}

/** "Wed 09:00" within the week, "29 Oct · 09:00" beyond — the "Next:" line. */
export function nextWhen(at: Date, now: Date, localeTag: string, timeZone: string): string {
  const time = at.toLocaleTimeString(localeTag, { hour: "2-digit", minute: "2-digit", timeZone });
  if (at.getTime() - now.getTime() < 6 * 86_400_000)
    return `${at.toLocaleDateString(localeTag, { weekday: "short", timeZone })} ${time}`;
  return `${at.toLocaleDateString(localeTag, { day: "numeric", month: "short", timeZone })} · ${time}`;
}

/** "Sun 21:00" — an instant by its weekday, for the cover banner. */
export function dayTime(at: Date, localeTag: string, timeZone: string): string {
  const time = at.toLocaleTimeString(localeTag, { hour: "2-digit", minute: "2-digit", timeZone });
  return `${at.toLocaleDateString(localeTag, { weekday: "short", timeZone })} ${time}`;
}

/** "Jordan" from "Jordan Bakker" — the grid and the chain speak in first names. */
export function firstName(name: string): string {
  return name.split(/\s+/).filter(Boolean)[0] ?? name;
}

/**
 * "night", "day · EU" — a rotation's name inside a sentence. An all-caps word
 * (EU, US) stays as it is; only a capitalised first word is lowered.
 */
export function inSentence(name: string): string {
  if (name.length > 1 && name[1] === name[1]!.toLowerCase())
    return name[0]!.toLowerCase() + name.slice(1);
  return name;
}

/** A rotation's hours, as the grid's row head says them: "09:00 – 21:00", or null for 24/7. */
export function hoursOf(rotation: Pick<RotationLike, "activeStart" | "activeEnd">): string | null {
  return rotation.activeStart && rotation.activeEnd
    ? `${rotation.activeStart} – ${rotation.activeEnd}`
    : null;
}

/** Whether the rotations of a schedule hand the pager to each other around the clock. */
export function followsTheSun(
  rotations: Array<Pick<RotationLike, "activeStart" | "activeEnd">>,
): boolean {
  if (rotations.length < 2) return false;
  if (!rotations.every((r) => r.activeStart && r.activeEnd)) return false;
  return rotations.every((r) => rotations.some((o) => o !== r && o.activeStart === r.activeEnd));
}
