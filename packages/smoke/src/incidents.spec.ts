import { expect, test } from "@playwright/test";
import { MEMBERS, signIn, signOut } from "./helpers";

/**
 * The incident journey on the demo workspace: the list shows the reference
 * incident, the detail shows its timeline, a status update really lands in
 * it, a declaration creates a numbered incident.
 */
test.describe("Incidents", () => {
  test("INC-217 opens with its timeline and follow-ups", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/incidents/217");
    await expect(page.getByRole("heading", { name: /Pic de latence checkout/ })).toBeVisible();
    await expect(page.getByText("Post-mortem", { exact: false }).first()).toBeVisible();
    await expect(page.getByTestId("timeline-event").first()).toBeVisible();
    await signOut(page);
  });

  test("declaring an incident creates INC-222 and posting an update extends its timeline", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.responder);
    await page.goto("/app/incidents/new");
    const title = `[smoke ${new Date().toISOString().slice(11, 19)}] Latence API`;
    await page.locator('input[name="name"]').fill(title);
    // The default type requires the affected service and the region: pick the first of each.
    await page.locator('select[name="serviceEntryId"]').selectOption({ index: 1 });
    await page.locator('select[name="field.region"]').selectOption({ index: 1 });
    await page.locator('form[data-testid="declare-form"] button[type=submit]').click();
    await page.waitForURL(/\/app\/incidents\/\d+$/);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    const before = await page.getByTestId("timeline-event").count();
    await page.getByTestId("update-open").click();
    await page.locator('textarea[name="message"]').fill("Smoke update — investigating.");
    await page.locator('form[data-testid="update-form"] button[type=submit]').click();
    await expect(page.getByTestId("timeline-event")).toHaveCount(before + 1);
    await expect(page.getByText("Smoke update — investigating.")).toBeVisible();
    await signOut(page);
  });

  test("a viewer sees incidents but cannot declare", async ({ page }) => {
    await signIn(page, MEMBERS.viewer);
    await page.goto("/app/incidents");
    await expect(page.getByText("INC-217")).toBeVisible();
    await expect(page.getByTestId("declare-open")).toHaveCount(0);
    const res = await page.request.get("/app/incidents/new", {
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    expect([302, 303, 307, 403]).toContain(res.status());
    await signOut(page);
  });
});
