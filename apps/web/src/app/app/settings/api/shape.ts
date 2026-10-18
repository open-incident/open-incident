import { WEBHOOK_EVENTS } from "@openincident/webhooks";

/**
 * What the API & webhooks screen says about its rows, kept apart from the
 * page so the actions, the dialogs and the page agree on one vocabulary.
 */

const DAY = 86_400_000;

/** The families an endpoint subscribes to, as the "Events" choice offers them. */
export const EVENT_FAMILIES: Array<{ key: string; events: readonly string[] }> = [
  {
    key: "incident.*",
    events: [
      "incident.created",
      "incident.updated",
      "incident.update_published",
      "incident.resolved",
    ],
  },
  { key: "follow_up.*", events: ["follow_up.created"] },
  { key: "alert.*", events: ["alert.created", "alert.resolved"] },
  { key: "escalation.*", events: ["escalation.triggered", "escalation.acknowledged"] },
  { key: "status_page.*", events: ["status_page.incident_published"] },
];

/** The "Events" select of "New endpoint": a family, one event, or everything. */
export const EVENT_CHOICES: Array<{ key: string; events: readonly string[] }> = [
  EVENT_FAMILIES[0]!,
  { key: "incident.resolved", events: ["incident.resolved"] },
  EVENT_FAMILIES[2]!,
  EVENT_FAMILIES[3]!,
  EVENT_FAMILIES[4]!,
  { key: "everything", events: WEBHOOK_EVENTS },
];

/**
 * "incident.* · status_page.*": a whole family collapses to its star, a
 * partial one lists its events. Null when the endpoint takes every event.
 */
export function eventsSummary(events: readonly string[]): string | null {
  const set = new Set(events);
  if (WEBHOOK_EVENTS.every((e) => set.has(e))) return null;
  const parts: string[] = [];
  for (const f of EVENT_FAMILIES) {
    const has = f.events.filter((e) => set.has(e));
    if (has.length === 0) continue;
    if (has.length === f.events.length && f.events.length > 1) parts.push(f.key);
    else parts.push(...has);
  }
  for (const e of events) if (!EVENT_FAMILIES.some((f) => f.events.includes(e))) parts.push(e);
  return parts.join(" · ");
}

/**
 * HTTPS only. Plain HTTP is accepted for a loopback address outside
 * production — the local receiver a developer (or the smoke suite) runs.
 */
export function isEndpointUrl(raw: string, allowLoopbackHttp: boolean): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (raw.length > 500) return false;
  if (url.protocol === "https:") return true;
  return (
    allowLoopbackHttp &&
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]")
  );
}

export type Expiry =
  | { kind: "never" }
  | { kind: "expired" }
  | { kind: "today" }
  | { kind: "days"; n: number }
  | { kind: "months"; n: number };

/** "expires in 9 days" under three months, "in 11 months" beyond. */
export function expiryOf(expiresAt: Date | null, now = Date.now()): Expiry {
  if (!expiresAt) return { kind: "never" };
  const ms = expiresAt.getTime() - now;
  if (ms <= 0) return { kind: "expired" };
  const days = Math.floor(ms / DAY);
  if (days < 1) return { kind: "today" };
  if (days < 90) return { kind: "days", n: days };
  return { kind: "months", n: Math.max(3, Math.floor(days / 30.4)) };
}

/** Which resources a key reaches, as the "Scope" choice names them. */
export function scopeKey(resources: readonly string[] | null): string {
  if (!resources) return "all";
  const s = [...resources].sort().join(",");
  if (s === "incidents") return "incidents";
  if (s === "incidents,monitors") return "incidents,monitors";
  if (s === "services") return "services";
  if (s === "status_pages") return "status_pages";
  return s;
}
