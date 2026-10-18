import { describe, expect, it } from "vitest";
import { OpsgenieClient } from "../src/client";
import { compareSchedule, oiMembersAt } from "../src/compare";
import {
  convertCriteria,
  convertRestriction,
  delaysOf,
  describeSchedule,
  detectPrecedence,
  escalationGraph,
  inGate,
  shapeSchedule,
  type PeopleIndex,
  type ScheduleShape,
} from "../src/convert";
import { createDemoAccount, DEMO_KEYS } from "../src/demo-account";
import { futureSlots, readInventory } from "../src/inventory";
import { alertFromWebhook, attributesOf, ogMatchRule } from "../src/og-routing";
import { quarters, splitUnderCeiling } from "../src/windows";
import { conditionsHold } from "@openincident/oncall";

const now = new Date("2026-10-18T10:00:00Z");

async function inventory() {
  const account = createDemoAccount({ now, alerts: 900 });
  const client = new OpsgenieClient({
    region: "eu",
    key: DEMO_KEYS.global,
    fetch: account.fetch,
    sleep: async () => {},
  });
  const snap = await readInventory(client, now);
  return { account, client, snap };
}

/** Everybody matched to a member named after their Opsgenie id, except who the test says. */
function peopleFor(
  snap: Awaited<ReturnType<typeof inventory>>["snap"],
  overrides: Record<string, string | null> = {},
): PeopleIndex {
  const p: PeopleIndex = new Map();
  for (const u of snap.users) {
    const key = u.username.split("@")[0]!.split(".")[0]!;
    p.set(u.id, key in overrides ? (overrides[key] ?? `~${u.id}`) : `m-${key}`);
  }
  return p;
}

describe("the inventory of the demo account", () => {
  it("reads everything the design counts", async () => {
    const { snap } = await inventory();
    expect(snap.account).toBe("skylark");
    expect(snap.users).toHaveLength(8);
    expect(snap.teams).toHaveLength(4);
    expect(snap.schedules).toHaveLength(5);
    expect(snap.escalations).toHaveLength(6);
    expect(snap.teams.reduce((n, t) => n + t.routingRules.length, 0)).toBe(11);
    expect(snap.integrations).toHaveLength(10);
    expect(snap.heartbeats).toHaveLength(2);
    expect(snap.alerts.total).toBe(900);
    expect(snap.alerts.p5In90d).toBeGreaterThan(0);
    expect(snap.schedules.every((s) => s.timeline?.finalTimeline?.rotations?.length)).toBe(true);
  });

  it("counts each person's future slots from Opsgenie's final timeline", async () => {
    const { snap, account } = await inventory();
    const slots = futureSlots(snap.schedules, now);
    expect(slots.get(account.ids.user("ana"))).toBeGreaterThan(0);
    expect(slots.get(account.ids.user("sam"))).toBeGreaterThan(0);
    expect(slots.get(account.ids.user("claire")) ?? 0).toBe(0);
  });
});

