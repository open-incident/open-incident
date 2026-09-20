/**
 * What a browser sends, and what is kept of it.
 *
 * This is the one table in the product that holds something about a person who
 * never agreed to anything — a visitor to a customer's website, who has no
 * account here and never will. Two decisions follow from that and are not
 * negotiable at read time, because by then the row exists:
 *
 *  - the **address is never stored**. The country is derived at the edge and
 *    the address is dropped before anything is written. An IP is the field
 *    that makes a row about a person rather than about a page.
 *  - whatever the application calls its user is **hashed with the workspace's
 *    own salt** and the value is thrown away. Enough to say "one person hit
 *    this forty times", never enough to say who.
 *
 * The payload is a browser's, which means it is written by whoever loads the
 * page. Every field is bounded and every string is clipped: a batch is a
 * thousand events at most, and a stack trace is eight kilobytes.
 */
import { createHash } from "node:crypto";

export class RumError extends Error {}

export const EVENT_TYPES = [
  "page_view",
  "web_vital",
  "error",
  "resource",
  "action",
  "long_task",
] as const;
export type RumEventType = (typeof EVENT_TYPES)[number];

/** Core Web Vitals plus the two that explain them. */
export const VITALS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;

export const MAX_EVENTS = 1_000;

export type RumEvent = {
  ts: string;
  sessionId: string;
  viewId: string;
  type: RumEventType;
  url: string;
  route: string;
  vitalName: string;
  vitalValue: number;
  vitalRating: string;
  browser: string;
  os: string;
  device: string;
  /** The country only, derived at the edge. The address never reaches a row. */
  country: string;
  traceId: string;
  errorType: string;
  errorMessage: string;
  errorStack: string;
  userHash: string;
  attributes: Record<string, string>;
};

type Incoming = Record<string, unknown>;

/**
 * A batch from the SDK into events.
 *
 * Nothing is trusted. The browser decides the session id and the route, which
 * is right — only it knows them — but it also decides how long they are, and a
 * page that sends a megabyte of session id would be a page that fills a
 * column. Every string has a ceiling and the batch itself has a count.
 */
export function decodeRumBatch(
  payload: unknown,
  context: { userAgent: string; country: string; salt: string },
): RumEvent[] {
  const body = payload as { events?: unknown };
  if (!Array.isArray(body?.events)) throw new RumError("a batch is { events: [...] }");
  if (body.events.length > MAX_EVENTS) {
    throw new RumError(`a batch holds at most ${MAX_EVENTS} events`);
  }

  // Parsed once for the whole batch: every event in it came from the same
  // browser, and a user-agent string is not cheap to pick apart.
  const agent = parseUserAgent(context.userAgent);
  const out: RumEvent[] = [];

  for (const raw of body.events as Incoming[]) {
    const type = String(raw.type ?? "");
    if (!(EVENT_TYPES as readonly string[]).includes(type)) continue;
    const sessionId = clip(String(raw.session ?? ""), 64);
    if (!sessionId) continue;

    const user = raw.user ? String(raw.user) : "";
    out.push({
      // The browser's clock, bounded: a machine whose clock is a year out
      // would otherwise write a row into a partition nobody looks at, or into
      // one the retention has already passed.
      ts: clockOf(raw.ts, new Date()),
      sessionId,
      viewId: clip(String(raw.view ?? ""), 64),
      type: type as RumEventType,
      url: clip(String(raw.url ?? ""), 2_000),
      route: clip(String(raw.route ?? ""), 200),
      vitalName: clip(String(raw.vital ?? ""), 16),
      vitalValue: finite(raw.value),
      vitalRating: clip(String(raw.rating ?? ""), 16),
      browser: agent.browser,
      os: agent.os,
      device: agent.device,
      country: context.country,
      traceId: clip(String(raw.trace ?? ""), 32),
      errorType: clip(String(raw.errorType ?? ""), 120),
      errorMessage: clip(String(raw.message ?? ""), 1_000),
      errorStack: clip(String(raw.stack ?? ""), 8_000),
      // Salted per workspace, so the same visitor on two customers' sites is
      // two different hashes and the tables cannot be joined against each
      // other.
      userHash: user
        ? createHash("sha256").update(`${context.salt}:${user}`).digest("hex").slice(0, 32)
        : "",
      attributes: attributesOf(raw.attributes),
    });
  }
  return out;
}

/** At most sixteen short pairs: a browser is not a place to put a document. */
function attributesOf(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>).slice(0, 16)) {
    if (typeof v === "object" && v !== null) continue;
    out[clip(key, 64)] = clip(String(v), 500);
  }
  return out;
}

/**
 * The browser's timestamp, or ours.
 *
 * A clock more than a day out in either direction is not a clock, it is a
 * machine somebody never set. Accepting it writes rows into partitions that
 * are already past their retention or years from being read, and the event is
 * more useful filed at the moment it arrived than lost.
 */
function clockOf(value: unknown, now: Date): string {
  const ms = Number(value);
  const ok = Number.isFinite(ms) && Math.abs(ms - now.getTime()) < 86_400_000;
  return (ok ? new Date(ms) : now).toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Browser, OS and form factor from a user-agent string.
 *
 * Deliberately coarse. The question a RUM screen answers is "is this slow on
 * phones" and "is this broken in Safari", and those need three buckets and a
 * name — not a version matrix. Every user-agent parser that tries for more
 * becomes a table of exceptions somebody has to maintain for ever.
 */
export function parseUserAgent(ua: string): { browser: string; os: string; device: string } {
  const s = ua ?? "";
  const browser = /Edg\//.test(s)
    ? "Edge"
    : /OPR\/|Opera/.test(s)
      ? "Opera"
      : /Firefox\//.test(s)
        ? "Firefox"
        : // Chrome must be tested after the others: every one of them says
          // "Chrome" as well, and testing it first names them all Chrome.
          /Chrome\//.test(s)
          ? "Chrome"
          : /Safari\//.test(s)
            ? "Safari"
            : "other";
  const os = /Windows/.test(s)
    ? "Windows"
    : /Android/.test(s)
      ? "Android"
      : /iPhone|iPad|iPod/.test(s)
        ? "iOS"
        : /Mac OS X/.test(s)
          ? "macOS"
          : /Linux/.test(s)
            ? "Linux"
            : "other";
  const device = /iPad|Tablet/.test(s)
    ? "tablet"
    : /Mobi|Android|iPhone/.test(s)
      ? "mobile"
      : "desktop";
  return { browser, os, device };
}

/**
 * Whether this page may report to this application.
 *
 * Exact match on scheme and host, and no wildcards. A wildcard in an origin
 * list is how one gets written as `https://*.example.com` and matches
 * `https://evil.com/?.example.com` in somebody's implementation; the cost of
 * exactness is that a workspace lists its origins, which it has to know anyway.
 */
export function originAllowed(origin: string, allowed: string[]): boolean {
  if (allowed.length === 0) return false;
  const normal = origin.trim().replace(/\/$/, "").toLowerCase();
  return allowed.some((a) => a.trim().replace(/\/$/, "").toLowerCase() === normal);
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

function finite(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
