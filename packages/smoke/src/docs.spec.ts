import { expect, test } from "@playwright/test";
import { MEMBERS, signIn } from "./helpers";

/**
 * The user guide inside the product: every member reads it, the chapters come
 * from docs/guide, the illustrations are served by the product, and a chapter
 * that does not exist answers 404 rather than an empty page.
 */
test.describe("User guide", () => {
  test("a viewer opens the guide, navigates its chapters and sees the illustrations", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.viewer);
    await page.goto("/app/docs");
    await page.waitForURL(/\/app\/docs\/[a-z-]+/);
    const nav = page.getByRole("complementary").first();
    expect(await nav.locator("a[href^='/app/docs/']").count()).toBeGreaterThanOrEqual(20);
    await expect(page.locator("article h1")).toBeVisible();

    // A chapter with illustrations: the first image really loads from the product.
    await page.goto("/app/docs/incidents");
    await expect(page.locator("article h1")).toHaveText(/Incidents/);
    const img = page.locator("article figure img").first();
    await expect(img).toBeVisible();
    const src = await img.getAttribute("src");
    expect(src).toMatch(/^\/app\/docs\/img\/[a-z0-9-]+\.png$/);
    const res = await page.request.get(src!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
    // The "on this page" rail follows the chapter's headings; a link jumps to one.
    await expect(page.locator("aside a[href^='#']").first()).toBeVisible();

    // Chapter links between chapters resolve inside the guide.
    await page.locator("article a[href='/app/docs/alerts']").first().click();
    await page.waitForURL(/\/app\/docs\/alerts$/);
    await expect(page.locator("article h1")).toHaveText(/Alerts/);

    // Unknown chapter, unknown image: honest 404s.
    expect((await page.request.get("/app/docs/does-not-exist")).status()).toBe(404);
    expect((await page.request.get("/app/docs/img/nope.png")).status()).toBe(404);
  });
});
