"use client";

/**
 * Translation inside client components.
 *
 * A context set once by the server shell is enough: the dictionary is already
 * loaded server-side, so it crosses the boundary as plain serialisable data.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { renderMessage, splitAround, type Message, type MessageParams } from "./dictionary";
import { LocaleFormat } from "./format";
import type { LocaleDefinition } from "./locales";
import type { Dictionary, MessageKey } from "./dictionaries/en";

type Bundle = { locale: LocaleDefinition; dict: Dictionary; timeZone: string };

const I18nContext = createContext<Bundle | null>(null);

export function I18nProvider({
  locale,
  dict,
  timeZone,
  children,
}: Bundle & { children: ReactNode }) {
  const value = useMemo(() => ({ locale, dict, timeZone }), [locale, dict, timeZone]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const bundle = useContext(I18nContext);
  if (!bundle) {
    throw new Error("useT() outside <I18nProvider> — the shell must set it up.");
  }
  const { locale, dict, timeZone } = bundle;
  return useMemo(() => {
    const fmt = new LocaleFormat(locale);
    const t = (key: MessageKey, params?: MessageParams) => {
      const message: Message | undefined = dict[key];
      if (message === undefined) return key;
      const count = params?.count;
      const category = typeof count === "number" ? fmt.plural(count) : undefined;
      return renderMessage(message, params, category, (n) => fmt.number(n));
    };
    const parts = (key: MessageKey, slot: string, params?: MessageParams) =>
      splitAround((p) => t(key, p), slot, params);
    return Object.assign(t, { locale, fmt, parts, timeZone });
  }, [locale, dict, timeZone]);
}
