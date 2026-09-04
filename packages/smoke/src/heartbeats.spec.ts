import { expect, request, test } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { MEMBERS, signIn } from "./helpers";

/**
 * Heartbeats: a URL to ping; silence beyond interval + grace raises an alert
 * through the workspace's Heartbeats source; the next ping resolves it. The
 * shortest interval (10 s) and the 30 s worker sweep keep the whole cycle
 * inside one test.
 */
test.describe("Heartbeats", () => {
  test("ping → up, silence → alert, ping → resolved", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/heartbeats?new=1");
    const name = `Smoke cron ${Date.now().toString(36)}`;
    await page.getByTestId("heartbeat-form").locator('input[name="name"]').fill(name);
    // 10 s is below the shortest option: the select is bypassed by setting the value directly, as an operator's API client could.
    await page
      .getByTestId("heartbeat-form")
      .locator('select[name="intervalSeconds"]')
      .evaluate((el) => {
        const s = el as HTMLSelectElement;
        const o = document.createElement("option");
        o.value = "10";
        o.textContent = "10 s";
        s.append(o);
        s.value = "10";
      });
    await page
      .getByTestId("heartbeat-form")
      .locator('select[name="graceSeconds"]')
      .selectOption("0");
    await page.getByTestId("heartbeat-save").click();
    await page.waitForURL(/created=/);
    const row = page.getByTestId("heartbeat-row").filter({ hasText: name });
    await expect(row.getByTestId("heartbeat-status")).toContainText(/waiting|attente|wartet/i);
    const url = (await row
      .getByTestId("heartbeat-url")
      .locator("input, code")
      .first()
      .inputValue()
      .catch(async () => (await row.getByTestId("heartbeat-url").textContent()) ?? "")) as string;
    expect(url).toMatch(/\/api\/heartbeats\/[0-9a-f-]{36}\/[0-9a-f]{32}$/);

    const api = await request.newContext({ baseURL: BASE_URL });
    // A wrong token is a 404 and records nothing.
    expect((await api.get(url.replace(/[0-9a-f]{32}$/, "0".repeat(32)))).status()).toBe(404);
    expect((await api.get(url)).status()).toBe(200);
    await page.reload();
    await expect(row.getByTestId("heartbeat-status")).toContainText(/^up|ok$/i);

    // Silence: within ~40 s the sweep marks it down and the alert exists.
    await expect
      .poll(
        async () => {
          await page.goto("/app/alerts");
          return (await page.getByText(`Heartbeat missed — ${name}`).count()) > 0;
        },
        { timeout: 90_000, intervals: [5_000] },
      )
      .toBe(true);
    await page.goto("/app/settings/heartbeats");
    await expect(row.getByTestId("heartbeat-status")).toContainText(/down|panne|ausgefallen/i);

    // The next ping resolves the alert and brings the heartbeat back up.
    expect((await api.get(url)).status()).toBe(200);
    await expect
      .poll(
        async () => {
          await page.goto("/app/alerts?view=resolved");
          return (await page.getByText(`Heartbeat missed — ${name}`).count()) > 0;
        },
        { timeout: 30_000, intervals: [3_000] },
      )
      .toBe(true);
    await page.goto("/app/settings/heartbeats");
    await expect(row.getByTestId("heartbeat-status")).toContainText(/^up|ok$/i);
    await api.dispose();
  });
});
