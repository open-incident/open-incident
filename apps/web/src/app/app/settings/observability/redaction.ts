/**
 * The redaction switches of Settings › Telemetry, as patterns.
 *
 * The ingestion service (apps/telemetry) replaces every match of the
 * workspace's scrub rules by `[redacted]` in log bodies, span and log
 * attributes and exception messages, before anything is written — and runs
 * its secret detectors (keys, tokens, JWTs, `password=`…) first, always. Each
 * switch here is a named set of rules stored in that same list: on, its
 * patterns are in the list; off, they are not. Rules a workspace wrote by
 * hand sit beside them, untouched.
 */

export type Redaction = {
  key: "email" | "cards" | "tokens" | "ip";
  /** Regular expressions, compiled by ingestion with the `g` flag. */
  patterns: string[];
  /** Always applied: a credential is never stored, whatever the switch says. */
  fixed?: boolean;
};

export const REDACTIONS: Redaction[] = [
  { key: "email", patterns: ["[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}"] },
  {
    key: "cards",
    // The issuers' prefixes, so a 13-digit epoch in milliseconds is not a card.
    patterns: [
      "\\b(?:4\\d{3}|5[1-5]\\d{2}|2[2-7]\\d{2}|6(?:011|5\\d{2}))(?:[ -]?\\d{4}){3}\\b",
      "\\b3[47]\\d{2}[ -]?\\d{6}[ -]?\\d{5}\\b",
    ],
  },
  {
    key: "tokens",
    patterns: ["[Bb]earer\\s+[A-Za-z0-9._~+/=-]{8,}"],
    fixed: true,
  },
  {
    key: "ip",
    patterns: [
      "\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b",
      "\\b(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}\\b",
    ],
  },
];

const ALL = new Set(REDACTIONS.flatMap((r) => r.patterns));

/** Which switches are on, read from the stored rules. The fixed one always is. */
export function redactionsOn(rules: readonly string[]): Set<Redaction["key"]> {
  const set = new Set(rules);
  return new Set(
    REDACTIONS.filter((r) => r.fixed || r.patterns.every((p) => set.has(p))).map((r) => r.key),
  );
}

/** The workspace's own rules, then the patterns of every switch that is on. */
export function withRedactions(rules: readonly string[], on: Set<string>): string[] {
  const own = rules.filter((r) => !ALL.has(r));
  const presets = REDACTIONS.filter((r) => r.fixed || on.has(r.key)).flatMap((r) => r.patterns);
  return [...own, ...presets].slice(0, 50);
}

/** The line a page carries, with the application's public key already in it. */
export function rumSnippet(appId: string, origin: string): string {
  const endpoint =
    process.env.TELEMETRY_PUBLIC_ORIGIN?.trim() || "https://otlp.<your workspace host>";
  return `<script src="${origin}/rum/oi-rum.js" data-app="${appId}" data-endpoint="${endpoint}" defer></script>`;
}
