/**
 * Labels of the alerts screens, in the three languages.
 *
 * Each language holds exactly the same keys — English is the source the
 * `Dictionary` type derives from, so a gap in another language does not
 * compile.
 */
export const alertsPart = {
  en: {},
  fr: {},
  de: {},
} as const satisfies {
  en: Record<string, never>;
  fr: Record<string, never>;
  de: Record<string, never>;
};
