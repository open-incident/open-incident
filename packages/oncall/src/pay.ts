/**
 * On-call pay — pure arithmetic over who was on call. Each quarter hour a
 * person is on call for a schedule falls into one category, the first that
 * applies: public holiday, weekend, night, standby. Minutes times the hourly
 * rate of the category, in cents, rounded once per line. The rules are the
 * workspace's own; the product computes, a manager publishes.
 */
import { localParts } from "./time";
import {
  sampleOnCall,
  type OverrideLike,
  type RotationLike,
  type ScheduleLike,
  type TurnCache,
} from "./rotation";

export type PayRulesLike = {
  currency: string;
  standbyCents: number;
  nightCents: number;
  weekendCents: number;
  holidayCents: number;
  /** "HH:MM" in the schedule's zone; the window may cross midnight. */
  nightStart: string;
  nightEnd: string;
  /** ISO dates counted as public holidays. */
  holidays: string[];
};

export type PayCategory = "standby" | "night" | "weekend" | "holiday";

export type PayLine = {
  memberId: string;
  scheduleId: string;
  minutes: Record<PayCategory, number>;
  amountCents: number;
};

const STEP_MINUTES = 15;

function minutesOfDay(hhmm: string): number {
  const [h = "0", m = "0"] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/** The category of an instant in a zone: holiday, else weekend, else night, else standby. */
export function categoryAt(
  rules: PayRulesLike,
  at: Date,
  timeZone: string,
  holidays: Set<string>,
): PayCategory {
  const p = localParts(at, timeZone);
  const key = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  if (holidays.has(key)) return "holiday";
  if (p.weekday === 6 || p.weekday === 7) return "weekend";
  const minute = p.hour * 60 + p.minute;
  const start = minutesOfDay(rules.nightStart);
  const end = minutesOfDay(rules.nightEnd);
  const night = start <= end ? minute >= start && minute < end : minute >= start || minute < end;
  return night ? "night" : "standby";
}

export function rateFor(rules: PayRulesLike, category: PayCategory): number {
  return category === "holiday"
    ? rules.holidayCents
    : category === "weekend"
      ? rules.weekendCents
      : category === "night"
        ? rules.nightCents
        : rules.standbyCents;
}

/** Every person's on-call minutes per schedule and category between two instants, priced. */
export function computePay(
  rules: PayRulesLike,
  schedules: Array<{
    id: string;
    schedule: ScheduleLike;
    rotations: RotationLike[];
    overrides: OverrideLike[];
  }>,
  from: Date,
  to: Date,
  stepMinutes = STEP_MINUTES,
): PayLine[] {
  const holidays = new Set(rules.holidays);
  const acc = new Map<string, PayLine>();
  const step = stepMinutes * 60_000;
  for (const s of schedules) {
    const cache: TurnCache = new Map();
    for (let t = from.getTime(); t < to.getTime(); t += step) {
      const at = new Date(t);
      const people = sampleOnCall(s.schedule, s.rotations, s.overrides, at, cache).members;
      if (people.size === 0) continue;
      const category = categoryAt(rules, at, s.schedule.timezone, holidays);
      for (const memberId of people) {
        const key = `${memberId}|${s.id}`;
        const line = acc.get(key) ?? {
          memberId,
          scheduleId: s.id,
          minutes: { standby: 0, night: 0, weekend: 0, holiday: 0 },
          amountCents: 0,
        };
        line.minutes[category] += stepMinutes;
        acc.set(key, line);
      }
    }
  }
  for (const line of acc.values()) {
    const cents = (["standby", "night", "weekend", "holiday"] as PayCategory[]).reduce(
      (sum, c) => sum + (line.minutes[c] / 60) * rateFor(rules, c),
      0,
    );
    line.amountCents = Math.round(cents);
  }
  return [...acc.values()].sort(
    (a, b) => a.memberId.localeCompare(b.memberId) || a.scheduleId.localeCompare(b.scheduleId),
  );
}

/** The first and last instants of a month, "YYYY-MM", in a zone. */
export function monthBounds(period: string, timeZone: string): { from: Date; to: Date } {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const fromLocal = new Date(Date.UTC(y, m - 1, 1, 12));
  const toLocal = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 12));
  // Midnight local: take noon UTC of the day, then shift by the zone's offset at that moment.
  const midnight = (d: Date) => {
    const p = localParts(d, timeZone);
    const guess = new Date(Date.UTC(p.year, p.month - 1, p.day, 0, 0));
    const q = localParts(guess, timeZone);
    const offsetMin = q.hour * 60 + q.minute - 0;
    return new Date(
      guess.getTime() - offsetMin * 60_000 + (q.day !== p.day ? 24 * 60 * 60_000 : 0),
    );
  };
  return { from: midnight(fromLocal), to: midnight(toLocal) };
}

export function formatCents(cents: number, currency: string, locale = "en-GB"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}
