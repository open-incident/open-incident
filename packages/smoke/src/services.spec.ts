import { expect, test } from "@playwright/test";
import { MEMBERS, signIn, signOut } from "./helpers";

/**
 * Services, the one path that does not start with a signal: a service is
 * declared before anything names it, lands adopted and unseen with its owner
 * team, refuses to be declared twice, and — because its key can never be
 * edited — can be removed again as long as no signal has touched it.
 */
test.describe("Services", () => {
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
  const key = `smoke-svc-${stamp}`;

  test("a service is declared, found again, and removed while nothing has seen it", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/services");

    // Declared with the key in the case a human types it: stored lowercased,
    // which is how a signal's `service:` will arrive.
    await page.getByTestId("service-new").click();
    await page
      .locator('form[data-testid="service-form"] input[name="key"]')
      .fill(key.toUpperCase());
    await page.locator('form[data-testid="service-form"] input[name="name"]').fill("Smoke service");
    await page.locator('form[data-testid="service-form"] button[type=submit]').click();

    await page.waitForURL(/\/app\/services\/[0-9a-f-]{36}$/);
    const url = page.url();
    await expect(page.getByRole("heading", { name: key })).toBeVisible();
    await expect(page.getByText("Smoke service")).toBeVisible();
    // Adopted, and honest about never having been observed.
    await expect(page.getByText(/Vu nulle part|Not seen anywhere|Bisher nirgends/)).toBeVisible();

    // It is in the adopted list, not in "seen in traffic".
    await page.goto("/app/services");
    await expect(page.getByText(key)).toBeVisible();
    await page.goto("/app/services?tab=seen");
    await expect(page.getByText(key)).toHaveCount(0);

    // Declaring it again is not an error: the answer is the service itself.
    await page.goto("/app/services");
    await page.getByTestId("service-new").click();
    await page.locator('form[data-testid="service-form"] input[name="key"]').fill(key);
    await page.locator('form[data-testid="service-form"] button[type=submit]').click();
    await expect(page.getByTestId("service-exists")).toBeVisible();
    expect(page.url()).toContain(url.split("/").pop()!);

    // A runbook attached to it blocks the removal rather than being orphaned:
    // the foreign key would null its service and it would vanish from every
    // screen while staying in the assistant's index.
    const book = page.getByTestId("runbook-form");
    await book.locator('input[name="title"]').fill("Smoke runbook");
    await book.locator('textarea[name="content"]').fill("Restart the relay, then check the queue.");
    await page.getByTestId("runbook-save").click();
    await page.waitForURL(/\/app\/services\/[0-9a-f-]{36}$/);
    await page.getByTestId("service-delete").click();
    await expect(
      page.getByText(/d'abord son runbook|Remove its runbook|zuerst sein Runbook/),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: key })).toBeVisible();
    await page
      .getByTestId("runbook-row")
      .filter({ hasText: "Smoke runbook" })
      .getByRole("button")
      .click();
    await page.waitForURL(/\/app\/services\/[0-9a-f-]{36}$/);

    // A typed key is the one field that cannot be edited, so it can be undone.
    await page.getByTestId("service-delete").click();
    await page.waitForURL(/\/app\/services$/);
    await expect(page.getByText(key)).toHaveCount(0);

    // A service traffic has named keeps its remove button hidden: deleting it
    // would achieve nothing, the next signal carrying the name recreates it.
    await page.goto("/app/services");
    await page.getByText("checkout-api").first().click();
    await page.waitForURL(/\/app\/services\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("service-delete")).toHaveCount(0);
    await signOut(page);
  });
});
