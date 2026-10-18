/**
 * Wall-clock arithmetic in a time zone, on Intl alone — what reading an
 * Opsgenie schedule (local start times, weekday restrictions) needs. Kept here
 * rather than borrowed from the on-call package so the demo account and the
 * pure conversions load without a database.
 */

export type Parts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
};

const cache = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function partsOf(at: Date, timeZone: string): Parts {
  let f = cache.get(timeZone);
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
    cache.set(timeZone, f);
  }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(at)) p[x.type] = x.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    weekday: WEEKDAYS[p.weekday ?? "Mon"] ?? 1,
  };
}

function offsetMs(at: Date, timeZone: string): number {
  const p = partsOf(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
  return asUtc - Math.floor(at.getTime() / 60_000) * 60_000;
}

/** The instant of a local wall-clock time; two passes settle a DST change. */
export function wallClock(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const first = new Date(guess - offsetMs(new Date(guess), timeZone));
  return new Date(guess - offsetMs(first, timeZone));
}

/** The same local time, `days` local days later. */
export function plusLocalDays(at: Date, days: number, timeZone: string): Date {
  const p = partsOf(at, timeZone);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return wallClock(
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    p.hour,
    p.minute,
    timeZone,
  );
}

/** Local midnight of the day containing `at`. */
export function startOfLocalDay(at: Date, timeZone: string): Date {
  const p = partsOf(at, timeZone);
  return wallClock(p.year, p.month, p.day, 0, 0, timeZone);
}

export const hhmm = (h: number, m: number) =>
  `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

export const DAY_NUMBER: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};