describe("schedules", () => {
  it("reads precedence from the timeline: Weekend hides Base on Payments primary", async () => {
    const { snap } = await inventory();
    const payments = snap.schedules.find((s) => s.name === "Payments primary")!;
    expect(detectPrecedence(payments.timeline)).toBe(true);
    expect(describeSchedule(payments)).toEqual({
      kind: "layers",
      count: 2,
      detail: "weekend-on-top",
    });
    const platform = snap.schedules.find((s) => s.name === "Platform primary")!;
    expect(detectPrecedence(platform.timeline)).toBe(false);
    expect(describeSchedule(platform)).toEqual({
      kind: "rotations",
      count: 2,
      detail: "follow-the-sun",
    });
    expect(describeSchedule(snap.schedules.find((s) => s.name === "Security")!).detail).toBe(
      "business-hours",
    );
    expect(describeSchedule(snap.schedules.find((s) => s.name === "Weekend support")!).detail).toBe(
      "weekend",
    );
  });

  it("turns a weekday restriction into a gate, and a weekend span into whole days", () => {
    const biz = convertRestriction(
      {
        type: "weekday-and-time-of-day",
        restrictions: (["monday", "tuesday", "wednesday", "thursday", "friday"] as const).map(
          (d) => ({
            startDay: d,
            startHour: 9,
            startMin: 0,
            endDay: d,
            endHour: 18,
            endMin: 0,
          }),
        ),
      },
      "Europe/Paris",
    );
    expect(biz).toMatchObject({ activeStart: "09:00", activeEnd: "18:00", exact: true });
    expect(biz.gate?.days).toEqual([1, 2, 3, 4, 5]);
    const weekend = convertRestriction(
      {
        type: "weekday-and-time-of-day",
        restrictions: [
          {
            startDay: "saturday",
            startHour: 0,
            startMin: 0,
            endDay: "monday",
            endHour: 0,
            endMin: 0,
          },
        ],
      },
      "Europe/Paris",
    );
    expect(weekend.gate).toMatchObject({ days: [6, 7], startTime: "00:00", endTime: "00:00" });
    expect(inGate(new Date("2026-10-24T12:00:00Z"), weekend.gate!)).toBe(true); // a Saturday
    expect(inGate(new Date("2026-10-26T12:00:00Z"), weekend.gate!)).toBe(false); // a Monday
  });

  it("agrees with Opsgenie slot by slot for eight weeks once everybody is matched", async () => {
    const { snap } = await inventory();
    const people = peopleFor(snap);
    const active = new Set([...people.values()].filter((m): m is string => Boolean(m)));
    const names = new Map(snap.users.map((u) => [u.id, u.fullName]));
    const to = new Date(now.getTime() + 8 * 7 * 86_400_000);
    for (const s of snap.schedules) {
      const shape = shapeSchedule(s, people);
      const diffs = compareSchedule(s, shape, people, active, names, now, to);
      expect({ schedule: s.name, diffs: diffs.length }).toEqual({ schedule: s.name, diffs: 0 });
    }
  });

  it("shows a pending invitation as a slot that pages nobody here", async () => {
    const { snap } = await inventory();
    const people = peopleFor(snap);
    const active = new Set(
      [...people.values()].filter((m): m is string => Boolean(m) && m !== "m-sam"),
    );
    const names = new Map(snap.users.map((u) => [u.id, u.fullName]));
    const weekend = snap.schedules.find((s) => s.name === "Weekend support")!;
    const shape = shapeSchedule(weekend, people);
    const diffs = compareSchedule(
      weekend,
      shape,
      people,
      active,
      names,
      now,
      new Date(now.getTime() + 56 * 86_400_000),
    );
    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs.every((d) => d.cause === "pending" && d.oi.length === 0)).toBe(true);
    expect(diffs[0]!.og[0]!.name).toBe("Sam Okafor");
  });

  it("evaluates layers top first: Weekend inside its window, Base outside", async () => {
    const { snap, account } = await inventory();
    const people = peopleFor(snap);
    const shape: ScheduleShape = shapeSchedule(
      snap.schedules.find((s) => s.name === "Payments primary")!,
      people,
    );
    expect(shape.mode).toBe("precedence");
    expect(shape.parts.map((p) => p.key)).toEqual([
      account.ids.rotation("payments-weekend"),
      account.ids.rotation("payments-base"),
    ]);
    const saturday = oiMembersAt(shape, new Date("2026-10-24T13:00:00Z"));
    expect(saturday.partKey).toBe(account.ids.rotation("payments-weekend"));
    const tuesday = oiMembersAt(shape, new Date("2026-10-20T13:00:00Z"));
    expect(tuesday.partKey).toBe(account.ids.rotation("payments-base"));
  });
});

