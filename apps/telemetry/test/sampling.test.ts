/**
 * Forced sampling, under a daily soft cap.
 *
 * The tests that matter here are not the arithmetic ones — they are the two
 * properties a waterfall depends on: a trace is kept whole or not at all, and
 * a log with a trace id makes the same decision its spans made. Both are
 * invisible in a unit that samples ten rows and both are catastrophic in
 * production, where the spans of one trace arrive in a dozen requests.
 */
import { describe, expect, it } from "vitest";
import {
  keepRate,
  keepTrace,
  MIN_KEEP,
  sampleLogs,
  sampleSpans,
  samplingNotice,
} from "../src/sampling";

const GB = 1024 ** 3;

const span = (
  traceId: string,
  over: Partial<{ statusCode: string; hasException: boolean }> = {},
) => ({
  traceId,
  statusCode: "ok",
  hasException: false,
  ...over,
});

const log = (over: Partial<{ traceId: string; severityNumber: number }> = {}) => ({
  traceId: "",
  severityNumber: 9,
  ...over,
});

const traceIds = (n: number) => Array.from({ length: n }, (_, i) => `trace-${i.toString(16)}`);

describe("keepRate", () => {
  it("keeps everything with no cap", () => {
    expect(keepRate(null, 10 * GB)).toBe(1);
    expect(keepRate(0, 10 * GB)).toBe(1);
  });

  it("keeps everything under and at the cap", () => {
    expect(keepRate(GB, 0)).toBe(1);
    expect(keepRate(GB, GB - 1)).toBe(1);
    expect(keepRate(GB, GB)).toBe(1);
  });

  it("keeps the share that would have fitted", () => {
    expect(keepRate(GB, 2 * GB)).toBeCloseTo(0.5, 10);
    expect(keepRate(GB, 4 * GB)).toBeCloseTo(0.25, 10);
  });

  it("never goes fully dark", () => {
    expect(keepRate(GB, 10_000 * GB)).toBe(MIN_KEEP);
  });

  /**
   * The claim made in the module's own comment, checked rather than asserted:
   * integrating the rate over a day of raw volume must give cap·(1 + ln(raw/cap)).
   * If somebody changes the curve, this is what tells them what it now costs.
   */
  it("stores a logarithmic multiple of the cap, not a linear one", () => {
    const stored = (rawGb: number) => {
      let total = 0;
      const step = GB / 500;
      for (let used = 0; used < rawGb * GB; used += step) {
        total += keepRate(GB, used) * step;
      }
      return total / GB;
    };
    expect(stored(2)).toBeCloseTo(1 + Math.log(2), 1);
    expect(stored(10)).toBeCloseTo(1 + Math.log(10), 1);
    expect(stored(10)).toBeLessThan(4);
  });
});

describe("keepTrace", () => {
  it("answers the same way every time for the same trace", () => {
    for (const id of traceIds(50)) {
      const first = keepTrace(id, 0.37);
      for (let i = 0; i < 5; i++) expect(keepTrace(id, 0.37)).toBe(first);
    }
  });

  it("keeps roughly the share it is asked for", () => {
    const ids = traceIds(20_000);
    const kept = ids.filter((id) => keepTrace(id, 0.25)).length;
    expect(kept / ids.length).toBeGreaterThan(0.22);
    expect(kept / ids.length).toBeLessThan(0.28);
  });

  it("is monotonic: a trace kept at a low rate is kept at a higher one", () => {
    for (const id of traceIds(200)) {
      if (keepTrace(id, 0.1)) expect(keepTrace(id, 0.5)).toBe(true);
    }
  });
});

describe("sampleSpans", () => {
  it("keeps a trace whole or not at all", () => {
    // Nine spans each, arriving interleaved the way a real batch does.
    const ids = traceIds(400);
    const spans = ids.flatMap((id) => Array.from({ length: 9 }, () => span(id)));
    const { kept } = sampleSpans(spans, 0.3);

    const seen = new Map<string, number>();
    for (const s of kept) seen.set(s.traceId, (seen.get(s.traceId) ?? 0) + 1);
    for (const [id, n] of seen) expect(`${id}:${n}`).toBe(`${id}:9`);
    expect(seen.size).toBeGreaterThan(0);
    expect(seen.size).toBeLessThan(ids.length);
  });

  it("keeps every span of a trace that failed, whatever the rate", () => {
    const spans = [
      span("kept-because-it-failed"),
      span("kept-because-it-failed"),
      span("kept-because-it-failed", { statusCode: "error" }),
      span("also-kept", { hasException: true }),
    ];
    const { kept, dropped } = sampleSpans(spans, 0.0001);
    expect(kept).toHaveLength(4);
    expect(dropped).toBe(0);
  });

  it("weights the draw and never the errors", () => {
    const failed = span("boom", { statusCode: "error" });
    const drawn = traceIds(600).map((id) => span(id));
    const { kept, ratioFor } = sampleSpans([failed, ...drawn], 0.25);
    expect(ratioFor(failed)).toBe(1);
    const ordinary = kept.find((s) => s.traceId !== "boom")!;
    expect(ratioFor(ordinary)).toBe(4);
  });

  it("is a no-op at full rate, including the object it returns", () => {
    const spans = [span("a"), span("b")];
    const out = sampleSpans(spans, 1);
    expect(out.kept).toBe(spans);
    expect(out.dropped).toBe(0);
    expect(out.ratioFor(spans[0]!)).toBe(1);
  });
});

describe("sampleLogs", () => {
  it("keeps errors whatever the rate", () => {
    const logs = [log({ severityNumber: 17 }), log({ severityNumber: 21 }), log()];
    const { kept } = sampleLogs(logs, 0.0001);
    expect(kept.map((l) => l.severityNumber)).toEqual([17, 21]);
  });

  it("asks the predicate it is given, not the severity", () => {
    // A logger writing `err.stack` at WARN: an exception the product will
    // group and alert on, two severity levels below ERROR.
    const stack = log({ severityNumber: 13 });
    const chatter = log({ severityNumber: 13 });
    const { kept } = sampleLogs([stack, chatter], 0.0001, (l) => l === stack);
    expect(kept).toEqual([stack]);
  });

  it("follows the trace, so a kept trace keeps its lines", () => {
    const ids = traceIds(500);
    const spans = ids.map((id) => span(id));
    const logs = ids.map((id) => log({ traceId: id }));
    const rate = 0.3;

    const keptTraces = new Set(sampleSpans(spans, rate).kept.map((s) => s.traceId));
    const keptLogs = new Set(sampleLogs(logs, rate).kept.map((l) => l.traceId));

    expect([...keptLogs].sort()).toEqual([...keptTraces].sort());
    expect(keptTraces.size).toBeGreaterThan(0);
  });

  it("draws untraced lines at random rather than by their text", () => {
    const logs = Array.from({ length: 4000 }, () => log());
    const { kept, dropped } = sampleLogs(logs, 0.25);
    expect(kept.length + dropped).toBe(4000);
    expect(kept.length / 4000).toBeGreaterThan(0.21);
    expect(kept.length / 4000).toBeLessThan(0.29);
  });
});

describe("the notice", () => {
  it("says how much is being kept, in the terms an operator thinks in", () => {
    expect(samplingNotice(900, 0.25)).toContain("1 in 4");
    expect(samplingNotice(900, 0.25)).toContain("900");
    expect(samplingNotice(900, 0.25)).toContain("Errors are never sampled");
  });
});
