import { expect, test } from "@playwright/test";
import { MEMBERS, signIn } from "./helpers";

/** Coverage: every schedule says how much of its next sixty days has someone on call, and lists the gaps. */
test.describe("Coverage", () => {
  test("a schedule shows its sixty-day coverage; an override with nobody opens a gap that is listed", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/on-call");
    await expect(page.getByTestId("coverage-summary")).toBeVisible();
    const before = await page.getByTestId("coverage-gap").count();
    // A null-member override tomorrow for two hours: an assumed gap inside the
    // expected window. At 10:00 local on purpose — the dialog binds the override
    // to the day rotation (09:00–21:00 in the demo), so a slot taken at the
    // current hour would fall outside it at night and open no gap.
    await page.getByTestId("override-open").click();
    const start = new Date(Date.now() + 24 * 3_600_000);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + 2 * 3_600_000);
    const local = (d: Date) =>
      new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    const form = page.locator('form[data-testid="override-form"]');
    await form.locator('select[name="memberId"]').selectOption("");
    const dates = form.locator('input[type="datetime-local"]');
    await dates.nth(0).fill(local(start));
    await dates.nth(1).fill(local(end));
    const reason = form.locator('input[name="reason"], textarea[name="reason"]');
    if ((await reason.count()) > 0) await reason.first().fill("Smoke gap");
    await form.locator('button[type="submit"]').click();
    await expect
      .poll(async () => page.getByTestId("coverage-gap").count(), { timeout: 15_000 })
      .toBeGreaterThan(before);
    await expect(page.getByTestId("coverage-summary")).toContainText(/trou|gap|Lücke/i);
  });
});
