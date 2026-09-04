/**
 * Redaction before any prompt leaves the instance: emails, phone numbers, IP
 * addresses, internal hostnames, and anything that looks like a secret. It is
 * systematic, not optional — the model never sees what a screenshot would.
 */
const RULES: Array<[RegExp, string | ((m: string) => string)]> = [
  [
    /\b(?:sk|pk|rk|xox[baprs]|ghp|gho|glpat|AKIA|oi_live|oisrc|whsec)[-_][A-Za-z0-9_-]{8,}\b/g,
    "[secret]",
  ],
  [/\b(?:eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, "[token]"],
  [
    /\b(?:password|passwd|pwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*\S+/gi,
    (m: string) => `${m.split(/[:=]/)[0]}=[redacted]`,
  ],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]"],
  [/\+?\d[\d .()-]{8,}\d/g, (m: string) => (m.replace(/\D/g, "").length >= 9 ? "[phone]" : m)],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]"],
  [/\b(?:[a-z0-9-]+\.)+(?:internal|local|lan|corp|intra|svc|cluster\.local)\b/gi, "[host]"],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, rep] of RULES)
    out = typeof rep === "string" ? out.replace(re, rep) : out.replace(re, rep);
  return out;
}
