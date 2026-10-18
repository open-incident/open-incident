import { expect, test } from "@playwright/test";
import { MEMBERS, signIn } from "./helpers";

/**
 * Settings, as the V2 design draws them: the overview with its five groups
 * and what needs attention, the navigation and its search, the old addresses
 * that still land, one save bar that appears only when something changed,
 * and the working hours a policy reads.
 */
test.describe("Settings (V2)", () => {
  test("the overview lists the five groups and the navigation finds a setting", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings");
    await expect(page.getByTestId("settings-overview")).toBeVisible();
    for (const g of ["workspace", "people", "incidents", "alerts", "platform"])
      await expect(page.getByTestId(`settings-group-${g}`)).toBeVisible();
    // Every entry the design names, in the navigation.
    const nav = page.getByTestId("settings-nav");
    for (const href of [
      "/app/settings/general",
      "/app/settings/brand",
      "/app/settings/working-hours",
      "/app/settings/members",
      "/app/settings/chat",
      "/app/settings/types",
      "/app/settings/severities",
      "/app/settings/rules",
      "/app/settings/alert-severities",
      "/app/settings/labels",
      "/app/settings/migrate",
      "/app/settings/api",
      "/app/settings/ai",
      "/app/settings/audit",
    ])
      await expect(nav.locator(`a[href="${href}"]`)).toHaveCount(1);

    // "Find a setting" filters on names, states and groups — "SEV1" is in
    // the Severities line ("SEV1 – SEV4") whatever the interface language.
    await page.getByTestId("settings-find").fill("SEV1");
    await expect(nav.locator('a[href="/app/settings/severities"]')).toBeVisible();
    await expect(nav.locator('a[href="/app/settings/general"]')).toHaveCount(0);
    await page.getByTestId("settings-find").fill("zzzz-nothing");
    await expect(nav.getByText(/zzzz-nothing/)).toBeVisible();
    await page.getByTestId("settings-find").fill("");
    await expect(nav.locator('a[href="/app/settings/general"]')).toBeVisible();
  });

  test("the old addresses land on the renamed screens", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    for (const [from, to] of [
      ["/app/settings/alert-routes", /\/app\/settings\/rules$/],
      ["/app/settings/alert-priorities", /\/app\/settings\/alert-severities$/],
      ["/app/settings/alert-attributes", /\/app\/settings\/labels$/],
    ] as const) {
      await page.goto(from);
      await expect(page).toHaveURL(to);
    }
  });

  test("one save bar, shown only when something changed; discard and save", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/general");
    const name = page.locator('input[name="name"]');
    const before = await name.inputValue();
    await expect(page.getByTestId("settings-savebar")).toHaveCount(0);

    // A change brings the bar; Discard puts the saved value back.
    await name.fill(`${before} (draft)`);
    await expect(page.getByTestId("settings-savebar")).toBeVisible();
    await page.getByTestId("settings-discard").click();
    await expect(page.getByTestId("settings-savebar")).toHaveCount(0);
    await expect(page.locator('input[name="name"]')).toHaveValue(before);

    // Save writes it; the bar goes; a reload reads it back.
    await page.locator('input[name="name"]').fill(`${before} Ops`);
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("settings-savebar")).toHaveCount(0);
    await page.reload();
    await expect(page.locator('input[name="name"]')).toHaveValue(`${before} Ops`);

    // Back as it was.
    await page.locator('input[name="name"]').fill(before);
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("settings-savebar")).toHaveCount(0);
    await page.reload();
    await expect(page.locator('input[name="name"]')).toHaveValue(before);
  });

  test("the brand accent is picked, previewed and saved", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/brand");
    const accent = page.getByTestId("brand-accent");
    const before = await accent.inputValue();
    const pick = before.toUpperCase() === "#0E7A58" ? "#7C3AED" : "#0E7A58";
    await page.locator(`[data-swatch="${pick}"]`).click();
    await expect(page.getByTestId("settings-savebar")).toBeVisible();
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("settings-savebar")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("brand-accent")).toHaveValue(pick);
    // The overview says it too.
    await page.goto("/app/settings");
    await expect(page.getByTestId("settings-group-workspace")).toContainText(pick);
    // Restored.
    await page.goto("/app/settings/brand");
    await page.getByTestId("brand-accent").fill(before);
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("settings-savebar")).toHaveCount(0);
  });

  test("a set of working hours is created, shown as a week, edited and deleted", async ({
    page,
  }) => {
    const name = `Smoke hours ${Date.now().toString(36)}`;
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/working-hours");
    await page.getByTestId("hours-new").click();
    const dialog = page.getByTestId("hours-new-dialog");
    await dialog.locator('input[name="name"]').fill(name);
    await dialog.locator('select[name="days"]').selectOption("sat-sun");
    await dialog.locator('select[name="startTime"]').selectOption("10:00");
    await dialog.locator('select[name="endTime"]').selectOption("16:00");
    await page.getByTestId("hours-new-dialog-submit").click();
    const row = page.getByTestId("hours-row").filter({ hasText: name });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByTestId("hours-week")).toContainText("10:00 – 16:00");

    await page.getByTestId("hours-edit").click();
    const edit = page.getByTestId("hours-edit-dialog");
    await edit.locator('select[name="endTime"]').selectOption("18:00");
    await page.getByTestId("hours-edit-dialog-submit").click();
    await expect(page.getByTestId("hours-week")).toContainText("10:00 – 18:00");

    // Nobody reads it: it can go.
    await page.getByTestId("hours-delete").click();
    await page.getByTestId("hours-delete-dialog-submit").click();
    await expect(page.getByTestId("hours-row").filter({ hasText: name })).toHaveCount(0);
  });

  test("a responder is told the settings are not theirs", async ({ page }) => {
    await signIn(page, MEMBERS.responder);
    await page.goto("/app/settings/general");
    await expect(page.getByTestId("role-restricted")).toBeVisible();
  });
});
