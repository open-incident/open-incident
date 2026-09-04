/**
 * Languages of the software.
 *
 * The workspace sets its language (`workspaces.locale`); a member may override
 * it for themselves (`members.locale`) — an on-call team spans countries, and
 * the person woken at 3 a.m. reads in their own language.
 *
 * Three languages ship today; the platform targets the 24 official EU
 * languages plus Norwegian, added one dictionary at a time (see README.md).
 * `tag` is the BCP-47 label passed to the `Intl` APIs. `dir` is declared now
 * so the layout never has to be reworked for a right-to-left language.
 */

export type LocaleCode = "en" | "fr" | "de";

export type LocaleDefinition = {
  code: LocaleCode;
  /** BCP-47 label for Intl.* */
  tag: string;
  /** Name of the language in that language — a language menu is not translated. */
  nativeName: string;
  dir: "ltr" | "rtl";
};

export const LOCALES: readonly LocaleDefinition[] = [
  { code: "en", tag: "en-GB", nativeName: "English", dir: "ltr" },
  { code: "fr", tag: "fr-FR", nativeName: "Français", dir: "ltr" },
  { code: "de", tag: "de-DE", nativeName: "Deutsch", dir: "ltr" },
] as const;

export const DEFAULT_LOCALE: LocaleCode = "en";

const BY_CODE = new Map(LOCALES.map((l) => [l.code, l]));

export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === "string" && BY_CODE.has(value as LocaleCode);
}

/** Normalises what comes from the database or from a form; falls back to English. */
export function resolveLocale(value: unknown): LocaleDefinition {
  return BY_CODE.get(isLocaleCode(value) ? value : DEFAULT_LOCALE)!;
}
