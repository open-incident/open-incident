import { expect, test } from "@playwright/test";
import { MEMBERS, signIn, signOut } from "./helpers";

/**
 * The Response-milestone settings: a custom field lands in the declaration
 * form, a post-incident task and the post-mortem term are saved, an
 * announcement rule publishes above the incidents list, a new type is a copy
 * of its base.
 */
test.describe("Settings — Response", () => {
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");

  test("a custom field is read by the declaration form", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/fields");
    await expect(page.getByTestId("field-row").first()).toBeVisible();
    await page.getByTestId("field-open").click();
    const key = `smoke_${stamp}`;
    await page.locator('form[data-testid="field-form"] input[name="key"]').fill(key);
    await page.locator('form[data-testid="field-form"] input[name="label"]').fill("Smoke ticket");
    await page.locator('form[data-testid="field-form"] [role=radio]').nth(3).click(); // link
    await page.locator('form[data-testid="field-form"] button[type=submit]').click();
    await expect(page.getByTestId("field-row").filter({ hasText: key })).toBeVisible();

    await page.goto("/app/incidents/new");
    await expect(page.locator(`[name="field.${key}"]`)).toBeVisible();

    await page.goto("/app/settings/fields");
    await page.getByTestId("field-row").filter({ hasText: key }).getByRole("button").click();
    await expect(page.getByTestId("field-row").filter({ hasText: key })).toHaveCount(0);
    await signOut(page);
  });

  test("the post-incident flow takes a task and the post-mortem term", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/post-incident");
    await expect(page.getByTestId("task-def-row").first()).toBeVisible();
    await page.getByTestId("task-open-reviewing").click();
    const title = `Smoke task ${stamp}`;
    await page.locator('form[data-testid="task-form"] input[name="title"]').fill(title);
    await page.locator('form[data-testid="task-form"] button[type=submit]').click();
    await expect(page.getByTestId("task-def-row").filter({ hasText: title })).toBeVisible();
    await page.getByTestId("task-def-row").filter({ hasText: title }).getByRole("button").click();
    await expect(page.getByTestId("task-def-row").filter({ hasText: title })).toHaveCount(0);

    // Leave the "saved" URL of the previous step first, or the wait below would resolve at once.
    await page.goto("/app/settings/post-incident");
    await page.locator('input[name="term"]').fill("Retex");
    await page.locator('input[name="term"]').press("Enter");
    await page.waitForURL(/saved=1/);
    await expect(page.locator('input[name="term"]')).toHaveValue("Retex");
    await page.goto("/app/incidents/217?tab=post-incident");
    await expect(page.getByText("Retex").first()).toBeVisible();
    await page.goto("/app/settings/post-incident");
    await page.locator('input[name="term"]').fill("");
    await page.locator('input[name="term"]').press("Enter");
    await page.waitForURL(/saved=1/);
    await expect(page.locator('input[name="term"]')).toHaveValue("");
    await signOut(page);
  });

  test("the seeded rule shows a living announcement above the list; a rule can be added and removed", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/incidents");
    await expect(
      page
        .getByTestId("announcement")
        .filter({ hasText: "INC-220" })
        .or(page.getByTestId("announcement").first()),
    ).toBeVisible();

    await page.goto("/app/settings/announcements");
    await expect(page.getByTestId("template-row").first()).toBeVisible();
    await expect(page.getByTestId("rule-row").first()).toBeVisible();
    await page.getByTestId("rule-open").click();
    const name = `Smoke rule ${stamp}`;
    await page.locator('form[data-testid="rule-form"] input[name="name"]').fill(name);
    await page.locator('form[data-testid="rule-form"] button[type=submit]').click();
    const row = page.getByTestId("rule-row").filter({ hasText: name });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /Disable|Désactiver|Deaktivieren/ }).click();
    await expect(row.getByText(/inactive|inaktiv/)).toBeVisible();
    await row.getByRole("button", { name: /^(Delete|Supprimer|Löschen)$/ }).click();
    await expect(row).toHaveCount(0);
    await signOut(page);
  });

  test("a new type inherits the lifecycle of its base", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/types");
    await page.getByTestId("type-open").click();
    const name = `Smoke type ${stamp}`;
    await page.locator('form[data-testid="type-form"] input[name="name"]').fill(name);
    await page.locator('form[data-testid="type-form"] button[type=submit]').click();
    await page.waitForURL(/settings\/types\?type=/);
    await expect(page.getByText(name).first()).toBeVisible();
    // Its statuses are the base's: the lifecycle strip lists the same active statuses.
    await expect(page.getByText(/Surveillance|Monitoring|Beobachtung/).first()).toBeVisible();
    await page.goto("/app/incidents/new");
    await expect(page.locator('select[name="typeId"] option', { hasText: name })).toHaveCount(1);
    await signOut(page);
  });
});
