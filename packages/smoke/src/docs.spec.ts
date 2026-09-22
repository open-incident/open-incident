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
    // The shell's own rail is a complementary too now: pick the one that
    // actually holds chapter links.
    const nav = page
      .getByRole("complementary")
      .filter({ has: page.locator("a[href^='/app/docs/']") })
      .first();
    expect(await nav.locator("a[href^='/app/docs/']").count()).toBeGreaterThanOrEqual(20);
    await expect(page.locator("article h1")).toBeVisible();

    /*
     * Beside the chapter list, not under it.
     *
     * This is a geometry assertion because the obvious one cannot fail: the
     * guide's layout returned its two columns as siblings of nothing and
     * counted on the frame around them being a flex row, which it stopped
     * being. The chapters then stacked — the whole table of contents first and
     * the chapter thirteen hundred pixels below the fold — and every check
     * above still passed, because `toBeVisible` asks whether an element is
     * rendered, not whether anybody can see it.
     */
    const listBox = (await nav.boundingBox())!;
    const chapterBox = (await page.locator("article").first().boundingBox())!;
    expect(chapterBox.x).toBeGreaterThanOrEqual(listBox.x + listBox.width - 1);
    expect(chapterBox.y).toBeLessThan(listBox.y + listBox.height);

    // And the rail's own Guide entry opens a chapter rather than a page about
    // the guide: the reader asked for the guide.
    await page.goto("/app/incidents");
    await page.locator('aside a[href="/app/docs"]').first().click();
    await page.waitForURL(/\/app\/docs\/[a-z-]+$/);
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
