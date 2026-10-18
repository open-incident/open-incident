import { expect, test } from "@playwright/test";
import { MEMBERS, signIn, telemetryInstalled } from "./helpers";

/**
 * Telemetry, as the V2 design draws it: five tabs, a window menu, the
 * services table, traces with their waterfall, logs as a terminal, the
 * metrics board, and the setup. Read-only, and tolerant of an empty window —
 * the throwaway workspace may have no span in the last hour.
 */
test.describe("Telemetry", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    test.skip(!(await telemetryInstalled(page)), "telemetry module not installed");
  });

  test("five tabs, and the window menu everywhere but Metrics", async ({ page }) => {
    await page.goto("/app/telemetry");
    for (const tab of ["services", "traces", "logs", "metrics", "setup"]) {
      await expect(page.getByTestId(`telemetry-tab-${tab}`)).toBeVisible();
    }
    await expect(page.getByTestId("telemetry-window")).toBeVisible();
    await page.getByTestId("telemetry-window").click();
    await page.getByTestId("telemetry-range-6h").click();
    await expect(page).toHaveURL(/range=6h/);
    await page.goto("/app/telemetry?tab=metrics");
    await expect(page.getByTestId("telemetry-window")).toHaveCount(0);
    await expect(page.locator("text=Application error")).toHaveCount(0);
  });

  test("the old addresses still land somewhere that exists", async ({ page }) => {
    for (const q of [
      "tab=overview",
      "tab=explore&signal=logs",
      "tab=exceptions",
      "tab=connect",
      "tab=map",
    ]) {
      await page.goto(`/app/telemetry?${q}`);
      await expect(page.locator("text=Application error")).toHaveCount(0);
      await expect(page.getByTestId("telemetry-tab-services")).toBeVisible();
    }
  });

  test("a service row opens its metrics", async ({ page }) => {
    await page.goto("/app/telemetry?range=7d");
    const rows = page.getByTestId("telemetry-service-row");
    test.skip((await rows.count()) === 0, "no span in the window");
    await rows.first().click();
    await expect(page).toHaveURL(/tab=metrics&service=/);
    await expect(page.getByTestId("metrics-chart").first()).toBeVisible();
  });

  test("metrics: compare, zoom by dragging, reset", async ({ page }) => {
    await page.goto("/app/telemetry?tab=metrics&range=7d");
    const chart = page.getByTestId("metrics-chart").first();
    test.skip((await chart.count()) === 0, "no service has reported");
    await page.getByTestId("metrics-compare").click();
    await expect(page).toHaveURL(/cmp=1/);
    await expect(page.locator("[data-chart-legend*='24 h']").first()).toBeVisible();
    const plot = page.locator("[data-chart-plot]").first();
    const box = (await plot.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
    await expect(page.locator("[data-chart-tooltip]").first()).toBeVisible();
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(page).toHaveURL(/from=\d+&to=\d+/);
    await expect(page.getByTestId("metrics-zoom")).toBeVisible();
    await page.locator("[data-chart-fullscreen]").first().click();
    await expect(page.locator("[data-chart-stats]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-chart-stats]")).toHaveCount(0);
  });

  test("traces: the list, the waterfall, a span's detail and its logs", async ({ page }) => {
    await page.goto("/app/telemetry?tab=traces&range=7d");
    await expect(page.getByTestId("trace-filters")).toBeVisible();
    test.skip((await page.getByTestId("trace-row").count()) === 0, "no trace in the window");
    await expect(page.getByTestId("trace-waterfall")).toBeVisible();
    await page.getByTestId("trace-span").first().click();
    await expect(page.getByTestId("span-detail")).toBeVisible();
    await page.getByTestId("trace-add-filter").click();
    await page.getByRole("menuitem", { name: "status:error" }).click();
    await expect(page).toHaveURL(/status=error/);
    await expect(page.getByTestId("trace-chip-status")).toBeVisible();
  });

  test("logs: the query box filters, live tail pauses", async ({ page }) => {
    await page.goto("/app/telemetry?tab=logs&range=7d");
    await page.getByTestId("logs-query").fill("level:error");
    await page.getByTestId("logs-query").press("Enter");
    await expect(page).toHaveURL(/q=level%3Aerror/);
    await page.getByTestId("logs-live").click();
    await expect(page).toHaveURL(/live=0/);
    await expect(page.getByTestId("log-foot")).toContainText(/paused|en pause|pausiert/);
  });

  test("setup shows the endpoint and the collectors", async ({ page }) => {
    await page.goto("/app/telemetry?tab=setup");
    await expect(page.getByTestId("otlp-endpoint")).toBeVisible();
    await expect(page.getByTestId("collectors")).toBeVisible();
    await expect(page.getByTestId("rotate-token")).toBeVisible();
  });
});
