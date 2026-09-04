import { describe, expect, it } from "vitest";
import {
  componentStateForImpact,
  computeUptime,
  dayTicks,
  impactForSeverityRank,
  overallState,
} from "../src/uptime";
import { atomFeed, rssFeed } from "../src/feeds";

const D = 86_400_000;
const now = new Date("2026-09-04T12:00:00Z");

describe("status page math", () => {
  it("computes uptime over a window and ignores maintenance", () => {
    const from = new Date(now.getTime() - 90 * D);
    const intervals = [
      {
        state: "degraded",
        fromAt: new Date(now.getTime() - 10 * D),
        toAt: new Date(now.getTime() - 10 * D + 9 * 3_600_000),
      }, // 9 h down
      {
        state: "maintenance",
        fromAt: new Date(now.getTime() - 5 * D),
        toAt: new Date(now.getTime() - 5 * D + 3_600_000),
      },
    ];
    expect(computeUptime(intervals, from, now)).toBe(99.58);
    expect(computeUptime([], from, now)).toBe(100);
    // an open stretch counts until now
    expect(
      computeUptime(
        [{ state: "major_outage", fromAt: new Date(now.getTime() - 9 * D), toAt: null }],
        from,
        now,
      ),
    ).toBe(90);
  });

  it("paints the worst state of each day, oldest first", () => {
    const ticks = dayTicks(
      [
        {
          state: "degraded",
          fromAt: new Date(now.getTime() - 3 * D),
          toAt: new Date(now.getTime() - 3 * D + 60_000),
        },
        {
          state: "major_outage",
          fromAt: new Date(now.getTime() - 3 * D + 120_000),
          toAt: new Date(now.getTime() - 3 * D + 180_000),
        },
      ],
      30,
      now,
    );
    expect(ticks).toHaveLength(30);
    expect(ticks[26]).toBe("major_outage");
    expect(ticks.filter((t) => t !== "operational")).toHaveLength(1);
  });

  it("maps severities to impacts and picks the overall state", () => {
    expect(impactForSeverityRank(0)).toBe("major_outage");
    expect(impactForSeverityRank(1)).toBe("degraded");
    expect(impactForSeverityRank(3)).toBe("none");
    expect(componentStateForImpact("none")).toBe("operational");
    expect(overallState(["operational", "maintenance", "degraded"])).toBe("degraded");
    expect(overallState([])).toBe("operational");
  });

  it("builds valid-looking feeds", () => {
    const snap = {
      page: {
        id: "p",
        name: "Skylark <Status>",
        slug: "skylark",
        customDomain: null,
        customDomainVerified: false,
        locale: "en",
        accentColor: "#000",
        logoUrl: null,
        visibility: "public" as const,
        noindex: true,
        privacyUrl: null,
        legalUrl: null,
      },
      overall: "operational",
      components: [],
      incidents: [
        {
          id: "i1",
          title: "Checkout slow",
          status: "resolved",
          impact: "degraded",
          components: ["Checkout"],
          startedAt: "2026-08-26T12:17:00Z",
          resolvedAt: "2026-08-26T13:32:00Z",
          updates: [
            { status: "resolved", body: "Back to normal & stable.", at: "2026-08-26T13:32:00Z" },
          ],
        },
      ],
      maintenances: [],
      subscribers: 0,
      generatedAt: now.toISOString(),
    };
    const rss = rssFeed(snap, "https://status.example");
    expect(rss).toContain("<title>Skylark &lt;Status&gt;</title>");
    expect(rss).toContain("Back to normal &amp; stable.");
    expect(atomFeed(snap, "https://status.example")).toContain(
      '<feed xmlns="http://www.w3.org/2005/Atom">',
    );
  });
});
