import { expect, test } from "@playwright/test";
import { MEMBERS, signIn } from "./helpers";

/**
 * Insights: the design's five tabs deep-linked by `?tab=`, the period menu
 * that also exports the tab being read, and On-call pay reached from Pager load.
 */
test.describe("Insights", () => {
  test("tabs, period, export and the way to on-call pay", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/insights");
    for (const tab of ["incidents", "atlas", "pager", "uptime", "followups"])
      await expect(page.getByTestId(`insights-tab-${tab}`)).toBeVisible();

    // The period is a menu; choosing one navigates and keeps the tab.
    await page.getByTestId("insights-tab-uptime").click();
    await expect(page).toHaveURL(/tab=uptime/);
    await expect(page.getByTestId("insights-stat")).toHaveCount(4);
    await page.getByTestId("insights-period").click();
    await page.getByTestId("insights-period-30").click();
    await expect(page).toHaveURL(/tab=uptime&days=30/);
    await expect(page.getByTestId("insights-period")).toContainText(/30/);

    // The export in the same menu is the CSV of the tab on screen.
    await page.getByTestId("insights-period").click();
    const href = await page.getByTestId("insights-export").getAttribute("href");
    expect(href).toContain("tab=uptime");
    const csv = await page.request.get(href!);
    expect(csv.status()).toBe(200);
    expect((await csv.text()).split("\n")[0]).toContain("monitor,type,service");

    // ✦ Atlas is deep-linked; its CSV is the per-service ladder.
    await page.goto("/app/insights?tab=atlas");
    await expect(page.getByTestId("insights-tab-atlas")).toBeVisible();
    const atlas = await page.request.get("/api/insights/export?tab=atlas&days=90");
    expect(atlas.status()).toBe(200);

    // Pager load leads to the pay report, and the report leads back.
    await page.goto("/app/insights?tab=pager");
    await expect(page.getByTestId("insights-heat")).toBeVisible();
    await page.getByTestId("insights-pay-link").click();
    await expect(page).toHaveURL(/tab=pay/);
  });
});
