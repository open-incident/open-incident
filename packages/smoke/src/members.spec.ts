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
  const dialog = page.getByTestId("invite-form");
  await dialog.locator('textarea[name="emails"]').fill(email);
  await dialog.locator('select[name="role"]').selectOption("responder");
  await page.getByTestId("invite-form-submit").click();
  const invited = page.locator(`[data-member-email="${email}"]`);
  await expect(invited).toBeVisible();
  await expect(invited).toHaveAttribute("data-status", "invited");
  // The link's expiry is read from the email just sent: seven days.
  await expect(invited).toContainText(/valid 7 days|valable 7 jours|7 Tage gültig/);
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
  // An accepted invitation signs in with a password.
  await expect(row.getByTestId("member-method")).toHaveText(/Password|Mot de passe|Passwort/);
  await row.getByTestId("member-disable").click();
  await expect(row).toHaveAttribute("data-status", "disabled");
  await expect(row.getByText(/^(Disabled|Désactivé|Deaktiviert)$/)).toBeVisible();
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

/**
 * The filters and the search are the list's own: the deep link of the
 * settings overview opens on the invitations, the chips count, the search
 * narrows by name or address, and an invitation can be revoked.
 */
test("filters, search, deep link and revoke", async ({ page }) => {
  const email = `smoke.revoke.${Date.now()}@skylark.dev`;
  await signIn(page, MEMBERS.owner);
  await page.goto("/app/settings/members");
  await page.getByTestId("invite-open").click();
  await page.getByTestId("invite-form").locator('textarea[name="emails"]').fill(email);
  await page.getByTestId("invite-form-submit").click();
  await expect(page.locator(`[data-member-email="${email}"]`)).toBeVisible();

  await page.goto("/app/settings/members?f=invited");
  await expect(page.locator('[data-filter="invited"]')).toHaveAttribute("aria-pressed", "true");
  const rows = page.locator("[data-member-email]");
  await expect(rows.first()).toBeVisible();
  for (const status of await rows.evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-status")),
  ))
    expect(status).toBe("invited");
  const invitedCount = await rows.count();
  await expect(page.locator('[data-filter="invited"]')).toContainText(String(invitedCount));

  await page.locator('[data-filter="all"]').click();
  await page.getByTestId("members-search").fill("amelie@");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-member-email", MEMBERS.owner);
  await page.getByTestId("members-search").fill("");

  const row = page.locator(`[data-member-email="${email}"]`);
  await row.getByTestId("member-revoke").click();
  await expect(row).toHaveCount(0);
});
