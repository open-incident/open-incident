import { cache } from "react";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { members, withTenant } from "@openincident/db";
import { getTenantFromHeaders, getWorkspace } from "@/lib/tenant";
import { renderMessage, splitAround, type Message, type MessageParams } from "./dictionary";
import { LocaleFormat } from "./format";
import { DEFAULT_LOCALE, resolveLocale, type LocaleDefinition } from "./locales";
import { en, type Dictionary, type MessageKey } from "./dictionaries/en";
import { fr } from "./dictionaries/fr";
import { de } from "./dictionaries/de";

/**
 * Server-side language resolution: the member's own override when they are
 * signed in and set one, otherwise the workspace's language. Memoised per
 * request, so calling `getT()` in ten components costs one lookup.
 */

const DICTIONARIES: Record<string, Dictionary> = { en, fr, de };

export type Translate = {
  (key: MessageKey, params?: MessageParams): string;
  /** Resolved language, for `lang`/`dir` and the client components. */
  locale: LocaleDefinition;
  /** Dates, numbers, plurals, relative time in this language. */
  fmt: LocaleFormat;
  /** The full dictionary — to be passed to a client component. */
  dict: Dictionary;
  /** The timezone dates are displayed in — the member's, else the workspace's. */
  timeZone: string;
  /** Sentence split around a parameter rendered in JSX (link, value in bold). */
  parts: (key: MessageKey, slot: string, params?: MessageParams) => [string, string];
};

const resolveContext = cache(async (): Promise<{ locale: LocaleDefinition; timeZone: string }> => {
  try {
    const tenant = await getTenantFromHeaders();
    const workspace = await getWorkspace();
    let locale = workspace?.locale;
    let timeZone = workspace?.timezone ?? "Europe/Paris";
    if (tenant && workspace) {
      const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
      if (session) {
        const override = await withTenant(tenant.id, async (tx) => {
          const [row] = await tx
            .select({ locale: members.locale, timezone: members.timezone })
            .from(members)
            .where(
              and(
                eq(members.tenantId, tenant.id),
                eq(members.email, session.user.email.toLowerCase()),
              ),
            );
          return row ?? null;
        });
        if (override?.locale) locale = override.locale;
        if (override?.timezone) timeZone = override.timezone;
      }
    }
    return { locale: resolveLocale(locale), timeZone };
  } catch {
    return { locale: resolveLocale(DEFAULT_LOCALE), timeZone: "Europe/Paris" };
  }
});

export const getLocale = cache(
  async (): Promise<LocaleDefinition> => (await resolveContext()).locale,
);

/** Builds the translation function for the current language. */
export const getT = cache(async (): Promise<Translate> => {
  const { locale, timeZone } = await resolveContext();
  return buildTranslate(locale, timeZone);
});

export function buildTranslate(locale: LocaleDefinition, timeZone = "Europe/Paris"): Translate {
  const dict = DICTIONARIES[locale.code] ?? en;
  const fmt = new LocaleFormat(locale);

  const t = ((key: MessageKey, params?: MessageParams) => {
    // Fall back to English rather than to the raw key: a missing translation
    // must stay readable, not display "incidents.emptyTitle".
    const message: Message = dict[key] ?? en[key];
    if (message === undefined) return key;
    const count = params?.count;
    const category = typeof count === "number" ? fmt.plural(count) : undefined;
    return renderMessage(message, params, category, (n) => fmt.number(n));
  }) as Translate;

  t.locale = locale;
  t.fmt = fmt;
  t.dict = dict;
  t.timeZone = timeZone;
  t.parts = (key, slot, params) => splitAround((p) => t(key, p), slot, params);
  return t;
}
