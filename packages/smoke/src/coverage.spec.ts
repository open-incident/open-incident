import { expect, test } from "@playwright/test";
import { MEMBERS, signIn } from "./helpers";

/** Coverage: every schedule says how much of its next sixty days has someone on call, and lists the gaps. */
test.describe("Coverage", () => {
  test("a schedule shows its sixty-day coverage; an override with nobody opens a gap that is listed", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    // Coverage is a line per schedule on the Schedules tab. The gaps are no
    // longer listed one by one: the line says how many hours have nobody, so
    // the override is proven by that figure rising rather than by a new row.
    await page.goto("/app/on-call?tab=schedules");
    const summary = page.getByTestId("coverage-summary").first();
    await expect(summary).toBeVisible();
    const hours = async () => {
      const text = (await summary.textContent()) ?? "";
      const m = /(\d+)\s+(?:hours?|heures?|Stunden?)/i.exec(text);
      return m ? Number(m[1]) : 0;
    };
    const before = await hours();
    // A null-member override tomorrow for two hours: an assumed gap inside the
    // expected window. At 10:00 local on purpose — the dialog binds the override
    // to the day rotation (09:00–21:00 in the demo), so a slot taken at the
    // current hour would fall outside it at night and open no gap.
    // The override is taken from the Now tab, which is where the dialog lives.
    await page.goto("/app/on-call?tab=now");
    await page.getByTestId("override-open").first().click();
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
      .poll(
        async () => {
          await page.goto("/app/on-call?tab=schedules");
          return hours();
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(before);
    await expect(summary).toContainText(/nobody|personne|niemand/i);
  });
});
