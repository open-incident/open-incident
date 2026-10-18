import { describe, expect, it } from "vitest";
import { advanceCursor, fetchPage, planArchive } from "../src/archive";
import { OpsgenieClient } from "../src/client";
import { createDemoAccount, DEMO_KEYS } from "../src/demo-account";

const now = new Date("2026-10-18T10:00:00Z");

describe("the archive", () => {
  it("reads every window page by page, each alert's details one by one, and can resume", async () => {
    const account = createDemoAccount({ now, alerts: 450, throttleEvery: 40 });
    const client = new OpsgenieClient({
      region: "eu",
      key: DEMO_KEYS.global,
      fetch: account.fetch,
      sleep: async () => {},
    });
    let cursor = await planArchive(client, new Date("2025-01-06T00:00:00Z"), now);
    expect(cursor.windows.map((w) => w.label)[0]).toBe("2025 Q1");
    expect(cursor.total).toBe(450);
    const seen = new Set<string>();
    let pages = 0;
    // Stop half-way, keep only the cursor, carry on: nothing read twice, nothing missed.
    for (let pass = 0; pass < 2; pass++) {
      const stored = JSON.parse(JSON.stringify(cursor)) as typeof cursor;
      cursor = stored;
      for (let i = 0; i < (pass === 0 ? 3 : 100); i++) {
        const page = await fetchPage(client, cursor);
        if (!page) break;
        pages++;
        for (const a of page.alerts) {
          expect(seen.has(a.id)).toBe(false);
          seen.add(a.id);
          expect(a.details).toBeDefined(); // the detail call, not the list item
        }
        cursor = advanceCursor(cursor, page.index, page.listed, {
          imported: page.alerts.filter((a) => a.status === "closed").length,
          skipped: page.alerts.filter((a) => a.status !== "closed").length,
        });
      }
    }
    expect(seen.size).toBe(450);
    expect(cursor.windows.every((w) => w.done)).toBe(true);
    expect(cursor.finishedAt).toBeTruthy();
    expect(cursor.imported + cursor.skipped).toBe(450);
    expect(pages).toBeGreaterThanOrEqual(cursor.windows.filter((w) => w.count > 0).length);
    expect(
      account.calls.filter(
        (c) =>
          /^\/v2\/alerts\/[^/]+$/.test(c.path) && c.path !== "/v2/alerts/count" && c.status === 200,
      ).length,
    ).toBe(450);
    expect(account.calls.every((c) => c.method === "GET")).toBe(true);
  });
});
