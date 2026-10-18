import type { ReactNode } from "react";
import type { MessageParams } from "@/i18n/dictionary";
import type { MessageKey } from "@/i18n/dictionaries/en";

/** Enough of `t` to render a sentence: the server's and the client's both satisfy it. */
type Tr = (key: MessageKey, params?: MessageParams) => string;

const MARK = "\u0000";

/**
 * A translated sentence whose values are set in bold — "Source **Datadog**
 * says: page the service owner." The sentence stays one dictionary entry in
 * each language, word order included; only the values are wrapped.
 */
export function rich(
  t: Tr,
  key: MessageKey,
  params: Record<string, string | number>,
  bold: string[] = Object.keys(params),
): ReactNode[] {
  const marked: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params))
    marked[k] = bold.includes(k) ? `${MARK}${k}${MARK}` : v;
  return t(key, marked)
    .split(MARK)
    .map((part, i) => (i % 2 === 1 ? <strong key={i}>{String(params[part] ?? "")}</strong> : part));
}
