import { expect, test } from "@playwright/test";
import { MEMBERS, signIn } from "./helpers";

/** Coverage: every schedule says how much of its next sixty days has someone on call, and lists the gaps. */
test.describe("Coverage", () => {
  test("a schedule shows its sixty-day coverage; an override with nobody opens a gap that is listed", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    // The override is taken from the Now tab, which is where the dialog lives;
    // the card it opens from names the schedule it lands on.
    await page.goto("/app/on-call?tab=now");
    const card = page
      .getByTestId("oncall-now")
      .filter({ has: page.getByTestId("override-open") })
      .first();
    const scheduleName = (await card.locator("span").first().textContent())?.trim() ?? "";
    // Coverage is a line per schedule on the Schedules tab. The gaps are not
    // listed one by one: the line says how many hours have nobody — and says
    // nothing while there are none —, so the override is proven by that figure
    // rising rather than by a new row.
    await page.goto("/app/on-call?tab=schedules");
    const summary = page
      .getByTestId("schedule-row")
      .filter({ hasText: scheduleName })
      .getByTestId("coverage-summary");
    await expect(summary).toBeVisible();
    const hours = async () => {
      const text = (await summary.textContent()) ?? "";
      const m = /(\d+)\s+(?:hours?|heures?|Stunden?)/i.exec(text);
      return m ? Number(m[1]) : 0;
    };
    const before = await hours();
    // A null-member override tomorrow for two hours: an assumed gap inside the
    // expected window. At 10:00 local on purpose — the dialog binds the override
    // to the first rotation (the day one, 09:00–21:00 in the demo), so a slot
    // taken at the current hour would fall outside it at night and open no gap.
    await page.goto("/app/on-call?tab=now");
    await page
      .getByTestId("oncall-now")
      .filter({ hasText: scheduleName })
      .getByTestId("override-open")
      .first()
      .click();
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

    // Put the week back. The gap stays open otherwise, and the next run makes
    // the same one — the figure does not rise, and the test fails on a
    // workspace it is pointed at twice. The override is taken back where it
    // shows: its cell in the grid of its schedule, tagged OVERRIDE.
    await page.goto("/app/on-call?tab=now");
    const pick = page.getByTestId("grid-schedules").getByRole("link", { name: scheduleName });
    if ((await pick.count()) > 0) await pick.first().click();
    const day = local(start).slice(0, 10);
    const cell = page.locator(`[data-testid="shift-cell"][data-day="${day}"][data-override="1"]`);
    for (let guard = 0; guard < 6 && (await cell.count()) > 0; guard++) {
      await cell.first().click();
      await expect(page.getByTestId("reassign")).toBeVisible();
      await page.getByTestId("override-remove").first().click();
      // Removing sends the reader back to the grid with the band closed.
      await expect(page.getByTestId("reassign")).toHaveCount(0);
    }
    await expect
      .poll(
        async () => {
          await page.goto("/app/on-call?tab=schedules");
          return hours();
        },
        { timeout: 20_000 },
      )
      .toBe(before);
  });
});
