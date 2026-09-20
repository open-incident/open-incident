/**
 * When a bug counts as news.
 *
 * The rule decides whether a phone rings, so the tests are written from the
 * ways it could be wrong in each direction: a genuinely new bug staying quiet,
 * and an ordinary Tuesday paging somebody. The surge floor and the repeat
 * window exist entirely because of the second.
 */
import { describe, expect, it } from "vitest";
import {
  REPEAT_AFTER_HOURS,
  SURGE_FLOOR,
  SURGE_MULTIPLE,
  regressionOf,
} from "../src/exception-regressions";
import type { GroupRate } from "@openincident/telemetry";

const NOW = new Date("2026-09-20T12:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

function rate(over: Partial<GroupRate> = {}): GroupRate {
  return {
    fingerprint: "abc",
    type: "PoolTimeout",
    message: "pool exhausted",
    firstSeen: "2026-09-20 11:00:00",
    lastSeen: "2026-09-20 11:59:00",
    lastHour: 3,
    usualHour: 0,
    hoursOfHistory: 0,
    ...over,
  };
}

const open = { status: "open", snoozedUntil: null, resolvedAt: null, lastAlertedAt: null };

describe("what counts as a regression", () => {
  it("a fingerprint nobody has seen is new", () => {
    expect(regressionOf(rate(), undefined, NOW)).toBe("new");
  });

  it("a group that was resolved and fires again is reopened", () => {
    expect(regressionOf(rate(), { ...open, status: "resolved", resolvedAt: ago(48) }, NOW)).toBe(
      "reopened",
    );
  });

  it("a known group firing at its usual rate is not news", () => {
    expect(regressionOf(rate({ lastHour: 40, usualHour: 38 }), open, NOW)).toBeNull();
  });

  it("a known group firing far more than usual is a surge", () => {
    expect(regressionOf(rate({ lastHour: SURGE_FLOOR * 4, usualHour: 5 }), open, NOW)).toBe(
      "surge",
    );
  });

  it("does not call a rare bug's second occurrence a surge", () => {
    // Twice a usual of one is a multiple of two; five times it is still five
    // occurrences, which is not an incident. The floor is what says so.
    expect(regressionOf(rate({ lastHour: 5, usualHour: 1 }), open, NOW)).toBeNull();
    expect(regressionOf(rate({ lastHour: SURGE_FLOOR, usualHour: 1 }), open, NOW)).toBe("surge");
  });

  it("needs the multiple as well as the floor", () => {
    expect(
      regressionOf(rate({ lastHour: SURGE_FLOOR * 2, usualHour: SURGE_FLOOR }), open, NOW),
    ).toBeNull();
    expect(
      regressionOf(
        rate({ lastHour: SURGE_FLOOR * SURGE_MULTIPLE, usualHour: SURGE_FLOOR }),
        open,
        NOW,
      ),
    ).toBe("surge");
  });

  it("a group with no history at all cannot surge", () => {
    // Dividing by a usual of zero would make every first hour infinitely
    // anomalous, and a brand new group is already reported as new.
    expect(regressionOf(rate({ lastHour: 1000, usualHour: 0 }), open, NOW)).toBeNull();
  });

  it("says nothing about a group that did not fire this hour", () => {
    expect(regressionOf(rate({ lastHour: 0 }), undefined, NOW)).toBeNull();
  });
});

describe("the states that buy quiet", () => {
  it("an ignored group never pages, whatever it does", () => {
    expect(
      regressionOf(rate({ lastHour: 5000, usualHour: 1 }), { ...open, status: "ignored" }, NOW),
    ).toBeNull();
  });

  it("a snoozed group is quiet until its snooze runs out, then is not", () => {
    const snoozed = { ...open, status: "snoozed" as const, snoozedUntil: ago(-2) };
    expect(regressionOf(rate({ lastHour: 5000, usualHour: 1 }), snoozed, NOW)).toBeNull();
    const expired = { ...snoozed, snoozedUntil: ago(1) };
    expect(regressionOf(rate({ lastHour: 5000, usualHour: 1 }), expired, NOW)).toBe("surge");
  });

  it("does not page twice for the same group in a row", () => {
    // A surge that lasts four hours is one problem. The alert it raised is
    // still open in the pipeline; a second one would be a second incident.
    const just = { ...open, lastAlertedAt: ago(1) };
    expect(regressionOf(rate({ lastHour: 5000, usualHour: 1 }), just, NOW)).toBeNull();
    const older = { ...open, lastAlertedAt: ago(REPEAT_AFTER_HOURS + 1) };
    expect(regressionOf(rate({ lastHour: 5000, usualHour: 1 }), older, NOW)).toBe("surge");
  });

  it("a resolved group that comes back is reopened even long after", () => {
    const resolved = {
      ...open,
      status: "resolved" as const,
      resolvedAt: ago(1000),
      lastAlertedAt: ago(1000),
    };
    expect(regressionOf(rate(), resolved, NOW)).toBe("reopened");
  });
});
