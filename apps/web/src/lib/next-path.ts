/**
 * Where to go after signing in, when somebody arrived at the sign-in page on
 * their way somewhere — an installation started from the Slack Marketplace,
 * a link in an email. Only a path on this host: an absolute URL or a
 * protocol-relative one would make the sign-in page an open redirect.
 */
export function safeNext(raw: string | null | undefined, fallback = "/app/incidents"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (/[\r\n]/.test(raw)) return fallback;
  return raw;
}
