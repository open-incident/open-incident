import { expect, request, test } from "@playwright/test";
import { STATUS_BASE_URL } from "../playwright.config";
import { MEMBERS, signIn } from "./helpers";

/**
 * Internal status pages: to the outside the page does not exist (404, feeds
 * included); a signed-in member opens it from the product and gets a day's
 * access. Back to public, anyone sees it again.
 */
test.describe("Internal status page", () => {
  test("internal → 404 outside, open from the product → visible; public again → 200", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/status-pages");
    const openLink = page.locator('a[href$="/open"], a[href*="status.localhost"]').first();
    await expect(openLink).toBeVisible();
    const anon = await request.newContext();
    expect((await anon.get(STATUS_BASE_URL)).status()).toBe(200);

    await page.getByTestId("status-visibility").selectOption("internal");
    await page.locator('form[data-testid="brand-form"] button[type="submit"]').first().click();
    await page.waitForURL(/saved=1/);
    expect((await anon.get(STATUS_BASE_URL)).status()).toBe(404);
    expect((await anon.get(`${STATUS_BASE_URL}/rss.xml`)).status()).toBe(404);

    // The member's door: the admin link now goes through /open.
    const door = page.locator('a[href$="/open"]').first();
    await expect(door).toBeVisible();
    const href = await door.getAttribute("href");
    await page.goto(href!);
    await page.waitForURL((u) => u.origin === new URL(STATUS_BASE_URL).origin);
    await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
    expect(page.url().startsWith(STATUS_BASE_URL)).toBe(true);
    // No subscription form on an internal page.
    await expect(page.getByRole("button", { name: /subscribe|abonner|abonnieren/i })).toHaveCount(
      0,
    );

    await page.goto("/app/status-pages");
    await page.getByTestId("status-visibility").selectOption("public");
    await page.locator('form[data-testid="brand-form"] button[type="submit"]').first().click();
    await page.waitForURL(/saved=1/);
    expect((await anon.get(STATUS_BASE_URL)).status()).toBe(200);
    await anon.dispose();
  });
});