describe("escalations", () => {
  it("turns absolute delays into relative ones", async () => {
    const { snap } = await inventory();
    const platform = snap.escalations.find((e) => e.name === "Platform primary")!;
    expect(delaysOf(platform)).toEqual({ absolute: [0, 10, 25], relative: [0, 10, 15] });
  });

  it("builds levels with relative timeouts, conditions for layers, and a retry for a repeat", async () => {
    const { snap } = await inventory();
    const people = peopleFor(snap);
    const shapes = new Map(snap.schedules.map((s) => [s.id, shapeSchedule(s, people)]));
    const ctx = {
      member: (id: string) => people.get(id) ?? null,
      team: (id: string) => `team-${id}`,
      schedule: (id: string) => shapes.get(id) ?? null,
    };
    const platform = escalationGraph(
      snap.escalations.find((e) => e.name === "Platform primary")!,
      ctx,
    );
    const levels = platform.graph.nodes.filter((n) => n.kind === "level");
    expect(levels.map((n) => n.kind === "level" && n.ackTimeoutMinutes)).toEqual([10, 15, 30]);
    const payments = escalationGraph(
      snap.escalations.find((e) => e.name === "Payments escalation")!,
      ctx,
    );
    const kinds = payments.graph.nodes.map((n) => n.kind);
    expect(kinds).toContain("condition");
    expect(kinds).toContain("retry");
    const retry = payments.graph.nodes.find((n) => n.kind === "retry")!;
    expect(retry).toMatchObject({
      maxLoops: 2,
      intervalMinutes: 10,
      toNodeId: payments.graph.start,
    });
    // Every leaf of the first level leads to the second level's entry.
    const start = payments.graph.nodes.find((n) => n.id === payments.graph.start)!;
    expect(start.kind).toBe("condition");
  });
});

describe("routing", () => {
  it("converts criteria into condition groups the product's matcher reads", () => {
    const { groups, dropped } = convertCriteria(
      {
        type: "match-all-conditions",
        conditions: [
          { field: "tags", operation: "contains", expectedValue: "checkout" },
          { field: "priority", operation: "less-than", expectedValue: "P3" },
          { field: "recipients", operation: "contains", expectedValue: "x" },
        ],
      },
      { p5ToP4: true },
    );
    expect(dropped).toHaveLength(1);
    expect(groups).toEqual([
      {
        all: [
          { attribute: "tags", op: "contains", value: "checkout" },
          { attribute: "priority", op: "in", value: "P1,P2" },
        ],
      },
    ]);
    // P5 is P4 here: a rule that told them apart cannot be kept.
    expect(
      convertCriteria(
        {
          type: "match-all-conditions",
          conditions: [{ field: "priority", operation: "equals", expectedValue: "P5" }],
        },
        { p5ToP4: true },
      ),
    ).toMatchObject({ groups: [], dropped: [{ field: "priority" }] });
    const ctx = {
      attributes: attributesOf(
        {
          id: "a",
          message: "x",
          alias: "",
          description: "",
          source: "Sentry",
          entity: "",
          tags: ["checkout", "service:checkout"],
          priority: "P2",
          details: {},
          teams: [],
          createdAt: now,
        },
        true,
      ),
      source: { kind: "sentry", name: "Sentry", id: "s" },
      priority: "P2",
      title: "x",
    };
    expect(conditionsHold(groups, ctx)).toBe(true);
  });

  it("replays Opsgenie's rules, time restrictions included", async () => {
    const { snap, account } = await inventory();
    const storefront = snap.teams.find((t) => t.name === "Storefront")!;
    const hook = (at: Date, priority: "P3" | "P2") =>
      alertFromWebhook(account.webhookFor("sentry", at, { priority }) as never)!;
    const night = ogMatchRule(
      storefront.routingRules,
      hook(new Date("2026-10-20T22:30:00Z"), "P3"),
    );
    expect(night?.name).toBe("Checkout P3 at night");
    const day = ogMatchRule(storefront.routingRules, hook(new Date("2026-10-20T13:00:00Z"), "P3"));
    expect(day?.name).toBe("Default");
  });
});

describe("archive windows", () => {
  it("cuts the history in quarters, halved until under the ceiling", async () => {
    const qs = quarters(new Date("2025-01-06T00:00:00Z"), now);
    expect(qs.map((q) => q.label)).toEqual([
      "2025 Q1",
      "2025 Q2",
      "2025 Q3",
      "2025 Q4",
      "2026 Q1",
      "2026 Q2",
      "2026 Q3",
      "2026 Q4",
    ]);
    // 50 000 alerts spread evenly over a quarter: four windows of 12 500.
    const span = qs[0]!;
    const perMs = 50_000 / (span.to.getTime() - span.from.getTime());
    const windows = await splitUnderCeiling(
      span,
      async (f, t) => Math.round((t.getTime() - f.getTime()) * perMs),
      20_000,
    );
    expect(windows).toHaveLength(4);
    expect(windows.every((w) => w.count < 20_000)).toBe(true);
  });
});
