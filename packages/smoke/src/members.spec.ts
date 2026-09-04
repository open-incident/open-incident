import { expect, test } from "@playwright/test";
import { MEMBERS, linkFromMail, signIn, signInWith, signOut } from "./helpers";

/**
 * Inviting a member: the screen sends a real email, the link creates a real
 * identity, the new member can sign in. Uses a throwaway address on every run
 * — the demo members are never touched.
 */
test("invite a responder → accept → sign in → disable", async ({ page }) => {
  const email = `smoke.${Date.now()}@skylark.dev`;
  const since = Date.now();

  await signIn(page, MEMBERS.owner);
  await page.goto("/app/settings/members");
  await page.getByTestId("invite-open").click();
  await page.locator('textarea[name="emails"]').fill(email);
  await page
    .locator('form[data-testid="invite-form"] select[name="role"]')
    .selectOption("responder");
  await page.locator('form[data-testid="invite-form"] button[type=submit]').click();
  await expect(page.getByText(email)).toBeVisible();
  await signOut(page);

  const link = await linkFromMail(email, "/invite/", since);
  await page.goto(link);
  await page.locator('input[name="name"]').fill("Smoke Responder");
  await page.locator('input[name="password"]').fill("smoke-password-1");
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(/\/login\?accepted=1/);

  await signInWith(page, email, "smoke-password-1");
  await signOut(page);

  // Disabled by the owner: the session is refused from then on.
  await signIn(page, MEMBERS.owner);
  await page.goto("/app/settings/members");
  const row = page.locator(`[data-member-email="${email}"]`);
  await row.getByTestId("member-disable").click();
  await expect(row.getByText("Disabled").or(row.getByText("Désactivé"))).toBeVisible();
  await signOut(page);
  // Replayed like signIn(): the suite has just signed in three times from one
  // IP and Better Auth's rate limit answers the fourth with a 429.
  await expect(async () => {
    await page.goto("/login");
    await page.locator("input[type=email]").fill(email);
    await page.locator("input[type=password]").fill("smoke-password-1");
    await page.locator("button[type=submit]").click();
    await expect(page).toHaveURL(/error=not-a-member/, { timeout: 5_000 });
  }).toPass({ timeout: 60_000, intervals: [1_000, 3_000, 6_000, 12_000] });
});
