import { expect, test } from "@playwright/test";
import { MEMBERS, signIn, signOut } from "./helpers";

/**
 * Settings › Incidents (V2 screens): a custom field lands in the
 * declaration form, a post-incident task and the post-mortem term are saved
 * from Types & lifecycle, an announcement rule is added, switched off and
 * deleted, a new type is a copy of its base, and the old severities address
 * lands on its own screen.
 */
test.describe("Settings — Response", () => {
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");

  test("a custom field is read by the declaration form", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/fields");
    await expect(page.getByTestId("field-row").first()).toBeVisible();
    await page.getByTestId("field-open").click();
    const name = `Smoke ticket ${stamp}`;
    const dialog = page.getByTestId("field-form");
    await dialog.locator('input[name="name"]').fill(name);
    await dialog.locator('select[name="kind"]').selectOption("link");
    await page.getByTestId("field-form-submit").click();
    const row = page.getByTestId("field-row").filter({ hasText: name });
    await expect(row).toBeVisible();

    await page.goto("/app/incidents/new");
    // Optional fields are folded under "+ N more fields", after the design's three questions.
    await page.getByTestId("declare-details").click();
    await expect(page.getByText(name).first()).toBeVisible();

    await page.goto("/app/settings/fields");
    await page.getByTestId("field-row").filter({ hasText: name }).getByTestId("field-edit").click();
    await page.getByTestId("field-delete").click();
    await expect(page.getByTestId("field-row").filter({ hasText: name })).toHaveCount(0);
    await signOut(page);
  });

  test("the post-incident flow takes a task and the post-mortem term", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    // The old address opens Types & lifecycle on its post-incident tasks.
    await page.goto("/app/settings/post-incident");
    await expect(page).toHaveURL(/\/app\/settings\/types/);
    const tasks = page.getByTestId("tasks-dialog");
    await expect(tasks.getByTestId("task-def-row").first()).toBeVisible();
    const title = `Smoke task ${stamp}`;
    await tasks.getByTestId("task-form").locator('input[name="title"]').fill(title);
    await tasks.getByTestId("task-add").click();
    const added = tasks.getByTestId("task-def-row").filter({ hasText: title });
    await expect(added).toBeVisible();
    await added.getByTestId("task-delete").click();
    await expect(tasks.getByTestId("task-def-row").filter({ hasText: title })).toHaveCount(0);

    // The post-mortem term, in its dialog.
    await page.goto("/app/settings/types");
    await page.getByTestId("pm-template-edit").click();
    await page.getByTestId("pm-template-dialog").locator('input[name="term"]').fill("Retex");
    await page.getByTestId("pm-template-dialog-submit").click();
    await expect(page.getByTestId("pm-template-dialog")).toHaveCount(0, { timeout: 30_000 });
    await page.goto("/app/incidents/217?tab=post-incident");
    await expect(page.getByText("Retex").first()).toBeVisible();
    await page.goto("/app/settings/types");
    await page.getByTestId("pm-template-edit").click();
    await page.getByTestId("pm-template-dialog").locator('input[name="term"]').fill("");
    await page.getByTestId("pm-template-dialog-submit").click();
    await expect(page.getByTestId("pm-template-dialog")).toHaveCount(0, { timeout: 30_000 });
    await signOut(page);
  });

  test("an announcement rule is added, switched off and deleted", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/announcements");
    await expect(page.getByTestId("template-row").first()).toBeVisible();
    const rows = page.getByTestId("rule-row");
    await expect(rows.first()).toBeVisible();
    const before = await rows.count();
    await page.getByTestId("rule-open").click();
    await page.getByTestId("rule-form-submit").click();
    await expect(rows).toHaveCount(before + 1);

    // The newest rule is the last: switched off from its dialog, then deleted.
    await rows.last().click();
    await page.getByTestId("rule-active").uncheck({ force: true });
    await page.getByTestId("rule-edit-dialog-submit").click();
    await expect(page.getByTestId("rule-edit-dialog")).toHaveCount(0);
    await rows.last().click();
    await expect(page.getByTestId("rule-active")).not.toBeChecked();
    await page.getByTestId("rule-delete").click();
    await expect(rows).toHaveCount(before);
    await signOut(page);
  });

  test("a new type inherits the lifecycle of its base", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/types");
    await page.getByTestId("type-open").click();
    const name = `Smoke type ${stamp}`;
    await page.getByTestId("type-form").locator('input[name="name"]').fill(name);
    await page.getByTestId("type-form-submit").click();
    await page.waitForURL(/settings\/types\?type=/);
    // The switcher shows the new type, selected; its statuses are the base's.
    await expect(page.getByTestId("type-switcher")).toContainText(name);
    await expect(page.getByTestId("phase-active")).toContainText(
      /Surveillance|Monitoring|Beobachtung/,
    );
    await page.goto("/app/incidents/new");
    await expect(page.locator('select[name="typeId"] option', { hasText: name })).toHaveCount(1);
    await signOut(page);
  });

  test("the old severities address lands on its own screen", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/types?seg=severities");
    await expect(page).toHaveURL(/\/app\/settings\/severities$/);
    await signOut(page);
  });
});
