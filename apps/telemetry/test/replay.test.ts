/**
 * Session replay chunks, at the door.
 *
 * The interesting cases are not the happy ones. A chunk arrives from a browser
 * nobody controls, carrying a copy of a page nobody here has seen, and the two
 * things that must hold are that it cannot be enormous and that a workspace's
 * own redaction cannot quietly turn it into garbage.
 */
import { describe, expect, it } from "vitest";
import { decodeReplayChunk, MAX_EVENTS, ReplayError, scrubPayload } from "../src/replay";

const NOW = 1_789_920_000_000;
const ev = (over: Partial<{ type: number; timestamp: number; data: unknown }> = {}) => ({
  type: 3,
  timestamp: NOW,
  data: {},
  ...over,
});
const meta = { sessionId: "s-1", seq: 0 };

describe("decoding a chunk", () => {
  it("reads the span and the count", () => {
    const chunk = decodeReplayChunk([ev({ timestamp: NOW }), ev({ timestamp: NOW + 4000 })], meta);
    expect(chunk).toMatchObject({
      sessionId: "s-1",
      seq: 0,
      firstTs: NOW,
      lastTs: NOW + 4000,
      events: 2,
      hasSnapshot: false,
    });
  });

  it("notices the full snapshot, which is what a player starts from", () => {
    expect(decodeReplayChunk([ev({ type: 2 }), ev()], meta).hasSnapshot).toBe(true);
    expect(decodeReplayChunk([ev({ type: 4 }), ev()], meta).hasSnapshot).toBe(false);
  });

  it("takes the span from the events, not from their order", () => {
    // rrweb emits in order, but a chunk is a concatenation and nothing here
    // should depend on that staying true.
    const chunk = decodeReplayChunk(
      [ev({ timestamp: NOW + 9000 }), ev({ timestamp: NOW }), ev({ timestamp: NOW + 100 })],
      meta,
    );
    expect(chunk.firstTs).toBe(NOW);
    expect(chunk.lastTs).toBe(NOW + 9000);
  });

  it("refuses what is not a chunk", () => {
    expect(() => decodeReplayChunk({ events: [] }, meta)).toThrow(ReplayError);
    expect(() => decodeReplayChunk([], meta)).toThrow(ReplayError);
    expect(() => decodeReplayChunk([{ type: 3 }], meta)).toThrow(ReplayError);
    expect(() => decodeReplayChunk([{ timestamp: NOW }], meta)).toThrow(ReplayError);
  });

  it("refuses a timestamp that is not a plausible epoch in milliseconds", () => {
    // Seconds rather than milliseconds is the mistake a hand-rolled sender
    // makes, and it would file the session in 1970 where nobody scrolls.
    expect(() => decodeReplayChunk([ev({ timestamp: 1_789_920_000 })], meta)).toThrow(ReplayError);
    expect(() => decodeReplayChunk([ev({ timestamp: 0 })], meta)).toThrow(ReplayError);
  });

  it("refuses more events than a page can honestly produce", () => {
    const many = Array.from({ length: MAX_EVENTS + 1 }, () => ev());
    expect(() => decodeReplayChunk(many, meta)).toThrow(/more than/);
  });

  it("refuses a chunk with no session or an implausible sequence", () => {
    expect(() => decodeReplayChunk([ev()], { sessionId: "", seq: 0 })).toThrow(/session/);
    expect(() => decodeReplayChunk([ev()], { sessionId: "s", seq: -1 })).toThrow(/seq/);
    expect(() => decodeReplayChunk([ev()], { sessionId: "s", seq: 1.5 })).toThrow(/seq/);
  });
});

describe("scrubbing a recording", () => {
  const rules = (res: RegExp[]) => (text: string) =>
    res.reduce((out, re) => out.replace(re, "[redacted]"), text);

  it("leaves a recording nothing matched exactly as it was", () => {
    const payload = JSON.stringify([ev()]);
    expect(scrubPayload(payload, rules([/never-appears/g]))).toBe(payload);
  });

  it("redacts inside the recording", () => {
    const payload = JSON.stringify([{ ...ev(), data: { text: "card 4111111111111111" } }]);
    const out = scrubPayload(payload, rules([/4111111111111111/g]));
    expect(out).not.toContain("4111111111111111");
    expect(JSON.parse(out)).toHaveLength(1);
  });

  /**
   * The case that decides the whole function. A workspace's rule is data and
   * `"` is a legal thing to match; a rule that eats a quote leaves a string
   * that is no longer JSON. Storing it raw instead would put back the very
   * text the rule exists to remove, so the chunk is refused.
   */
  it("refuses the chunk when a rule leaves it unparseable, rather than storing it raw", () => {
    const payload = JSON.stringify([{ ...ev(), data: { text: "secret" } }]);
    expect(() => scrubPayload(payload, rules([/"/g]))).toThrow(/unparseable/);
  });
});
