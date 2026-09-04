import { expect, test } from "@playwright/test";
import { MEMBERS, signIn } from "./helpers";

/** On-call pay: rules saved, a month computed into a draft, published and frozen, exported as CSV. */
test.describe("On-call pay", () => {
  test("rules → draft → publish → frozen, with a CSV", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/insights?tab=pay");
    const rules = page.getByTestId("pay-rules");
    await rules.locator('input[name="standby"]').fill("2.50");
    await rules.locator('input[name="night"]').fill("4");
    await rules.locator('input[name="weekend"]').fill("5");
    await rules.locator('input[name="holiday"]').fill("7");
    await page.getByTestId("pay-rules-save").click();
    await page.waitForURL(/saved=rules/);

    // Last month: the seeded schedules have people on call every day.
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const period = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
    await page.getByTestId("pay-period").fill(period);
    await page.getByTestId("pay-generate").click();
    await page.waitForURL(/saved=draft/);
    await expect(page.getByTestId("pay-status")).toContainText(/draft|brouillon|Entwurf/i);
    await expect(page.getByTestId("pay-row").first()).toBeVisible();
    const total = (await page.getByTestId("pay-total").textContent()) ?? "";
    expect(total).toMatch(/\d/);

    await page.getByTestId("pay-publish").click();
    await page.waitForURL(/saved=published/);
    await expect(page.getByTestId("pay-status")).toContainText(/published|publié|veröffentlicht/i);
    await expect(page.getByTestId("pay-publish")).toHaveCount(0);
    // Recomputing a published month is refused.
    await page.getByTestId("pay-period").fill(period);
    await page.getByTestId("pay-generate").click();
    await page.waitForURL(/error=published/);

    const csv = await page.request.get(`/api/insights/export?tab=pay&period=${period}`);
    expect(csv.status()).toBe(200);
    const body = await csv.text();
    expect(body.split("\n")[0]).toContain("member,schedule,standby_hours");
    expect(body).toContain("published");

    // A responder sees only their own lines of the published month, and no rules panel.
    await page.goto("/login");
    await signIn(page, MEMBERS.responder);
    await page.goto(`/app/insights?tab=pay&period=${period}`);
    await expect(page.getByTestId("pay-rules")).toHaveCount(0);
    await expect(page.getByTestId("pay-status")).toContainText(/published|publié|veröffentlicht/i);
  });
});
