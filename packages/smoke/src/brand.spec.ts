import { expect, request, test } from "@playwright/test";
import { BASE_URL, STATUS_BASE_URL } from "../playwright.config";
import { MEMBERS, signIn } from "./helpers";

/**
 * Brand and appearance: a logo uploaded in the settings is served by the
 * product (sandboxed), reaches the public status page, and goes away when
 * removed; a member's theme choice is stamped on the document before paint.
 */
test.describe("Brand & appearance", () => {
  test("a logo is uploaded, served safely, shown on the status page, then removed", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/general");
    const upload = page.getByTestId("logo-upload");
    test.skip((await upload.count()) === 0, "object storage not configured on this instance");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="11" fill="#B4552D"/><script>alert(1)</script></svg>`;
    await page
      .getByTestId("logo-file")
      .setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
    await upload.click();
    await page.waitForURL(/saved=1/);
    await expect(page.getByTestId("logo-remove")).toBeVisible();

    const api = await request.newContext({ baseURL: BASE_URL });
    const res = await api.get("/brand/logo");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/svg+xml");
    expect(res.headers()["content-security-policy"]).toContain("sandbox");
    expect(await res.text()).toContain("<rect");

    // The public page shows the logo instead of the initial.
    await page.goto(STATUS_BASE_URL);
    await expect(page.locator('header img[src*="/brand/logo"]')).toBeVisible();

    await page.goto("/app/settings/general");
    await page.getByTestId("logo-remove").click();
    await page.waitForURL(/saved=1/);
    await expect(page.getByTestId("logo-remove")).toHaveCount(0);
    expect((await api.get("/brand/logo")).status()).toBe(404);
    await api.dispose();
  });

  test("the theme choice is stamped on the document and can be reverted", async ({ page }) => {
    await signIn(page, MEMBERS.responder);
    await page.goto("/app/account");
    await page.getByTestId("account-theme").selectOption("dark");
    await page.locator("form button[type=submit]").first().click();
    await page.waitForURL(/saved=1/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByTestId("account-theme").selectOption("");
    await page.locator("form button[type=submit]").first().click();
    await page.waitForURL(/saved=1/);
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
  });
});
