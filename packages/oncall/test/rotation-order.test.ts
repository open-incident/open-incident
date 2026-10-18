import { describe, expect, it } from "vitest";
import { zonedTime } from "../src/time";
import {
  coverageOf,
  nextTurnStarts,
  onCallAt,
  planOrderChange,
  rotationMemberAt,
  rotationQueue,
  sampleOnCall,
  shiftsBetween,
  type RotationLike,
  type TurnCache,
} from "../src/index";

const tz = "Europe/Paris";
const schedule = { timezone: tz, handoverTime: "09:00" };
const at = (m: number, d: number, hhmm: string) => zonedTime(2026, m, d, hhmm, tz);

/** Weekly, handover Wednesday 09:00; turn 0 (29 Jul → 5 Aug) is AL, then KH, then CD. */
const dayEU = (): RotationLike => ({
  id: "r1",
  name: "Day · EU",
  interval: "weekly",
  handoverDay: 3,
  activeStart: "09:00",
  activeEnd: "21:00",
  memberIds: ["AL", "KH", "CD"],
  effectiveFrom: at(8, 3, "09:00"),
  position: 0,
});

/** Applies a planned change the way the server action writes it. */
function apply(rotation: RotationLike, change: ReturnType<typeof planOrderChange>): RotationLike {
  if (!change) return rotation;
  return {
    ...rotation,
    memberIds: change.memberIds,
    effectiveFrom: change.effectiveFrom,
    previousOrders: change.previousOrders,
  };
}

const who = (r: RotationLike, m: number, d: number) =>
  rotationMemberAt(schedule, r, at(m, d, "10:00"));

