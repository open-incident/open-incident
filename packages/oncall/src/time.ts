/**
 * Timezone arithmetic without a library: the pieces the rotation math and the
 * working-hours condition need, built on Intl. Every function takes and
 * returns real instants; "local" only ever means the schedule's own zone.
 */

export type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    fmtCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** The wall-clock parts of an instant in a zone; weekday is ISO (1 = Monday). */
export function localParts(at: Date, timeZone: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(at)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday ?? "Mon"] ?? 1,
  };
}

/** The offset (ms) of a zone at an instant: local wall clock minus UTC. */
export function zoneOffsetMs(at: Date, timeZone: string): number {
  const p = localParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
  const truncated = Math.floor(at.getTime() / 60_000) * 60_000;
  return asUtc - truncated;
}

/** The instant of a wall-clock time (y, m, d, "HH:MM") in a zone. Handles DST by two passes. */
export function zonedTime(
  year: number,
  month: number,
  day: number,
  hhmm: string,
  timeZone: string,
): Date {
  const [hh, mm] = hhmm.split(":").map(Number) as [number, number];
  const guess = Date.UTC(year, month - 1, day, hh, mm, 0);
  const first = new Date(guess - zoneOffsetMs(new Date(guess), timeZone));
  // A second pass settles instants that straddle a DST change.
  return new Date(guess - zoneOffsetMs(first, timeZone));
}

/** Local midnight-anchored day key "YYYY-MM-DD" of an instant in a zone. */
export function localDayKey(at: Date, timeZone: string): string {
  const p = localParts(at, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Adds whole local days to a (year, month, day) triple. */
export function addDays(
  year: number,
  month: number,
  day: number,
  days: number,
): [number, number, number] {
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

/** Minutes since local midnight of "HH:MM". */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** Whether an instant falls inside a working-hours set. Overnight ranges (15:00 → 00:00) wrap. */
export function inWorkingHours(
  at: Date,
  set: { timezone: string; days: number[]; startTime: string; endTime: string },
): boolean {
  const p = localParts(at, set.timezone);
  const now = p.hour * 60 + p.minute;
  const start = minutesOf(set.startTime);
  const end = minutesOf(set.endTime) === 0 ? 24 * 60 : minutesOf(set.endTime);
  if (end > start) return set.days.includes(p.weekday) && now >= start && now < end;
  // Wraps past midnight: the evening part belongs to the day it starts on.
  const yesterday = p.weekday === 1 ? 7 : p.weekday - 1;
  return (
    (set.days.includes(p.weekday) && now >= start) || (set.days.includes(yesterday) && now < end)
  );
}

/** The next instant the set opens, at or after `at`. Searches up to two weeks ahead. */
export function nextWorkingHoursStart(
  at: Date,
  set: { timezone: string; days: number[]; startTime: string; endTime: string },
): Date {
  if (inWorkingHours(at, set)) return at;
  const p = localParts(at, set.timezone);
  for (let i = 0; i < 15; i++) {
    const [y, m, d] = addDays(p.year, p.month, p.day, i);
    const candidate = zonedTime(y, m, d, set.startTime, set.timezone);
    const weekday = localParts(candidate, set.timezone).weekday;
    if (candidate.getTime() >= at.getTime() && set.days.includes(weekday)) return candidate;
  }
  return at;
}
