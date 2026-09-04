import { expect, test } from "@playwright/test";
import { MEMBERS, signIn, signOut } from "./helpers";

/**
 * Enterprise custom roles: a role built on "responder" that also manages
 * alerting settings. Assigned from Members & roles, it opens exactly the
 * alerting screens for its holder — the rest of the settings stay closed —
 * and its deletion is refused while a member holds it.
 */
test.describe("Custom roles", () => {
  test("a responder-based role gains the alerting settings and nothing else", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/roles");
    await expect(page.getByTestId("ee-unavailable")).toHaveCount(0);
    await page.getByTestId("role-add").click();
    const form = page.getByTestId("role-form");
    await form.locator('input[name="name"]').fill("Alerting admin");
    await form.locator('select[name="base"]').selectOption("responder");
    await form.locator('input[value="incidents.respond"]').check();
    await form.locator('input[value="catalog.entries"]').check();
    await form.locator('input[value="settings.alerting"]').check();
    await page.getByTestId("role-save").click();
    await page.waitForURL(/saved=1/);
    const row = page.getByTestId("role-row").filter({ hasText: "Alerting admin" });
    await expect(row).toBeVisible();
    await expect(row.getByTestId("role-members")).toHaveText(/^0 /);

    // Assigned to the responder from Members & roles.
    await page.goto("/app/settings/members");
    const karim = page.locator(`[data-member-email="${MEMBERS.responder}"]`);
    const select = karim.locator("select");
    const option = await select
      .locator("option", { hasText: "Alerting admin" })
      .getAttribute("value");
    expect(option).toMatch(/^custom:/);
    await select.selectOption(option!);
    // The role form posts without navigating: wait for the action itself.
    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().includes("/app/settings/members"),
      ),
      karim.locator('button[type="submit"]').first().click(),
    ]);
    await page.reload();
    await expect(karim.locator("select")).toHaveValue(option!);
    await page.goto("/app/settings/roles");
    await expect(row.getByTestId("role-members")).toHaveText(/^1 /);
    // Deletion is refused while the role is held.
    await row.getByTestId("role-remove").click();
    await page.waitForURL(/error=in_use/);
    await expect(page.getByTestId("roles-error")).toContainText("Karim");
    await signOut(page);

    // The holder: alerting settings open, the general settings closed, incidents still theirs.
    await signIn(page, MEMBERS.responder);
    await page.goto("/app/settings/alert-sources");
    await expect(page.getByTestId("role-restricted")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goto("/app/settings/heartbeats");
    await expect(page.getByTestId("role-restricted")).toHaveCount(0);
    await page.goto("/app/settings/general");
    await expect(page.getByTestId("role-restricted")).toBeVisible();
    await page.goto("/app/settings/members");
    await expect(page.getByTestId("role-restricted")).toBeVisible();
    // The settings index lands on the first screen they hold.
    await page.goto("/app/settings");
    await page.waitForURL(/\/app\/settings\/alert-sources/);
    await page.goto("/app/incidents/new");
    await expect(page).toHaveURL(/\/app\/incidents\/new/);
    await signOut(page);

    // Back to a built-in role: the role can go.
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/members");
    await karim.locator("select").selectOption("responder");
    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().includes("/app/settings/members"),
      ),
      karim.locator('button[type="submit"]').first().click(),
    ]);
    await page.reload();
    await expect(karim.locator("select")).toHaveValue("responder");
    await page.goto("/app/settings/roles");
    await row.getByTestId("role-remove").click();
    await page.waitForURL(/removed=1/);
    await expect(page.getByTestId("role-row")).toHaveCount(0);
  });
});
