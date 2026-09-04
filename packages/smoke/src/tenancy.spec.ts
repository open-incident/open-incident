import { expect, test } from "@playwright/test";
import { HOST } from "../playwright.config";
import { expectStatus } from "./helpers";

/**
 * The domain is the first guard. An invented subdomain must answer 404 on
 * every anonymous entry point — a sign-in form reachable under any hostname,
 * with a wildcard certificate, is a phishing kit anyone can address.
 */
test.describe("Workspace resolution", () => {
  test("an invented workspace answers 404 everywhere", async ({ page }) => {
    const ghost = `http://secure-paypal-login.${HOST}`;
    for (const path of [
      "/",
      "/login",
      "/forgot-password",
      "/reset-password?token=x",
      "/invite/abc",
      "/app/incidents",
    ]) {
      const res = await page.request.get(`${ghost}${path}`, {
        maxRedirects: 0,
        failOnStatusCode: false,
      });
      expect(res.status(), `${path} on a ghost workspace`).toBe(404);
    }
  });

  test("a reserved subdomain answers 404", async ({ page }) => {
    const res = await page.request.get(`http://www.${HOST}/login`, {
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(404);
  });

  test("the real workspace serves its sign-in page with its own name", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Skylark Systems" })).toBeVisible();
    await expect(page.locator("input[type=email]")).toBeVisible();
  });

  test("the app redirects anonymous visitors to sign-in", async ({ page }) => {
    await expectStatus(page, "/app/incidents", 307);
  });
});
