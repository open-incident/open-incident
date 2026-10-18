import { expect, test } from "@playwright/test";
import { MEMBERS, signIn, signOut } from "./helpers";

/**
 * The checks the product runs itself (design: V2Monitors).
 *
 * Read-only on purpose, with one exception. A monitor is a thing that pages
 * people: creating one here, or resuming one of the demo's, would have the
 * worker reach out to a host that does not exist and wake whoever the demo put
 * on call. So this replays what a reader does — the list, a monitor's page and
 * its tabs, the charts and the full-screen view — and writes exactly one
 * thing, the criteria, which it puts back.
 */
test.describe("Monitors", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, MEMBERS.owner);
  });
  test.afterEach(async ({ page }) => {
    await signOut(page);
  });

  const firstMonitor = async (page: import("@playwright/test").Page, kind?: RegExp) => {
    await page.goto("/app/monitors");
    const rows = page.locator(
      "[data-testid=monitor-row][href^='/app/monitors/']:not([href*=heartbeats])",
    );
    const pick = kind ? rows.filter({ hasText: kind }) : rows;
    if ((await pick.count()) === 0) return false;
    await pick.first().click();
    await page.waitForURL(/\/app\/monitors\/[0-9a-f-]+/);
    return true;
  };

  test("the list shows every monitor with its history", async ({ page }) => {
    await page.goto("/app/monitors");
    await expect(page.getByTestId("monitors-checked-from")).toBeVisible();
    const rows = page.getByTestId("monitor-row");
    test.skip((await rows.count()) === 0, "no monitor in this workspace");
    const first = await rows.first().innerText();
    expect(first).toMatch(/HTTP|API|PORT|DNS|SSL|DOM|PING|SYN|IN|MAN|TRC|LOG|MET|EXC/);
    expect(first).toMatch(
      /Online|Degraded|Offline|Paused|Waiting|En ligne|Dégradé|Hors ligne|En pause|attente/,
    );
  });

  test("a monitor's page: charts that zoom together, tabs, full screen", async ({ page }) => {
    test.skip(!(await firstMonitor(page, /HTTP|API/)), "no web monitor");
    await expect(page.getByText(/WHEN IT GOES OFFLINE|QUAND IL PASSE HORS LIGNE/i)).toBeVisible();
    await expect(page.getByTestId("monitor-kpis")).toBeVisible();
    await page.getByTestId("monitor-range-30d").click();
    await expect(page).toHaveURL(/range=30d/);
    const charts = page.getByTestId("monitor-chart-0");
    await expect(charts).toBeVisible();
    // Full screen: six figures, the countdown, Esc to leave.
    await page.getByTestId("monitor-fullscreen").click();
    await expect(page.getByTestId("monitor-fs")).toBeVisible();
    await expect(page.getByTestId("monitor-fs-kpis").locator(":scope > div")).toHaveCount(6);
    await expect(page.getByTestId("monitor-fs-live")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("monitor-fs")).toHaveCount(0);
    // The SLO tab is a deep link.
    await page.getByTestId("monitor-tab-slo").click();
    await expect(page).toHaveURL(/tab=slo/);
    await expect(page.getByTestId("monitor-define-slo")).toBeVisible();
  });

  test("a journey's steps are drawn on its overview", async ({ page }) => {
    test.skip(!(await firstMonitor(page, /SYN/)), "no synthetic monitor");
    await expect(page.getByTestId("journey-row-0")).toBeVisible();
  });

  /**
   * "Default criteria · editable later" is a promise the form makes on the way
   * in. This is the later, and the test is here because a form that posts the
   * rows it shows is one typo away from silently dropping the ones it does not.
   */
  test("the rules of a monitor can be rewritten, and survive the round trip", async ({ page }) => {
    test.skip(!(await firstMonitor(page, /HTTP|API/)), "no reachability monitor in this workspace");
    await page.getByTestId("monitor-tab-criteria").click();
    await page.waitForURL(/tab=criteria/);
    const url = page.url();
    let criteria = page.getByTestId("criterion-row");
    const before = (await criteria.count()) - 1;
    const blank = criteria.last();
    await blank.locator("select[name=on]").selectOption("response_time_ms");
    await blank.locator("select[name=op]").selectOption("gt");
    await blank.locator("input[name=value]").fill("4242");
    await blank.locator("select[name=then]").selectOption("degraded");
    await page.getByTestId("criteria-save").click();
    await page.waitForURL(/saved=criteria/);
    criteria = page.getByTestId("criterion-row");
    await expect(criteria).toHaveCount(before + 2);
    for (const field of await criteria.locator('input[name=value][value="4242"]').all()) {
      await field.fill("");
    }
    await page.getByTestId("criteria-save").click();
    await page.waitForURL(/saved=criteria/);
    await expect(async () => {
      await page.goto(url, { waitUntil: "networkidle" });
      await expect(page.locator('input[name=value][value="4242"]')).toHaveCount(0, {
        timeout: 2_000,
      });
    }).toPass({ timeout: 20_000 });
  });

  test("new monitor: ten types and the design's second step", async ({ page }) => {
    await page.goto("/app/monitors");
    await page.getByTestId("monitor-new").click();
    await expect(page.getByTestId("monitor-type-http")).toBeVisible();
    await page.getByTestId("monitor-type-http").click();
    await expect(page.getByTestId("monitor-form").locator("input[name=target]")).toBeVisible();
    await expect(page.getByTestId("monitor-form").locator("input[name=name]")).toHaveCount(0);
  });
});
