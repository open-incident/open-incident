import type { Translate } from "@/i18n/server";

const DAY = 86_400_000;

/** The calendar day of an instant in a timezone, as `YYYY-MM-DD`. */
function dayIn(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * "02:47", "yesterday", "26 Aug" — the right-hand column of the alert rows.
 *
 * An alert list is read at the hour it pages: today's alerts carry the minute
 * they fired, yesterday's say so, anything older its day. Read in the reader's
 * timezone, the one every other clock of the product uses.
 */
export function whenCompact(t: Translate, date: Date, now: Date = new Date()): string {
  const day = dayIn(date, t.timeZone);
  if (day === dayIn(now, t.timeZone)) return t.fmt.time(date, t.timeZone);
  if (day === dayIn(new Date(now.getTime() - DAY), t.timeZone)) return t("alst.yesterday");
  return date.toLocaleDateString(t.locale.tag, {
    day: "numeric",
    month: "short",
    timeZone: t.timeZone,
  });
}

/** True when the instant falls on the reader's today. */
export function isToday(t: Translate, date: Date, now: Date = new Date()): boolean {
  return dayIn(date, t.timeZone) === dayIn(now, t.timeZone);
}
