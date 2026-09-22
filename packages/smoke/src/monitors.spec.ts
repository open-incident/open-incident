import { expect, test } from "@playwright/test";
import { MEMBERS, signIn, signOut } from "./helpers";

/**
 * The checks the product runs itself.
 *
 * Read-only on purpose, with one exception. A monitor is a thing that pages
 * people: creating one here, or resuming one of the demo's, would have the
 * worker reach out to a host that does not exist and wake whoever the demo put
 * on call. So this replays what a reader does — the list, a monitor's own page,
 * its journey — and writes exactly one thing, the criteria, which it puts back.
 */
test.describe("Monitors", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, MEMBERS.owner);
  });
  test.afterEach(async ({ page }) => {
    await signOut(page);
  });

  test("the list shows every monitor with its history", async ({ page }) => {
    await page.goto("/app/monitors");
    const rows = page.locator("a[href^='/app/monitors/']");
    const count = await rows.count();
    test.skip(count === 0, "no monitor in this workspace");
    // Every row says what it is and how it is; a row with neither is a row
    // nobody can act on.
    const first = await rows.first().innerText();
    expect(first).toMatch(/HTTP|API|PORT|DNS|SSL|DOMAIN|PING|SYNTHETIC|TRACES|LOGS|METRICS/);
    expect(first).toMatch(
      /Online|Degraded|Offline|Paused|Waiting|En ligne|Dégradé|Hors ligne|En pause|attente/,
    );
  });

  test("a monitor's page carries its rules, its chart and its journey", async ({ page }) => {
    await page.goto("/app/monitors");
    const journey = page.locator("a[href^='/app/monitors/']").filter({ hasText: /SYNTHETIC/ });
    const any = page.locator("a[href^='/app/monitors/']");
    test.skip((await any.count()) === 0, "no monitor in this workspace");
    const target = (await journey.count()) ? journey : any;
    await target.first().click();
    await page.waitForURL(/\/app\/monitors\/[0-9a-f-]+/);

    // The three choices are read back from the rule, not from the monitor row.
    await expect(page.getByText(/WHEN IT GOES OFFLINE|QUAND IL PASSE HORS LIGNE/i)).toBeVisible();
    if (await journey.count()) {
      // A journey with steps draws one row per step, with what it did.
      await expect(page.getByTestId("journey-row-0")).toBeVisible();
    }
  });

  /**
   * "Default criteria · editable later" is a promise the form makes on the way
   * in. This is the later, and the test is here because a form that posts the
   * rows it shows is one typo away from silently dropping the ones it does not.
   */
  test("the rules of a monitor can be rewritten, and survive the round trip", async ({ page }) => {
    await page.goto("/app/monitors");
    const rows = page.locator("a[href^='/app/monitors/']").filter({ hasText: /HTTP|API/ });
    test.skip((await rows.count()) === 0, "no reachability monitor in this workspace");
    await rows.first().click();
    await page.waitForURL(/\/app\/monitors\/[0-9a-f-]+/);
    const url = page.url();

    // `<details>` toggles, so clicking twice closes it.
    const open = async () => {
      const details = page.getByTestId("criteria-edit");
      if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) {
        await details.locator("summary").click();
      }
      return page.getByTestId("criterion-row");
    };
    let criteria = await open();
    // One blank row is always drawn at the end: that is how a rule is added.
    const before = (await criteria.count()) - 1;
    const blank = criteria.last();
    await blank.locator("select[name=on]").selectOption("response_time_ms");
    await blank.locator("select[name=op]").selectOption("gt");
    await blank.locator("input[name=value]").fill("4242");
    await blank.locator("select[name=then]").selectOption("degraded");
    await page.getByTestId("criteria-save").click();
    await page.waitForURL(/saved=criteria/);
    const card = page.getByTestId("criteria-edit").locator("..");
    await expect(card.getByText("4242").first()).toBeVisible();
    expect(await (await open()).count()).toBe(before + 2);

    // Put it back: clearing a value is how a rule is dropped. Every match, not
    // the first — a rerun of this test would otherwise leave one behind.
    criteria = await open();
    for (const field of await criteria.locator('input[name=value][value="4242"]').all()) {
      await field.fill("");
    }
    await page.getByTestId("criteria-save").click();
    await page.waitForURL(/saved=criteria/);
    // Scoped to the card: a latency elsewhere on the page that happens to carry
    // the same digits is not the rule this test wrote. Reloaded in the loop
    // because the first paint after a redirect can still be the cached one.
    await expect(async () => {
      await page.goto(url, { waitUntil: "networkidle" });
      await expect(page.getByTestId("criteria-edit").locator("..").getByText("4242")).toHaveCount(
        0,
        { timeout: 2_000 },
      );
    }).toPass({ timeout: 20_000 });
  });
});
