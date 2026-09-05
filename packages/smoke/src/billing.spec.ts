import { expect, test } from "@playwright/test";
import { MEMBERS, signIn } from "./helpers";

/**
 * Settings → Subscription & invoices belongs to the cloud edition: the
 * control plane sells, the product shows. On the self-hosted instance the
 * smoke suite drives, the screen must not exist — not a disabled version of
 * it, not an empty one: no entry in the navigation, and a 404 on the URL.
 */
test.describe("Subscription & invoices", () => {
  test("a self-hosted instance has no subscription screen", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/general");
    // The navigation is drawn (another entry is a link) before asserting the absence.
    await expect(page.locator("a[href='/app/settings/members']").first()).toBeVisible();
    await expect(page.locator("a[href='/app/settings/billing']")).toHaveCount(0);
    const res = await page.request.get("/app/settings/billing");
    expect(res.status()).toBe(404);
  });
});
