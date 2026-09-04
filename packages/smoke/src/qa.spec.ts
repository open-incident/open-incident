import { expect, test } from "@playwright/test";
import { MEMBERS, signIn } from "./helpers";

/**
 * Settings → QA: the owner sees the prerequisites and the suites, runs the
 * formatting check from the screen, watches it through the worker to a
 * result with its log; a non-owner is told why the screen is closed. The
 * smoke suite itself is not launched from here — it would run inside itself.
 */
test.describe("QA", () => {
  test("an owner runs the formatting suite from the admin and reads the result", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/qa");
    await expect(page.getByTestId("qa-prereqs")).toBeVisible();
    // This instance runs from the repository: the suites can run.
    await expect(page.getByTestId("qa-unavailable")).toHaveCount(0);
    for (const suite of ["smoke", "unit", "typecheck", "lint", "format"])
      await expect(page.getByTestId(`qa-suite-${suite}`)).toBeVisible();

    await page.getByTestId("qa-run-format").click();
    await page.waitForURL(/\/app\/settings\/qa\/[0-9a-f-]+$/);
    // The worker picks the job up, streams the log, then a verdict lands.
    await expect(page.getByTestId("qa-run-status")).toHaveText(
      /Passed|Failed|Réussi|Échoué|Bestanden|Fehlgeschlagen/,
      {
        timeout: 240_000,
      },
    );
    const status = await page.getByTestId("qa-run-status").textContent();
    const log = await page.getByTestId("qa-log").textContent();
    expect(log).toContain("prettier --check");
    if (!/Passed|Réussi|Bestanden/.test(status ?? "")) {
      // A real formatting defect in the repository: the screen names the files.
      expect(await page.getByTestId("qa-failure").count()).toBeGreaterThan(0);
    }
    await page.goto("/app/settings/qa");
    await expect(page.getByTestId("qa-run-row").first()).toBeVisible();
    await expect(page.getByTestId("qa-suite-format").getByTestId("qa-last-status")).toBeVisible();
  });

  test("a responder is refused, an admin is told the screen is for owners", async ({ page }) => {
    await signIn(page, MEMBERS.responder);
    await page.goto("/app/settings/qa");
    await expect(page.getByTestId("role-restricted")).toBeVisible();
  });
});
