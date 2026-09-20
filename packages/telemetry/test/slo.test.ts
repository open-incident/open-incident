/**
 * The arithmetic an SLO pages on.
 *
 * Two things are being pinned down. That an empty window is not a perfect one
 * — the single most misleading reading an SLO can produce, because it is what
 * a broken exporter looks like and it is indistinguishable from flawless. And
 * that the two burn rates stay separate, because they are two different
 * instructions to the person receiving them.
 */
import { describe, expect, it } from "vitest";
import {
  FAST_BURN,
  SLOW_BURN,
  burnVerdict,
  hoursLeft,
  windowStart,
  type SloDefinition,
} from "../src/slo";

const rolling: SloDefinition = {
  goodQuery: "good",
  totalQuery: "total",
  objective: 99.9,
  windowKind: "rolling",
  windowDays: 28,
};

describe("the verdict", () => {
  const reading = (fastBurn: number, slowBurn: number, empty = false) => ({
    fastBurn,
    slowBurn,
    empty,
  });

  it("is quiet while the budget is being spent at the expected pace", () => {
    // A burn rate of 1 is exactly the pace the objective allows: it spends the
    // whole budget over the whole window, which is what a budget is for.
    expect(burnVerdict(reading(1, 1))).toBe("ok");
  });

  it("calls an outage fast and an erosion slow", () => {
    expect(burnVerdict(reading(FAST_BURN, 1))).toBe("fast");
    expect(burnVerdict(reading(1, SLOW_BURN))).toBe("slow");
  });

  it("prefers the louder of the two when both trip", () => {
    expect(burnVerdict(reading(FAST_BURN + 10, SLOW_BURN + 10))).toBe("fast");
  });

  it("says nothing about a window that held no events", () => {
    // The reading a broken exporter produces. Calling it perfect would be the
    // worst possible answer; calling it an outage would page on a quiet night.
    expect(burnVerdict(reading(0, 0, true))).toBe("ok");
    expect(burnVerdict(reading(9_999, 9_999, true))).toBe("ok");
  });

  it("does not fire just below either threshold", () => {
    expect(burnVerdict(reading(FAST_BURN - 0.01, SLOW_BURN - 0.01))).toBe("ok");
  });
});

describe("how long the budget lasts", () => {
  it("is the whole window when the budget is whole and burning at the allowed pace", () => {
    expect(hoursLeft(1, 1, 28)).toBe(28 * 24);
  });

  it("shortens in proportion to the burn", () => {
    expect(hoursLeft(1, 14.4, 28)).toBeCloseTo((28 * 24) / 14.4, 5);
  });

  it("has no answer when nothing is burning, or when nothing is left", () => {
    expect(hoursLeft(1, 0, 28)).toBeNull();
    expect(hoursLeft(0, 5, 28)).toBeNull();
    expect(hoursLeft(-0.2, 5, 28)).toBeNull();
  });
});

describe("where the window starts", () => {
  const at = new Date("2026-09-20T14:30:00Z");

  it("rolls back the same number of days every time", () => {
    expect(windowStart(rolling, at).toISOString()).toBe("2026-08-23T14:30:00.000Z");
  });

  it("goes to the first of the month for a calendar window", () => {
    // A calendar window hands back a fresh budget on the first, whether or not
    // the problem was fixed. That is what a contract usually says, and it is
    // why it is a separate kind rather than a rolling window of 30 days.
    expect(windowStart({ ...rolling, windowKind: "calendar" }, at).toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });
});
