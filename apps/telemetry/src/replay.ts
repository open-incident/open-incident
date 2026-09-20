/**
 * A chunk of a session recording, as it arrives from a browser.
 *
 * The payload is a list of rrweb events: one full snapshot of the DOM, then
 * the mutations that followed. This module does not interpret them — it is not
 * in the business of understanding somebody else's DOM — it checks the shape,
 * bounds the size, and works out the three facts the player needs to find its
 * way in: when the chunk starts, when it ends, and whether it opens with a
 * snapshot it can start from.
 */

/** rrweb's own numbering. 2 is the full snapshot; the rest are increments. */
const FULL_SNAPSHOT = 2;

/** Per chunk, after decompression. A recording that needs more is a loop. */
export const MAX_EVENTS = 5_000;
export const MAX_BYTES = 2 * 1024 * 1024;

export class ReplayError extends Error {}

export type ReplayChunk = {
  sessionId: string;
  seq: number;
  firstTs: number;
  lastTs: number;
  events: number;
  hasSnapshot: boolean;
  /** The events, re-serialised. What goes in the column. */
  payload: string;
};

type RawEvent = { type: number; timestamp: number };

function isEvent(v: unknown): v is RawEvent {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e.type === "number" && typeof e.timestamp === "number";
}

/**
 * One chunk, validated.
 *
 * `sessionId` and `seq` come from the query string rather than the body: they
 * address the row, and reading them out of a payload means parsing two
 * megabytes of somebody's DOM before knowing where it goes.
 */
export function decodeReplayChunk(
  body: unknown,
  meta: { sessionId: string; seq: number },
): ReplayChunk {
  if (!Array.isArray(body)) throw new ReplayError("a chunk is a JSON array of rrweb events");
  if (body.length === 0) throw new ReplayError("empty chunk");
  if (body.length > MAX_EVENTS) throw new ReplayError(`more than ${MAX_EVENTS} events in a chunk`);
  if (!meta.sessionId || meta.sessionId.length > 64) throw new ReplayError("missing session");
  if (!Number.isInteger(meta.seq) || meta.seq < 0 || meta.seq > 100_000) {
    throw new ReplayError("missing or implausible seq");
  }

  let first = Infinity;
  let last = 0;
  let snapshot = false;
  for (const e of body) {
    if (!isEvent(e)) throw new ReplayError("an event needs a numeric type and timestamp");
    // Milliseconds since the epoch. A recorder whose clock says 1970 or 2170
    // would put the session somewhere nobody will ever scroll to.
    if (e.timestamp < 1_000_000_000_000 || e.timestamp > 4_000_000_000_000) {
      throw new ReplayError("event timestamp is not a plausible epoch in milliseconds");
    }
    if (e.timestamp < first) first = e.timestamp;
    if (e.timestamp > last) last = e.timestamp;
    if (e.type === FULL_SNAPSHOT) snapshot = true;
  }

  const payload = JSON.stringify(body);
  if (payload.length > MAX_BYTES) throw new ReplayError(`chunk larger than ${MAX_BYTES} bytes`);

  return {
    sessionId: meta.sessionId,
    seq: meta.seq,
    firstTs: first,
    lastTs: last,
    events: body.length,
    hasSnapshot: snapshot,
    payload,
  };
}

/**
 * The workspace's own redaction, applied to the recording before it is stored.
 *
 * Masking happens in the browser and is the real protection — this is the
 * second line, for the regions an application un-masked on purpose and for the
 * secret detectors that are never optional. It is applied here and never at
 * read time, like everywhere else in this product: a card number redacted on
 * playback has already been written to disk.
 *
 * If a rule mangles the JSON the chunk is refused rather than stored raw.
 * A workspace's regular expression is data and `.*` is a legal one; the
 * failure mode of "store it unscrubbed instead" is the leak this exists to
 * prevent.
 */
export function scrubPayload(payload: string, scrub: (text: string) => string): string {
  const cleaned = scrub(payload);
  if (cleaned === payload) return payload;
  try {
    JSON.parse(cleaned);
  } catch {
    throw new ReplayError("a scrub rule left the recording unparseable; chunk refused");
  }
  return cleaned;
}
