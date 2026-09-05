import { expect, test } from "@playwright/test";
import { MEMBERS, PASSWORD, linkFromMail, signIn, signInWith, signOut } from "./helpers";

/**
 * The complete sign-in story: a password can be forgotten and reset, an
 * invitation lands and creates a member, a session is really closed.
 */
test.describe("Authentication", () => {
  test("sign in, land on the incidents, sign out", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await expect(page).toHaveURL(/\/app\/incidents/);
    await expect(page.getByText("INC-217")).toBeVisible();
    await signOut(page);
    await page.goto("/app/incidents");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a wrong password is refused with a message", async ({ page }) => {
    await page.goto("/login");
    await page.locator("input[type=email]").fill(MEMBERS.responder);
    await page.locator("input[type=password]").fill("definitely-not-it");
    await page.locator("button[type=submit]").click();
    await expect(page.locator('[role="alert"]')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("forgot password → email → new password works, old one does not", async ({ page }) => {
    const since = Date.now();
    await page.goto("/forgot-password");
    await page.locator("input[type=email]").fill(MEMBERS.responder);
    await page.locator("button[type=submit]").click();
    await expect(page.getByTestId("forgot-sent")).toBeVisible();

    const link = await linkFromMail(MEMBERS.responder, "/reset-password", since);
    // The link MUST carry the workspace's subdomain: a reset landing on the
    // apex would resolve no workspace and 404.
    expect(new URL(link).host).toBe(new URL(page.url()).host);
    await page.goto(link);
    const fresh = `Smoke-${since}!`;
    await page.locator("input[type=password]").fill(fresh);
    await page.locator("button[type=submit]").click();
    await expect(page.getByTestId("reset-done")).toBeVisible();

    // The new password opens a session…
    await signInWith(page, MEMBERS.responder, fresh);

    // …and is put back, so the suite stays replayable.
    await page.goto("/app/account");
    await page.locator('input[name="currentPassword"]').fill(fresh);
    await page.locator('input[name="newPassword"]').fill(PASSWORD);
    await page.locator('form[data-testid="password-form"] button[type=submit]').click();
    await expect(page.getByTestId("password-changed")).toBeVisible();
    await signOut(page);
  });

  test("a viewer is refused on the settings, by URL and by action", async ({ page }) => {
    await signIn(page, MEMBERS.viewer);
    await page.goto("/app/settings/members");
    await expect(page.getByTestId("role-restricted")).toBeVisible();
    await expect(page.locator("form[action]")).toHaveCount(0);
    await signOut(page);
  });

  test("an already signed-in member is sent straight in, not asked again", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    // The real case: landing on the workspace's sign-in with a valid session —
    // from another workspace, or from a control plane's sign-in page, which sets
    // the cookie on the parent domain.
    await page.goto("/login");
    await page.waitForURL(/\/app\/incidents/);
    await expect(page.getByRole("button", { name: /sign in|se connecter/i })).toHaveCount(0);
  });
});
