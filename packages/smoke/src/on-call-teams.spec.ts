import { expect, test } from "@playwright/test";
import { MEMBERS, signIn, signOut } from "./helpers";

/**
 * Teams, the thing everything that pages "the owner" resolves to and that only
 * the seed could make: created with its path and its people, offered at once as
 * an owner on a service, and refused deletion while it owns one.
 */
test.describe("On-call · teams", () => {
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
  const name = `Smoke team ${stamp}`;

  test("a team is created, owns a service, refuses to vanish under it, then goes", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/on-call?tab=teams");

    await page.getByTestId("team-new").click();
    const form = page.locator('form[data-testid="team-form"]');
    await form.locator('input[name="name"]').fill(name);
    // The first real path in the list: a team paged through nothing is the
    // case the row warns about, not the one this test is following.
    const path = form.locator('select[name="policyPathId"] option').nth(1);
    await form
      .locator('select[name="policyPathId"]')
      .selectOption(await path.getAttribute("value"));
    await form.locator('input[name="chatChannel"]').fill("#smoke-oncall");
    await form.locator('label:has-text("Karim") input[type=checkbox]').first().check();
    await form.locator("button[type=submit]").click();

    const row = page.getByTestId("team-row").filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText("#smoke-oncall");
    await expect(row.getByTestId("team-member")).toHaveCount(1);
    // A team with a published path and somebody in it carries no warning.
    await expect(row).not.toContainText(/pages nobody|n'appelle personne|alarmiert niemanden/);

    // The point of a team: a service can be handed to it the moment it exists.
    await page.goto("/app/services");
    await page.getByTestId("service-new").click();
    const key = `smoke-team-svc-${stamp}`;
    await page.locator('form[data-testid="service-form"] input[name="key"]').fill(key);
    await page
      .locator('form[data-testid="service-form"] select[name="teamId"]')
      .selectOption({ label: name });
    await page.locator('form[data-testid="service-form"] button[type=submit]').click();
    await page.waitForURL(/\/app\/services\/[0-9a-f-]{36}$/);
    const serviceUrl = page.url();
    await expect(page.getByText(name).first()).toBeVisible();

    // Deleting it now would take the service's owner with it, silently.
    await page.goto("/app/on-call?tab=teams");
    await page.getByTestId("team-row").filter({ hasText: name }).getByTestId("team-delete").click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByTestId("team-row").filter({ hasText: name })).toBeVisible();

    // Hand the service back, and the team goes.
    await page.goto(serviceUrl);
    await page.getByTestId("service-delete").click();
    await page.waitForURL(/\/app\/services$/);
    await page.goto("/app/on-call?tab=teams");
    await page.getByTestId("team-row").filter({ hasText: name }).getByTestId("team-delete").click();
    await expect(page.getByTestId("team-row").filter({ hasText: name })).toHaveCount(0);
    await signOut(page);
  });
});
