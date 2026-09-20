import { expect, test } from "@playwright/test";
import { MEMBERS, signIn, signOut } from "./helpers";

/**
 * Objectives are a tab of Telemetry, not a section of their own.
 *
 * Two things have to keep holding for that move to be free. The address that
 * was in runbooks and in alert bodies still has to arrive somewhere — with
 * whatever it was carrying, because the server actions redirect through it to
 * report a refusal. And the tab has to offer exactly what the actions behind
 * it accept: `createSlo` asks for a responder, so a responder sees the button
 * and a viewer does not.
 */
test.describe.configure({ mode: "serial" });

test("the old objectives address lands on the tab, query and all", async ({ page }) => {
  await signIn(page, MEMBERS.owner);

  await page.goto("/app/slos?new=1");
  await expect(page).toHaveURL(/\/app\/telemetry\?[^#]*tab=slos/);
  await expect(page.getByTestId("slo-tab")).toBeVisible();
  // `new=1` is precisely what a redirect that dropped the query would lose,
  // and it is the one an action sends back after a refusal.
  await expect(page.getByTestId("slo-form")).toBeVisible();

  // The section is gone from the rail: an entry pointing at a redirect is the
  // kind of leftover nobody removes later.
  await expect(page.locator('a[href="/app/slos"]')).toHaveCount(0);
});

test("a responder can create an objective, a viewer only reads them", async ({ page }) => {
  await signIn(page, MEMBERS.responder);
  await page.goto("/app/telemetry?tab=slos");
  await expect(page.getByTestId("slo-new")).toBeVisible();

  await signOut(page);
  await signIn(page, MEMBERS.viewer);
  await page.goto("/app/telemetry?tab=slos");
  await expect(page.getByTestId("slo-tab")).toBeVisible();
  await expect(page.getByTestId("slo-new")).toHaveCount(0);
});
