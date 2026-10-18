import { describe, expect, it } from "vitest";
import { OpsgenieClient, OpsgenieError, backoffMs, baseUrlFor } from "../src/client";
import { createDemoAccount, DEMO_KEYS } from "../src/demo-account";
import { checkKey, checksPass } from "../src/inventory";

const noSleep = async () => {};

function demoClient(
  key: string,
  region: "eu" | "us" = "eu",
  opts: Parameters<typeof createDemoAccount>[0] = {},
) {
  const account = createDemoAccount({ alerts: 600, ...opts });
  const client = new OpsgenieClient({ region, key, fetch: account.fetch, sleep: noSleep });
  return { account, client };
}

describe("the client", () => {
  it("talks to the region's host, or to OPSGENIE_API_BASE when set", () => {
    expect(baseUrlFor("eu", "")).toBe("https://api.eu.opsgenie.com");
    expect(baseUrlFor("us", undefined)).toBe("https://api.opsgenie.com");
    expect(baseUrlFor("eu", "http://127.0.0.1:3193/")).toBe("http://127.0.0.1:3193/eu");
  });

  it("authenticates with GenieKey and only ever sends GET", async () => {
    const { account, client } = demoClient(DEMO_KEYS.global);
    await client.users();
    expect(account.calls.length).toBeGreaterThan(0);
    expect(account.calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("pages lists 100 at a time", async () => {
    const { account, client } = demoClient(DEMO_KEYS.global);
    const all = await client.listAll("/v2/alerts", { query: "createdAt>0", order: "asc" }, 1000);
    expect(all.length).toBe(account.alertCount());
    expect(account.calls.filter((c) => c.path === "/v2/alerts").length).toBe(
      Math.ceil(account.alertCount() / 100),
    );
  });

  it("waits and retries on 429, with a growing backoff", async () => {
    const waits: number[] = [];
    const account = createDemoAccount({ alerts: 300, throttleEvery: 3 });
    const client = new OpsgenieClient({
      region: "eu",
      key: DEMO_KEYS.global,
      fetch: account.fetch,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    const users = await client.users();
    const teams = await client.teams();
    const escalations = await client.escalations();
    expect(users.length).toBe(8);
    expect(teams.length).toBe(4);
    expect(escalations.length).toBe(6);
    expect(client.throttled).toBeGreaterThan(0);
    expect(account.calls.some((c) => c.status === 429)).toBe(true);
    expect(waits.every((w) => w === 1000)).toBe(true); // Retry-After: 1
    expect(backoffMs(0, null)).toBe(500);
    expect(backoffMs(3, null)).toBe(4000);
    expect(backoffMs(20, null)).toBe(30_000);
  });

  it("gives up after its retries with a throttled error", async () => {
    const account = createDemoAccount({ alerts: 10, throttleEvery: 1 });
    const client = new OpsgenieClient({
      region: "eu",
      key: DEMO_KEYS.global,
      fetch: account.fetch,
      sleep: noSleep,
      maxRetries: 2,
    });
    await expect(client.teams()).rejects.toMatchObject({ code: "throttled", status: 429 });
  });

  it("refuses to search past the 20 000-alert ceiling", async () => {
    const { client } = demoClient(DEMO_KEYS.global);
    await expect(client.searchAlerts("createdAt>0", 19_950, 100)).rejects.toBeInstanceOf(
      OpsgenieError,
    );
  });
});

describe("checking the key", () => {
  it("passes an account key with Read and Configuration Access", async () => {
    const { client } = demoClient(DEMO_KEYS.global);
    const c = await checkKey(client);
    expect(checksPass(c)).toBe(true);
    expect(c.account).toMatchObject({ ok: true, name: "skylark", teams: 4 });
  });

  it("explains a key without Configuration Access: users, schedules, policies answer 403", async () => {
    const { client } = demoClient(DEMO_KEYS.readOnly);
    const c = await checkKey(client);
    expect(c.read.ok).toBe(true);
    expect(c.config).toEqual({ ok: false, detail: "403" });
    expect(checksPass(c)).toBe(false);
  });

  it("tells a team key from the account's: it sees one team and no account", async () => {
    const { client } = demoClient(DEMO_KEYS.team);
    const c = await checkKey(client);
    expect(c.config.ok).toBe(true);
    expect(c.account.ok).toBe(false);
    expect(c.account.teamKey).toBe(true);
    expect(c.account.teams).toBe(1);
  });

  it("refuses an EU key on the US region", async () => {
    const { client } = demoClient(DEMO_KEYS.global, "us");
    const c = await checkKey(client);
    expect(c.reach.ok).toBe(true);
    expect(c.read).toEqual({ ok: false, detail: "401" });
  });

  it("says when the region cannot be reached", async () => {
    const client = new OpsgenieClient({
      region: "eu",
      key: DEMO_KEYS.global,
      sleep: noSleep,
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const c = await checkKey(client);
    expect(c.reach).toEqual({ ok: false, detail: "unreachable" });
  });
});
