import { describe, expect, it } from "vitest";
import { categoryAt, computePay, monthBounds, type PayRulesLike } from "../src/pay";
import type { RotationLike } from "../src/rotation";

const rules: PayRulesLike = {
  currency: "EUR",
  standbyCents: 200,
  nightCents: 300,
  weekendCents: 400,
  holidayCents: 500,
  nightStart: "22:00",
  nightEnd: "07:00",
  holidays: ["2026-09-08"],
};
const schedule = { timezone: "Europe/Paris", handoverTime: "09:00" };
const day = (iso: string) => new Date(iso);

describe("pay", () => {
  it("classifies instants: holiday first, then weekend, then night across midnight, else standby", () => {
    const hol = new Set(rules.holidays);
    expect(categoryAt(rules, day("2026-09-08T10:00:00Z"), "Europe/Paris", hol)).toBe("holiday");
    expect(categoryAt(rules, day("2026-09-05T10:00:00Z"), "Europe/Paris", hol)).toBe("weekend"); // Saturday
    expect(categoryAt(rules, day("2026-09-07T21:00:00Z"), "Europe/Paris", hol)).toBe("night"); // 23:00 Paris
    expect(categoryAt(rules, day("2026-09-08T04:00:00Z"), "Europe/Paris", hol)).toBe("holiday"); // 06:00 Paris on the holiday
    expect(categoryAt(rules, day("2026-09-09T04:00:00Z"), "Europe/Paris", hol)).toBe("night"); // 06:00 Paris
    expect(categoryAt(rules, day("2026-09-09T10:00:00Z"), "Europe/Paris", hol)).toBe("standby");
  });

  it("prices a 24/7 rotation over a weekday: 9 night hours at 3 €, 15 standby hours at 2 €", () => {
    const rotation: RotationLike = {
      id: "r1",
      name: "Primary",
      interval: "weekly",
      handoverDay: 1,
      activeStart: null,
      activeEnd: null,
      memberIds: ["amelie"],
      effectiveFrom: day("2026-08-03T07:00:00Z"),
      position: 0,
    };
    // Wednesday 9 Sept 2026, 00:00 → Thursday 00:00 Paris (22:00Z the day before → 22:00Z).
    const lines = computePay(
      rules,
      [{ id: "s1", schedule, rotations: [rotation], overrides: [] }],
      day("2026-09-08T22:00:00Z"),
      day("2026-09-09T22:00:00Z"),
    );
    expect(lines).toHaveLength(1);
    const l = lines[0]!;
    expect(l.memberId).toBe("amelie");
    expect(l.minutes.night).toBe(9 * 60);
    expect(l.minutes.standby).toBe(15 * 60);
    expect(l.minutes.weekend).toBe(0);
    expect(l.amountCents).toBe(9 * 300 + 15 * 200);
  });

  it("bounds a month in the schedule's zone", () => {
    const b = monthBounds("2026-08", "Europe/Paris");
    expect(b.from.toISOString()).toBe("2026-07-31T22:00:00.000Z");
    expect(b.to.toISOString()).toBe("2026-08-31T22:00:00.000Z");
  });
});
