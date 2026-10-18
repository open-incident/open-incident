/**
 * How a page's address is shown back to the person it reached: enough to
 * recognise, not enough to read somebody's number off a shared screen.
 */

/** "+33612345678" → "+33 6 •• •• 78"; "+15551234567" → "+1 555 •• •• 67". */
export function maskPhone(value: string): string {
  const v = value.replace(/\s+/g, "");
  if (!/^\+\d{6,}$/.test(v)) return `${v.slice(0, 4)}…${v.slice(-2)}`;
  const last = v.slice(-2);
  // A one-digit country code (North America, Russia and Kazakhstan) keeps the
  // three digits of the area code; the others keep the first digit after it.
  if (/^\+[17]/.test(v)) return `${v.slice(0, 2)} ${v.slice(2, 5)} •• •• ${last}`;
  return `${v.slice(0, 3)} ${v.slice(3, 4)} •• •• ${last}`;
}

/** "amelie@skylark.dev" → "am…@skylark.dev". */
export function maskEmail(value: string): string {
  const [user, domain] = value.split("@");
  return `${(user ?? "").slice(0, 2)}…@${domain ?? ""}`;
}
