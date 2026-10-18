import { expect, test } from "@playwright/test";
import { MEMBERS, signIn } from "./helpers";

/**
 * What Atlas did, read by a person: the incident's Atlas tab (the run, its
 * journal, the grade, the cost), the review queue of the incidents Atlas
 * resolved itself, and the slots other screens carry — the service card, the
 * first step of a policy, the "When Atlas resolves on its own" choice. The
 * demo seed gives INC-217 a level-2 run with a proposal a person approved,
 * and two resolutions by Atlas waiting for review.
 */
test.describe("Atlas, as people read it", () => {
  test("the Atlas tab shows the run, the journal and who decided what", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/incidents/217?tab=atlas");
    const bar = page.getByTestId("atlas-bar");
    await expect(bar).toBeVisible();
    // The service's level, in the bar that stays on screen.
    await expect(bar).toContainText(/checkout-api/);
    await expect(bar).toContainText(/level 2|niveau 2|Stufe 2/);
    await expect(page.getByTestId("atlas-stop")).toBeVisible();

    // Where things stand: four lines.
    await expect(page.getByTestId("atlas-stand")).toContainText(
      /What caused it|Ce qui l'a causé|Was es verursacht hat/,
    );

    // The journal, and its filters.
    const journal = page.getByTestId("atlas-journal");
    const rows = journal.getByTestId("atlas-action");
    expect(await rows.count()).toBeGreaterThan(3);
    await page.getByTestId("atlas-filter-sys").click();
    const systems = await rows.count();
    expect(systems).toBeGreaterThan(0);
    for (let i = 0; i < systems; i++)
      await expect(rows.nth(i)).toHaveAttribute("data-kind", "system");
    await page.getByTestId("atlas-filter-all").click();

    // The proposal waited for a person, and the chip says how long.
    await expect(journal).toContainText(
      /waiting for approval|en attente d'approbation|wartet auf Freigabe/,
    );

    // The grade given after closure is the one shown pressed.
    await expect(page.getByTestId("atlas-grade-bullseye")).toHaveAttribute("aria-pressed", "true");
    // What the run cost.
    await expect(page.getByTestId("atlas-cost")).toContainText("€");
  });

  test("the root cause says what its hypothesis led Atlas to do", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/incidents/217?tab=rca");
    const guided = page.getByTestId("rca-guided");
    await expect(guided).toContainText(/guided the run|a guidé l'exécution|hat den Lauf geleitet/);
    await guided.click();
    await expect(page).toHaveURL(/tab=atlas/);
  });

  test("Pause and resume, from the bar", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/incidents/217?tab=atlas");
    await page.getByTestId("atlas-pause").click();
    await expect(page.getByTestId("atlas-toast")).toContainText(/Paused|En pause|Pausiert/);
    await expect(page.getByTestId("atlas-bar")).toContainText(/paused|en pause|pausiert/);
    await page.getByTestId("atlas-pause").click();
    await expect(page.getByTestId("atlas-toast")).toContainText(/resumes|reprend|macht .* weiter/);
    await expect(page.getByTestId("atlas-bar")).not.toContainText(/· (paused|en pause|pausiert)/);
  });

  test("a viewer reads the run but has no button on it", async ({ page }) => {
    await signIn(page, MEMBERS.viewer);
    await page.goto("/app/incidents/217?tab=atlas");
    await expect(page.getByTestId("atlas-bar")).toBeVisible();
    await expect(page.getByTestId("atlas-stop")).toHaveCount(0);
    await expect(page.getByTestId("atlas-undo")).toHaveCount(0);
  });

  test("the review queue lists what Atlas resolved, and a verdict grades it", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/incidents?tab=atlas");
    const queue = page.getByTestId("atlas-review");
    await expect(queue).toBeVisible();
    const pending = queue.locator("[data-testid=atlas-review-card][data-state=pending]");
    expect(await pending.count()).toBeGreaterThan(0);
    const card = pending.first();
    await expect(card.getByTestId("atlas-review-status")).toContainText(
      /Resolved by Atlas|Résolu par Atlas|Von Atlas behoben/,
    );
    // Its steps, each with its time and kind.
    expect(await card.getByTestId("atlas-review-step").count()).toBeGreaterThan(1);
    const number = (await card.locator("a").first().textContent())?.trim();
    await card.getByTestId("atlas-review-ok").click();
    await expect(page.getByTestId("atlas-toast")).toContainText(/On target|Dans la cible|Im Ziel/);
    // Read: it leaves the pending cards and keeps its verdict.
    const read = queue
      .locator("[data-testid=atlas-review-card]")
      .filter({ hasText: number ?? "" })
      .first();
    await expect(read).toHaveAttribute("data-state", "ok");
    await expect(read).toContainText(/Graded On target|Noté « Dans la cible »|Mit „Im Ziel“/);
  });

  test("the service card, the policy's first step and the notification choice", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/services");
    await page.getByText("checkout-api", { exact: true }).first().click();
    const card = page.getByTestId("atlas-service-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("atlas-service-level")).toContainText(/[LNS]\d · /);
    expect(await card.getByTestId("atlas-service-criterion").count()).toBeGreaterThan(0);

    await page.goto("/app/on-call?tab=policies");
    await expect(page.getByTestId("atlas-policy-step").first()).toContainText(
      /Atlas tries first|Atlas essaie d'abord|Atlas versucht es zuerst/,
    );

    await page.goto("/app/on-call?tab=notifications");
    const push = page.getByTestId("atlas-notify-push");
    await push.click();
    await expect(push).toHaveAttribute("aria-checked", "true");
    await page.reload();
    await expect(page.getByTestId("atlas-notify-push")).toHaveAttribute("aria-checked", "true");
    // Back to the default.
    await page.getByTestId("atlas-notify-summary").click();
    await expect(page.getByTestId("atlas-notify-summary")).toHaveAttribute("aria-checked", "true");
  });

  test("Insights › Atlas is computed from the rows", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/insights?tab=atlas");
    const tab = page.getByTestId("atlas-insights");
    await expect(tab).toBeVisible();
    await expect(tab.getByTestId("atlas-kpi")).toHaveCount(4);
    expect(await tab.getByTestId("atlas-insights-service").count()).toBeGreaterThan(0);
    await expect(tab.getByTestId("atlas-grades")).toContainText(
      /Bullseye|Dans le mille|Volltreffer/,
    );
  });
});
