/**
 * Redaction before any prompt leaves the instance: emails, phone numbers, IP
 * addresses, internal hostnames, and anything that looks like a secret. It is
 * systematic, not optional — the model never sees what a screenshot would.
 *
 * The list is split in two because two callers want different halves. A prompt
 * leaving for an inference provider should lose everything below. Telemetry
 * ingestion must lose the secrets and keep the rest: an IP address and an
 * internal hostname are what a log is *for*, and a platform that redacts them
 * has stored a useless line.
 */
type Rule = [RegExp, string | ((m: string) => string)];

/** Never optional, anywhere: a credential in a payload is a credential leaked. */
const SECRET_RULES: Rule[] = [
  [
    /\b(?:sk|pk|rk|xox[baprs]|ghp|gho|glpat|AKIA|oi_live|oisrc|whsec)[-_][A-Za-z0-9_-]{8,}\b/g,
    "[secret]",
  ],
  [/\b(?:eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, "[token]"],
  [
    /\b(?:password|passwd|pwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*\S+/gi,
    (m: string) => `${m.split(/[:=]/)[0]}=[redacted]`,
  ],
];

/** Personal and topological data — stripped from prompts, kept in telemetry. */
const PERSONAL_RULES: Rule[] = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]"],
  [/\+?\d[\d .()-]{8,}\d/g, (m: string) => (m.replace(/\D/g, "").length >= 9 ? "[phone]" : m)],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]"],
  [/\b(?:[a-z0-9-]+\.)+(?:internal|local|lan|corp|intra|svc|cluster\.local)\b/gi, "[host]"],
];

function apply(text: string, rules: Rule[]): string {
  let out = text;
  for (const [re, rep] of rules)
    out = typeof rep === "string" ? out.replace(re, rep) : out.replace(re, rep);
  return out;
}

/** Everything: what leaves for a model. */
export function redact(text: string): string {
  return apply(text, [...SECRET_RULES, ...PERSONAL_RULES]);
}

/** Secrets only: what telemetry ingestion strips before writing a row. */
export function redactSecrets(text: string): string {
  return apply(text, SECRET_RULES);
}
