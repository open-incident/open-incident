import { expect, test } from "@playwright/test";
import { MEMBERS, signIn, telemetryInstalled } from "./helpers";

/**
 * A collector pack's dashboard, placed from the screen that hands out the key.
 *
 * The worker places these by itself the first time a pack reports, which no
 * test can conjure without a collector; this is the other way in, and it
 * exercises the same function. What it is really guarding is the pair: a
 * dashboard that is placed must then be offered as a link, never as a second
 * "place it" button — the product creating two of the same screen because
 * nobody checked is the failure here.
 */
test.describe.configure({ mode: "serial" });

// Without a column store the whole Telemetry section is one card explaining
// how to install the module, and none of this exists. Checked rather than
// assumed: a suite that quietly passed here would be reporting on a screen it
// never opened.
test.beforeEach(async ({ page }) => {
  await signIn(page, MEMBERS.owner);
  test.skip(!(await telemetryInstalled(page)), "no telemetry module on this instance");
});

test("the packs are listed with what they send and whether they are", async ({ page }) => {
  await page.goto("/app/telemetry?tab=connect");

  for (const pack of ["host", "postgres", "docker", "kubernetes"]) {
    await expect(page.locator(`text=${pack}.yaml`)).toBeVisible();
  }
});

test("placing a pack's dashboard opens it, and only offers it once", async ({ page }) => {
  await page.goto("/app/telemetry?tab=connect");

  /*
   * The end state is what matters, and it is reached once: a link, no button.
   * On a fresh workspace this test performs the placement; run again against a
   * workspace that already has it, the button is legitimately gone and the
   * assertions below are the same ones. A test that demanded the button would
   * be asserting that the pack had never been placed, which is not the rule.
   */
  const install = page.getByTestId("pack-install-kubernetes");
  if ((await install.count()) > 0) {
    await install.click();
    await page.waitForURL(/\/app\/dashboards\/kubernetes-pack/);
  } else {
    await page.locator('a[href^="/app/dashboards/kubernetes-pack"]').click();
    await page.waitForURL(/\/app\/dashboards\/kubernetes-pack/);
  }

  // The panels draw. Empty is the honest answer here — nothing in this
  // workspace runs a Kubernetes collector — but an empty series drawn as an
  // area used to throw inside a server component and take the page with it.
  await expect(page.locator("text=Application error")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Kubernetes" })).toBeVisible();

  await page.goto("/app/telemetry?tab=connect");
  await expect(page.getByTestId("pack-install-kubernetes")).toHaveCount(0);
  await expect(page.locator('a[href^="/app/dashboards/kubernetes-pack"]')).toBeVisible();
});
