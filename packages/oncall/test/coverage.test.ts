import { describe, expect, it } from "vitest";
import { coverageOf, upcomingGaps } from "../src/coverage";
import type { RotationLike } from "../src/rotation";

const schedule = { timezone: "Europe/Paris", handoverTime: "09:00" };
const day = (iso: string) => new Date(iso);

describe("coverage", () => {
  it("finds no gap in a 24/7 weekly rotation with members", () => {
    const rotation: RotationLike = {
      id: "r1",
      name: "Primary",
      interval: "weekly",
      handoverDay: 1,
      activeStart: null,
      activeEnd: null,
      memberIds: ["a", "b"],
      effectiveFrom: day("2026-08-03T07:00:00Z"),
      position: 0,
    };
    const c = coverageOf(
      schedule,
      [rotation],
      [],
      day("2026-09-07T00:00:00Z"),
      day("2026-09-21T00:00:00Z"),
    );
    expect(c.gaps).toEqual([]);
    expect(c.coveredRatio).toBe(1);
  });

  it("expects only the declared hours: an office rotation has no gaps at night, an empty turn or a null override does", () => {
    const office: RotationLike = {
      id: "r2",
      name: "Office",
      interval: "daily",
      handoverDay: 1,
      activeStart: "09:00",
      activeEnd: "18:00",
      memberIds: ["a"],
      effectiveFrom: day("2026-08-03T07:00:00Z"),
      position: 0,
    };
    const c = coverageOf(
      schedule,
      [office],
      [],
      day("2026-09-07T07:00:00Z"),
      day("2026-09-09T07:00:00Z"),
    );
    expect(c.gaps).toEqual([]);
    expect(c.coveredRatio).toBe(1);
    const nobody: RotationLike = { ...office, id: "r3", memberIds: [] };
    const empty = coverageOf(
      schedule,
      [nobody],
      [],
      day("2026-09-07T07:00:00Z"),
      day("2026-09-08T07:00:00Z"),
    );
    expect(empty.gaps).toHaveLength(1);
    expect(empty.uncoveredMinutes).toBe(9 * 60);
    expect(empty.coveredRatio).toBe(0);
    const covered: RotationLike = { ...office, activeStart: null, activeEnd: null };
    const withHole = coverageOf(
      schedule,
      [covered],
      [
        {
          id: "o1",
          rotationId: "r2",
          memberId: null,
          startAt: day("2026-09-07T10:00:00Z"),
          endAt: day("2026-09-07T12:00:00Z"),
          reason: "sick",
        },
      ],
      day("2026-09-07T07:00:00Z"),
      day("2026-09-08T07:00:00Z"),
    );
    expect(withHole.gaps).toHaveLength(1);
    expect(withHole.gaps[0]!.minutes).toBe(120);
    expect(upcomingGaps(withHole, day("2026-09-07T08:00:00Z"), 1)).toHaveLength(1);
    expect(upcomingGaps(withHole, day("2026-09-07T13:00:00Z"), 1)).toHaveLength(0);
  });
});
