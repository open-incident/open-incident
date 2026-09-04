/**
 * Translation machinery: types, plural selection, interpolation.
 *
 * English is the source. `en.ts` defines the whole set of keys; the other
 * languages are typed `Dictionary` against that set, so that a forgotten or
 * extra key is a compile error and not an English string resurfacing in
 * production.
 *
 * A value is either a string or a table of plural forms. The forms are the ones
 * `Intl.PluralRules` gives for the language: `one`/`other` in German or in
 * Dutch, `one`/`many`/`other` in French. `other` is always supplied — it is the
 * fallback when the exact category is missing.
 */

import type { PluralCategory } from "./format";

export type Message = string | ({ other: string } & Partial<Record<PluralCategory, string>>);

export type MessageParams = Record<string, string | number>;

/**
 * Replaces {name} with its value. A missing parameter leaves the brace visible,
 * which catches the eye on review instead of producing a silent hole.
 *
 * A NUMERIC parameter is formatted in the current language: "4 128" in French,
 * "4,128" in English, "4.128" in German. Without this, a `String(n)` rendered
 * "4128" everywhere and lost the thousands separator that the old `numberFr`
 * helpers used to add.
 *
 * A number that must NOT be grouped — a year, a version number — is therefore
 * passed as a string: `{ year: String(2026) }`.
 */
function interpolate(
  template: string,
  params?: MessageParams,
  formatNumber?: (n: number) => string,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    if (!(key in params)) return whole;
    const value = params[key];
    return typeof value === "number" && formatNumber ? formatNumber(value) : String(value);
  });
}

export function selectMessage(message: Message, category: PluralCategory | undefined): string {
  if (typeof message === "string") return message;
  return (category && message[category]) || message.other;
}

export function renderMessage(
  message: Message,
  params: MessageParams | undefined,
  category: PluralCategory | undefined,
  formatNumber?: (n: number) => string,
): string {
  return interpolate(selectMessage(message, category), params, formatNumber);
}

/**
 * Splits a translated sentence around a parameter rendered in JSX (a link, a
 * reference in bold). Rendering `t("…", { ref: <b/> })` is impossible — a
 * translation is a string — and cutting the sentence into two keys would break
 * word order in the other languages. So an improbable separator is
 * interpolated, then split back out.
 */
const SLOT = "\u0000";

export function splitAround(
  render: (params: MessageParams) => string,
  slot: string,
  params?: MessageParams,
): [string, string] {
  const whole = render({ ...params, [slot]: SLOT });
  const at = whole.indexOf(SLOT);
  if (at === -1) return [whole, ""];
  return [whole.slice(0, at), whole.slice(at + SLOT.length)];
}
