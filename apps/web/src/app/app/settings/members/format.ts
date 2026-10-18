/**
 * The short relative times of the People & access screens — "now",
 * "12 min ago", "2 h ago", "yesterday", "3 days ago" — and the short date
 * after a week ("Sep 12"). Shared by Members, Single sign-on and
 * Provisioning; works with the server's `getT()` and the client's `useT()`.
 */

import type { MessageKey } from "@/i18n/dictionaries/en";
import type { MessageParams } from "@/i18n/dictionary";

export type PeopleT = {
  (key: MessageKey, params?: MessageParams): string;
  locale: { code: string; tag: string };
  timeZone: string;
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function shortDate(t: Pick<PeopleT, "locale" | "timeZone">, date: Date): string {
  // English reads "Sep 12"; the other languages their own order ("12 sept.").
  const tag = t.locale.code === "en" ? "en-US" : t.locale.tag;
  return date.toLocaleDateString(tag, { month: "short", day: "numeric", timeZone: t.timeZone });
}

export function ago(t: PeopleT, date: Date, now = Date.now()): string {
  const diff = Math.max(0, now - date.getTime());
  if (diff < MIN) return t("settingsV2.people.ago.now");
  if (diff < HOUR) return t("settingsV2.people.ago.min", { n: Math.floor(diff / MIN) });
  if (diff < DAY) return t("settingsV2.people.ago.hour", { n: Math.floor(diff / HOUR) });
  const days = Math.floor(diff / DAY);
  if (days === 1) return t("settingsV2.people.ago.yesterday");
  if (days < 7) return t("settingsV2.people.ago.days", { count: days });
  return shortDate(t, date);
}

/** Whole calendar days from today to `date`, in the reader's timezone (0 = today). */
export function calendarDaysUntil(timeZone: string, date: Date, now = new Date()): number {
  const day = (d: Date) => {
    const s = d.toLocaleDateString("en-CA", { timeZone }); // YYYY-MM-DD
    return Date.parse(`${s}T00:00:00Z`);
  };
  return Math.round((day(date) - day(now)) / DAY);
}
