import { describe, expect, it } from "vitest";
import { inWorkingHours, nextWorkingHoursStart, zonedTime } from "../src/time";
import {
  nextOnCall,
  onCallAt,
  rotationMemberAt,
  shiftsBetween,
  type OverrideLike,
  type RotationLike,
} from "../src/rotation";

const schedule = { timezone: "Europe/Paris", handoverTime: "09:00" };
const eff = zonedTime(2026, 8, 3, "09:00", "Europe/Paris"); // Monday 3 Aug 2026
const dayEU: RotationLike = {
  id: "r1",
  name: "Jour EU",
  interval: "weekly",
  handoverDay: 3,
  activeStart: "09:00",
  activeEnd: "21:00",
  memberIds: ["AL", "KH", "CD"],
  effectiveFrom: eff,
  position: 0,
};
const nightUS: RotationLike = {
  id: "r2",
  name: "Nuit US",
  interval: "weekly",
  handoverDay: 3,
  activeStart: "21:00",
  activeEnd: "09:00",
  memberIds: ["NB", "LG"],
  effectiveFrom: eff,
  position: 1,
};

describe("rotation math", () => {
  it("hands over weekly on the handover weekday and cycles members in order", () => {
    // Anchor: Wednesday 29 Jul 2026 09:00 (the handover weekday at/before effectiveFrom) → turn 0 = AL.
    expect(rotationMemberAt(schedule, dayEU, zonedTime(2026, 8, 4, "10:00", "Europe/Paris"))).toBe(
      "AL",
    ); // Tue 4 Aug
    expect(rotationMemberAt(schedule, dayEU, zonedTime(2026, 8, 5, "10:00", "Europe/Paris"))).toBe(
      "KH",
    ); // Wed 5 Aug, after handover
    expect(rotationMemberAt(schedule, dayEU, zonedTime(2026, 8, 4, "20:59", "Europe/Paris"))).toBe(
      "AL",
    ); // last minute of the active day
    expect(
      rotationMemberAt(schedule, dayEU, zonedTime(2026, 8, 5, "08:59", "Europe/Paris")),
    ).toBeNull(); // before active hours: nobody
    expect(rotationMemberAt(schedule, dayEU, zonedTime(2026, 8, 12, "10:00", "Europe/Paris"))).toBe(
      "CD",
    );
    expect(rotationMemberAt(schedule, dayEU, zonedTime(2026, 8, 19, "10:00", "Europe/Paris"))).toBe(
      "AL",
    );
  });

  it("respects active hours, including a range that wraps past midnight", () => {
    expect(
      rotationMemberAt(schedule, dayEU, zonedTime(2026, 8, 4, "22:00", "Europe/Paris")),
    ).toBeNull();
    expect(
      rotationMemberAt(schedule, nightUS, zonedTime(2026, 8, 4, "22:00", "Europe/Paris")),
    ).toBe("NB");
    expect(
      rotationMemberAt(schedule, nightUS, zonedTime(2026, 8, 5, "03:00", "Europe/Paris")),
    ).toBe("NB");
    expect(
      rotationMemberAt(schedule, nightUS, zonedTime(2026, 8, 5, "12:00", "Europe/Paris")),
    ).toBeNull();
  });

  it("lets an override win, including NOBODY, and tells who is next", () => {
    const overrides: OverrideLike[] = [
      {
        id: "o1",
        rotationId: "r1",
        memberId: "LG",
        startAt: zonedTime(2026, 8, 4, "09:00", "Europe/Paris"),
        endAt: zonedTime(2026, 8, 4, "21:00", "Europe/Paris"),
        reason: "cover",
      },
      {
        id: "o2",
        rotationId: "r1",
        memberId: null,
        startAt: zonedTime(2026, 8, 6, "09:00", "Europe/Paris"),
        endAt: zonedTime(2026, 8, 6, "12:00", "Europe/Paris"),
        reason: "override",
      },
    ];
    const now = onCallAt(
      schedule,
      [dayEU, nightUS],
      overrides,
      zonedTime(2026, 8, 4, "10:00", "Europe/Paris"),
    );
    expect(now.map((x) => [x.rotationName, x.memberId, x.override])).toEqual([
      ["Jour EU", "LG", true],
    ]);
    const gap = onCallAt(
      schedule,
      [dayEU],
      overrides,
      zonedTime(2026, 8, 6, "10:00", "Europe/Paris"),
    );
    expect(gap[0]?.memberId).toBeNull();
    expect(nextOnCall(schedule, dayEU, [], zonedTime(2026, 8, 4, "10:00", "Europe/Paris"))).toBe(
      "KH",
    );
  });

  it("cuts shifts at handovers, active hours and overrides", () => {
    const from = zonedTime(2026, 8, 4, "00:00", "Europe/Paris");
    const to = zonedTime(2026, 8, 6, "00:00", "Europe/Paris");
    const shifts = shiftsBetween(
      schedule,
      dayEU,
      [
        {
          id: "o1",
          rotationId: "r1",
          memberId: "LG",
          startAt: zonedTime(2026, 8, 4, "14:00", "Europe/Paris"),
          endAt: zonedTime(2026, 8, 4, "16:00", "Europe/Paris"),
          reason: "cover",
        },
      ],
      from,
      to,
    );
    expect(shifts.map((s) => `${s.memberId}${s.override ? "*" : ""}`)).toEqual([
      "AL",
      "LG*",
      "AL",
      "KH",
    ]);
    expect(shifts[2]!.endAt.getTime()).toBe(
      zonedTime(2026, 8, 4, "21:00", "Europe/Paris").getTime(),
    );
    expect(shifts[3]!.startAt.getTime()).toBe(
      zonedTime(2026, 8, 5, "09:00", "Europe/Paris").getTime(),
    );
  });

  it("knows working hours and when they next open", () => {
    const eu = {
      timezone: "Europe/Paris",
      days: [1, 2, 3, 4, 5],
      startTime: "09:00",
      endTime: "18:00",
    };
    expect(inWorkingHours(zonedTime(2026, 8, 4, "10:00", "Europe/Paris"), eu)).toBe(true);
    expect(inWorkingHours(zonedTime(2026, 8, 8, "10:00", "Europe/Paris"), eu)).toBe(false); // Saturday
    const friday = zonedTime(2026, 8, 7, "19:00", "Europe/Paris");
    expect(nextWorkingHoursStart(friday, eu).getTime()).toBe(
      zonedTime(2026, 8, 10, "09:00", "Europe/Paris").getTime(),
    );
    const us = {
      timezone: "America/New_York",
      days: [1, 2, 3, 4, 5],
      startTime: "15:00",
      endTime: "00:00",
    };
    expect(inWorkingHours(zonedTime(2026, 8, 4, "23:00", "America/New_York"), us)).toBe(true);
  });
});
