import { expect, request, test, type Page } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { MEMBERS, signIn } from "./helpers";
import { DEMO_KEYS, startOpsgenieMock } from "./opsgenie-mock";

/**
 * Migrate from Opsgenie, end to end, against a mock of Opsgenie's API (port
 * 3193 — the instance must run with OPSGENIE_API_BASE=http://127.0.0.1:3193).
 * The throwaway workspace starts with no migration: the suite walks the seven
 * steps in order, and checks on the way that Opsgenie is only ever read and
 * that nothing pages anybody before a team is switched.
 */
test.describe.serial("Migrate from Opsgenie", () => {
  let mock: Awaited<ReturnType<typeof startOpsgenieMock>>;
  test.beforeAll(async () => {
    mock = await startOpsgenieMock();
  });
  test.afterAll(async () => {
    mock.server.close();
  });

  const open = async (page: Page, step: string) => {
    await page.goto(`/app/settings/migrate?step=${step}`);
    await expect(page.getByTestId(`migrate-at-${step}`)).toBeVisible();
  };

  test("connect: a key without Configuration Access and a team key are explained, the account key passes", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/migrate");
    await expect(page.getByTestId("migrate-at-connect")).toBeVisible();
    await expect(page.getByTestId("migrate-countdown")).toBeVisible();

    const check = async (key: string, region: "eu" | "us" = "eu") => {
      await page.getByTestId(`migrate-region-${region}`).click();
      await page.getByTestId("migrate-key").fill(key);
      await page.getByTestId("migrate-check").click();
      await expect(page.getByTestId("migrate-checks")).toBeVisible({ timeout: 30_000 });
    };
    await check(DEMO_KEYS.readOnly);
    await expect(page.getByTestId("migrate-check-read")).toHaveAttribute("data-ok", "true");
    await expect(page.getByTestId("migrate-check-config")).toHaveAttribute("data-ok", "false");
    await expect(page.getByTestId("migrate-check-config")).toContainText("403");

    await check(DEMO_KEYS.team);
    await expect(page.getByTestId("migrate-check-config")).toHaveAttribute("data-ok", "true");
    await expect(page.getByTestId("migrate-check-account")).toHaveAttribute("data-ok", "false");

    await check(DEMO_KEYS.global, "us");
    await expect(page.getByTestId("migrate-check-read")).toHaveAttribute("data-ok", "false");
    await expect(page.getByTestId("migrate-check-read")).toContainText("401");

    await check(DEMO_KEYS.global, "eu");
    for (const k of ["reach", "read", "config", "account"])
      await expect(page.getByTestId(`migrate-check-${k}`)).toHaveAttribute("data-ok", "true");
    await expect(page.getByTestId("migrate-check-account")).toContainText("skylark");
    // The key never comes back to the page.
    expect(await page.content()).not.toContain(DEMO_KEYS.global);

    // 2 · The inventory runs in the background, with its progress.
    await page.getByTestId("migrate-start-inventory").click();
    await page.waitForURL(/step=inventory/);
    await expect(page.getByTestId("migrate-to-people")).toBeEnabled({ timeout: 150_000 });
    await expect(page.getByTestId("migrate-counter")).toHaveCount(8);
    await expect(page.getByTestId("migrate-counter").first()).toContainText("8");
    // Ten integrations and two heartbeats; two have had no alert in 90 days.
    await expect(page.getByTestId("migrate-integration")).toHaveCount(12);
    await page.getByTestId("migrate-filter-silent").click();
    await expect(page.getByTestId("migrate-integration")).toHaveCount(2);

    // Opsgenie was only read, and its rate limit was met and waited out.
    expect(mock.calls.length).toBeGreaterThan(30);
    expect(mock.calls.every((c) => c.method === "GET")).toBe(true);
    expect(mock.calls.some((c) => c.status === 429)).toBe(true);
  });

  test("match people, confirm the conversions, preview eight weeks, import inactive", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, MEMBERS.owner);
    await open(page, "people");
    await expect(page.getByTestId("migrate-to-preview")).toBeDisabled();
    const person = (kind: string) =>
      page.locator(`[data-testid="migrate-person"][data-kind="${kind}"]`);
    await expect(person("matched")).toHaveCount(5);

    // Lucas under his Open Incident email, Ana's slots to Nadia, Sam invited.
    const lucas = person("conflict").getByTestId("migrate-person-select");
    const lucasValue = await lucas
      .locator("option", { hasText: "lucas@skylark.dev" })
      .first()
      .getAttribute("value");
    await lucas.selectOption(lucasValue!);
    await expect(person("conflict")).toContainText(/resolved|résolu|gelöst/i);
    const ana = person("blocked").getByTestId("migrate-person-select");
    const nadia = await ana
      .locator("option", { hasText: "Nadia Benali" })
      .first()
      .getAttribute("value");
    await ana.selectOption(nadia!);
    await expect(person("blocked")).toContainText(/resolved|résolu|gelöst/i);
    await person("missing").getByTestId("migrate-person-select").selectOption("invite");
    await expect(person("missing")).toContainText(/resolved|résolu|gelöst/i);

    for (const kind of ["delays", "layers", "p5", "repeat"]) {
      await page.getByTestId(`migrate-confirm-${kind}`).click();
      await expect(page.getByTestId(`migrate-confirm-${kind}`)).toContainText("✓");
    }
    await expect(page.getByTestId("migrate-to-preview")).toBeEnabled();
    await page.getByTestId("migrate-to-preview").click();
    await page.waitForURL(/step=preview/);

    // Sam's invitation is pending: his slots page nobody here until handed over.
    await expect(page.getByTestId("migrate-sim")).toHaveCount(5);
    for (let i = 0; i < 12 && (await page.getByTestId("migrate-fix").count()) > 0; i++) {
      await page.getByTestId("migrate-fix").first().click();
      await page.waitForTimeout(1500);
    }
    await expect(page.locator('[data-testid="migrate-sim"]:not([data-differs="0"])')).toHaveCount(
      0,
    );
    await page.getByTestId("migrate-import").click();
    await page.waitForURL(/step=shadow/, { timeout: 60_000 });
    await expect(page.getByTestId("migrate-hook-url")).toContainText("/in/opsgenie/");
  });

  test("shadow mode compares without paging; an override made since the inventory is caught and settled", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, MEMBERS.owner);
    await open(page, "shadow");
    const url = ((await page.getByTestId("migrate-hook-url").textContent()) ?? "").trim();
    const path = new URL(url).pathname;
    const api = await request.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true });

    // A wrong token is a 404.
    expect((await api.post("/in/opsgenie/not-a-real-token-123456", { data: {} })).status()).toBe(
      404,
    );

    // Amélie takes the Payments slot in Opsgenie now — after the inventory was read.
    const now = Date.now();
    await fetch("http://127.0.0.1:3193/_override", {
      method: "POST",
      body: JSON.stringify({
        schedule: "payments",
        rotation: null,
        person: "amelie",
        start: new Date(now - 3_600_000).toISOString(),
        end: new Date(now + 3_600_000).toISOString(),
      }),
    });
    const at = new Date(now - 60_000);
    for (const [integration, priority] of [
      ["datadog", "P2"],
      ["alertmanager", "P3"],
      ["grafana", "P2"],
    ] as const) {
      const r = await api.post(path, {
        data: mock.account.webhookFor(integration, at, { priority }),
      });
      expect(r.status()).toBe(202);
    }
    // An acknowledgement is not an alert: read, ignored.
    expect(
      (await api.post(path, { data: { action: "Acknowledge", alert: { alertId: "x" } } })).status(),
    ).toBe(202);

    await expect
      .poll(
        async () => {
          await page.reload();
          return page.getByTestId("migrate-kpi").first().textContent();
        },
        { timeout: 60_000, intervals: [2_000] },
      )
      .toContain("3");
    // Nobody is paged by Open Incident in shadow mode.
    await expect(page.getByTestId("migrate-kpi").nth(3)).toContainText("0");

    const override = page.locator('[data-testid="migrate-disagreement"][data-cause="override"]');
    await expect(override).toHaveCount(1);
    await override.getByTestId("migrate-settle").click();
    await expect(override).toHaveAttribute("data-resolved", "true", { timeout: 30_000 });
  });

  test("switch a team, tick its integrations, roll it back", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, MEMBERS.owner);
    await open(page, "switch");
    const platform = page.getByTestId("migrate-team").filter({ hasText: "Platform" });
    await platform.getByTestId("migrate-switch").click();
    await expect(platform).toHaveAttribute("data-live", "true", { timeout: 30_000 });
    const item = platform.getByTestId("migrate-repoint").first();
    await item.click();
    await expect(item).toHaveAttribute("aria-pressed", "true");
    await platform.getByTestId("migrate-rollback").click();
    await expect(platform).toHaveAttribute("data-live", "false", { timeout: 30_000 });
  });

  test("archive the history in windows, then mark the migration complete", async ({ page }) => {
    test.setTimeout(300_000);
    await signIn(page, MEMBERS.owner);
    await open(page, "switch");
    await page.getByTestId("migrate-to-archive").click();
    await page.waitForURL(/step=archive/);
    // Not every team is switched: the migration cannot be marked complete yet.
    await page.getByTestId("migrate-finish").click();
    await expect(page.getByTestId("migrate-toast")).toBeVisible();
    await expect(page.getByTestId("migrate-finished")).toHaveCount(0);

    await expect
      .poll(
        async () => {
          await page.reload();
          return page.locator('[data-testid="migrate-window"][data-done="false"]').count();
        },
        { timeout: 240_000, intervals: [3_000] },
      )
      .toBe(0);
    expect(await page.getByTestId("migrate-window").count()).toBeGreaterThan(3);
    // Every detail was fetched one by one.
    expect(
      mock.calls.filter(
        (c) => /^\/eu\/v2\/alerts\/[^/]+$/.test(c.path) && c.path !== "/eu/v2/alerts/count",
      ).length,
    ).toBeGreaterThan(100);

    await open(page, "switch");
    for (let i = 0; i < 4; i++) {
      const next = page.getByTestId("migrate-switch").first();
      if (!(await next.count())) break;
      await next.click();
      await page.waitForTimeout(2_000);
    }
    await expect(page.locator('[data-testid="migrate-team"][data-live="false"]')).toHaveCount(0);
    await open(page, "archive");
    await page.getByTestId("migrate-finish").click();
    await expect(page.getByTestId("migrate-finished")).toBeVisible({ timeout: 30_000 });
    expect(mock.calls.every((c) => c.method === "GET")).toBe(true);
  });
});
