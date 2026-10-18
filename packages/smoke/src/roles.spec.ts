import { expect, test } from "@playwright/test";
import { MEMBERS, signIn, signOut } from "./helpers";

/**
 * Enterprise custom roles: a role built on "responder", given the alerting
 * settings box by box in the matrix. Assigned from Members, it opens exactly
 * the alerting screens for its holder — the rest of the settings stay closed
 * — and its deletion is refused while a member holds it.
 */
test.describe("Custom roles", () => {
  test("a responder-based role gains the alerting settings and nothing else", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/roles");
    await expect(page.getByTestId("ee-unavailable")).toHaveCount(0);

    // Created from its base: a responder's permissions, then selected.
    await page.getByTestId("role-add").click();
    const dialog = page.getByTestId("role-dialog");
    await dialog.locator('input[name="name"]').fill("Alerting admin");
    await dialog.locator('select[name="base"]').selectOption("responder");
    await page.getByTestId("role-dialog-submit").click();
    await page.waitForURL(/\/app\/settings\/roles\?role=/);
    const chip = page.locator('[data-testid="role-chip"][data-role="Alerting admin"]');
    await expect(chip).toHaveAttribute("aria-current", "true");
    await expect(chip.getByTestId("role-members")).toHaveText(/^0 /);
    const box = (p: string) => page.locator(`[data-permission="${p}"] input[name="permissions"]`);
    await expect(box("incidents.respond")).toBeChecked();
    await expect(box("settings.alerting")).not.toBeChecked();

    // One box, then the save bar.
    await page.locator('[data-permission="settings.alerting"] label').click();
    await expect(box("settings.alerting")).toBeChecked();
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("settings-savebar")).toHaveCount(0);
    await page.reload();
    await expect(box("settings.alerting")).toBeChecked();
    await expect(box("settings.workspace")).not.toBeChecked();

    // Assigned to the responder from Members.
    await page.goto("/app/settings/members");
    const karim = page.locator(`[data-member-email="${MEMBERS.responder}"]`);
    const select = karim.locator("select");
    const option = await select
      .locator("option", { hasText: "Alerting admin" })
      .getAttribute("value");
    expect(option).toMatch(/^custom:/);
    // The select saves on change: wait for the action itself.
    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().includes("/app/settings/members"),
      ),
      select.selectOption(option!),
    ]);
    await page.reload();
    await expect(karim.locator("select")).toHaveValue(option!);
    await page.goto("/app/settings/roles");
    await chip.click();
    await expect(chip.getByTestId("role-members")).toHaveText(/^1 /);
    // Deletion is refused while the role is held, and says by whom.
    await page.getByTestId("role-remove").click();
    await expect(page.getByTestId("settings-toast")).toContainText("Karim");
    await expect(chip).toBeVisible();
    await signOut(page);

    // The holder: alerting settings open, the general settings closed, incidents still theirs.
    await signIn(page, MEMBERS.responder);
    await page.goto("/app/settings/rules");
    await expect(page.getByTestId("role-restricted")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goto("/app/monitors/heartbeats");
    await expect(page.getByTestId("role-restricted")).toHaveCount(0);
    await page.goto("/app/settings/general");
    await expect(page.getByTestId("role-restricted")).toBeVisible();
    await page.goto("/app/settings/members");
    await expect(page.getByTestId("role-restricted")).toBeVisible();
    // The settings overview opens for them, listing what they hold.
    await page.goto("/app/settings");
    await expect(page.getByTestId("role-restricted")).toHaveCount(0);
    await expect(page.locator('a[href="/app/settings/rules"]').first()).toBeVisible();
    await page.goto("/app/incidents/new");
    await expect(page).toHaveURL(/\/app\/incidents\/new/);
    await signOut(page);

    // Back to a built-in role: the role can go.
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/members");
    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().includes("/app/settings/members"),
      ),
      karim.locator("select").selectOption("responder"),
    ]);
    await page.reload();
    await expect(karim.locator("select")).toHaveValue("responder");
    await page.goto("/app/settings/roles");
    await chip.click();
    await expect(chip).toHaveAttribute("aria-current", "true");
    await page.getByTestId("role-remove").click();
    await expect(chip).toHaveCount(0);
  });
});