describe("the order of people", () => {
  it("reads as the person on the current turn, then the turns after the handover", () => {
    const q = rotationQueue(schedule, dayEU(), at(8, 6, "10:00"));
    expect(q.current).toBe("KH");
    expect(q.handoverAt.getTime()).toBe(at(8, 12, "09:00").getTime());
    expect(q.upcoming).toEqual(["CD", "AL"]);
    expect(q.currentStays).toBe(true);
    expect(q.pending).toBe(false);
    expect(nextTurnStarts(schedule, dayEU(), at(8, 6, "10:00"), 2).map((d) => d.getTime())).toEqual(
      [at(8, 12, "09:00").getTime(), at(8, 19, "09:00").getTime()],
    );
  });

  it("a new order starts at the next handover: the shift being worked keeps its person", () => {
    const now = at(8, 6, "10:00");
    const r = apply(dayEU(), planOrderChange(schedule, dayEU(), now, ["AL", "CD"], true));
    expect(r.effectiveFrom.getTime()).toBe(at(8, 12, "09:00").getTime());
    expect(who(r, 8, 4)).toBe("AL"); // the turn before: untouched
    expect(who(r, 8, 6)).toBe("KH"); // the turn being worked: untouched
    expect(who(r, 8, 12)).toBe("AL"); // the next handover: the new order
    expect(who(r, 8, 19)).toBe("CD");
    expect(who(r, 8, 26)).toBe("KH"); // the current person comes back last
    expect(who(r, 9, 2)).toBe("AL");
    const q = rotationQueue(schedule, r, now);
    expect(q).toMatchObject({ current: "KH", upcoming: ["AL", "CD"], pending: true });
  });

  it("removing the person on call lets them finish their turn", () => {
    const now = at(8, 6, "10:00");
    const r = apply(dayEU(), planOrderChange(schedule, dayEU(), now, ["CD", "AL"], false));
    expect(who(r, 8, 6)).toBe("KH");
    expect(who(r, 8, 12)).toBe("CD");
    expect(who(r, 8, 19)).toBe("AL");
    expect(who(r, 8, 26)).toBe("CD");
    expect(rotationQueue(schedule, r, now)).toMatchObject({
      current: "KH",
      currentStays: false,
      upcoming: ["CD", "AL"],
    });
  });

  it("someone added takes a turn before the current person comes back", () => {
    const now = at(8, 6, "10:00");
    const r = apply(dayEU(), planOrderChange(schedule, dayEU(), now, ["CD", "AL", "TM"], true));
    expect([who(r, 8, 12), who(r, 8, 19), who(r, 8, 26), who(r, 9, 2)]).toEqual([
      "CD",
      "AL",
      "TM",
      "KH",
    ]);
  });

  it("a second change before the handover replaces the waiting one instead of stacking", () => {
    const now = at(8, 6, "10:00");
    const once = apply(dayEU(), planOrderChange(schedule, dayEU(), now, ["AL", "CD"], true));
    const twice = apply(once, planOrderChange(schedule, once, now, ["CD", "AL", "TM"], true));
    expect(twice.previousOrders).toHaveLength(1);
    expect(twice.memberIds).toEqual(["CD", "AL", "TM", "KH"]);
    expect(who(twice, 8, 6)).toBe("KH");
    expect(who(twice, 8, 12)).toBe("CD");
    // Putting the waiting order back to what runs today is a change too.
    const back = apply(twice, planOrderChange(schedule, twice, now, ["CD", "AL"], true));
    expect(who(back, 8, 12)).toBe("CD");
    expect(who(back, 8, 19)).toBe("AL");
    expect(who(back, 8, 26)).toBe("KH");
  });

  it("nothing is written when the order does not change", () => {
    expect(planOrderChange(schedule, dayEU(), at(8, 6, "10:00"), ["CD", "AL"], true)).toBeNull();
  });

  it("a later change keeps every earlier order for the turns it decided", () => {
    const first = apply(
      dayEU(),
      planOrderChange(schedule, dayEU(), at(8, 6, "10:00"), ["AL", "CD"], true),
    );
    // A week later, AL holds the turn under the first change; CD leaves.
    const now = at(8, 13, "10:00");
    expect(rotationQueue(schedule, first, now)).toMatchObject({
      current: "AL",
      upcoming: ["CD", "KH"],
    });
    const second = apply(first, planOrderChange(schedule, first, now, ["KH"], true));
    expect(second.previousOrders).toHaveLength(2);
    expect([who(second, 8, 4), who(second, 8, 6), who(second, 8, 13)]).toEqual(["AL", "KH", "AL"]);
    expect([who(second, 8, 19), who(second, 8, 26), who(second, 9, 2)]).toEqual(["KH", "AL", "KH"]);
  });

  it("a rotation with nobody on the current turn starts its new order right away", () => {
    const empty: RotationLike = { ...dayEU(), memberIds: [] };
    const now = at(8, 6, "10:00");
    expect(rotationQueue(schedule, empty, now).current).toBeNull();
    const r = apply(empty, planOrderChange(schedule, empty, now, ["AL", "KH"], true));
    expect(r.effectiveFrom.getTime()).toBe(now.getTime());
    expect(rotationMemberAt(schedule, r, at(8, 6, "09:30"))).toBeNull(); // before the change: nobody
    expect(rotationMemberAt(schedule, r, at(8, 6, "12:00"))).toBe("AL");
    expect(who(r, 8, 12)).toBe("KH");
  });

  it("daily and week-end rotations hand over on their own boundaries", () => {
    const daily: RotationLike = {
      ...dayEU(),
      interval: "daily",
      activeStart: null,
      activeEnd: null,
      memberIds: ["A", "B", "C"],
    };
    const now = at(8, 6, "14:00");
    const q = rotationQueue(schedule, daily, now);
    expect(q.handoverAt.getTime()).toBe(at(8, 7, "09:00").getTime());
    const r = apply(daily, planOrderChange(schedule, daily, now, [...q.upcoming].reverse(), true));
    expect(rotationMemberAt(schedule, r, now)).toBe(q.current);
    expect(rotationMemberAt(schedule, r, at(8, 7, "10:00"))).toBe(q.upcoming[1]);
    expect(rotationMemberAt(schedule, r, at(8, 8, "10:00"))).toBe(q.upcoming[0]);

    const weekend: RotationLike = {
      ...dayEU(),
      interval: "weekend",
      activeStart: null,
      activeEnd: null,
      memberIds: ["A", "B"],
      effectiveFrom: at(7, 20, "09:00"),
    };
    const wq = rotationQueue(schedule, weekend, at(8, 6, "10:00"));
    expect(wq.handoverAt.getTime()).toBe(at(8, 8, "09:00").getTime()); // Saturday
    const w = apply(weekend, planOrderChange(schedule, weekend, at(8, 6, "10:00"), [], false));
    // Nobody left after the handover: that week-end has nobody, the one before is kept.
    expect(rotationMemberAt(schedule, w, at(8, 2, "10:00"))).not.toBeNull();
    expect(rotationMemberAt(schedule, w, at(8, 8, "10:00"))).toBeNull();
  });

  it("the sampled answer, the shifts and coverage agree with the order history", () => {
    const r = apply(
      dayEU(),
      planOrderChange(schedule, dayEU(), at(8, 6, "10:00"), ["AL", "CD"], true),
    );
    const cache: TurnCache = new Map();
    for (const [m, d] of [
      [8, 4],
      [8, 6],
      [8, 12],
      [8, 19],
      [8, 26],
    ] as const) {
      const instant = at(m, d, "10:00");
      const sampled = [...sampleOnCall(schedule, [r], [], instant, cache).members];
      const exact = onCallAt(schedule, [r], [], instant).map((x) => x.memberId);
      expect(sampled).toEqual(exact);
    }
    const shifts = shiftsBetween(schedule, r, [], at(8, 11, "00:00"), at(8, 13, "00:00"));
    expect(shifts.map((s) => s.memberId)).toEqual(["KH", "AL"]);
    const coverage = coverageOf(schedule, [r], [], at(8, 6, "00:00"), at(9, 6, "00:00"));
    expect(coverage.gaps).toHaveLength(0);
  });
});
