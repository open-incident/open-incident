import { expect, test } from "@playwright/test";
import { MEMBERS, signIn } from "./helpers";

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

test("the packs are listed with what they send and whether they are", async ({ page }) => {
  await signIn(page, MEMBERS.owner);
  await page.goto("/app/telemetry?tab=connect");

  for (const pack of ["host", "postgres", "docker", "kubernetes"]) {
    await expect(page.locator(`text=${pack}.yaml`)).toBeVisible();
  }
});

test("placing a pack's dashboard opens it, and only offers it once", async ({ page }) => {
  await signIn(page, MEMBERS.owner);
  await page.goto("/app/telemetry?tab=connect");

  const install = page.getByTestId("pack-install-kubernetes");
  await expect(install).toBeVisible();
  await install.click();
  await page.waitForURL(/\/app\/dashboards\/kubernetes-pack/);

  // The panels draw. Empty is the honest answer here — nothing in this
  // workspace runs a Kubernetes collector — but an empty series drawn as an
  // area used to throw inside a server component and take the page with it.
  await expect(page.locator("text=Application error")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Kubernetes" })).toBeVisible();

  await page.goto("/app/telemetry?tab=connect");
  await expect(page.getByTestId("pack-install-kubernetes")).toHaveCount(0);
  await expect(page.locator('a[href="/app/dashboards/kubernetes-pack"]')).toBeVisible();
});
