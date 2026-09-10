import { expect, test } from "@playwright/test";
import { MEMBERS, signIn } from "./helpers";
import { startAiMock } from "./ai-mock";

/**
 * Root cause analysis (RCA), against the mock model server: a person asks for
 * an assessment, the findings cite the incident's own evidence, the adversarial
 * pass leaves its note, a responder's note re-assesses with that note cited,
 * the timeline records it, and the governance screen carries the switch.
 */
test.describe("Root cause analysis", () => {
  let mock: Awaited<ReturnType<typeof startAiMock>>;
  test.beforeAll(async () => {
    mock = await startAiMock();
  });
  test.afterAll(async () => {
    mock.server.close();
  });

  test("an assessment is asked for, cited, challenged, steered and recorded", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/incidents/221?tab=investigation");
    await expect(page.getByTestId("rca")).toBeVisible();
    await page.getByTestId("rca-rerun").click();

    // The synthesis and the hypotheses land, live.
    const summary = page.getByTestId("rca-summary");
    await expect(summary).toContainText("Mock", { timeout: 45_000 });
    await expect(page.getByTestId("rca-hypothesis").first()).toContainText("Mock hypothesis");
    // Every finding cites evidence that exists — the ids are rendered as chips.
    const finding = page.getByTestId("rca-finding").first();
    await expect(finding).toBeVisible();
    await expect(finding.locator("a, span[title]").last()).toHaveText(/^[A-Z]\d+ · /);
    // The adversarial reviewer weakened the second hypothesis and said why.
    await expect(page.getByTestId("rca-hypothesis").nth(1)).toContainText(/Mock review/);

    // Steering: a note is cited by the next assessment.
    const form = page.getByTestId("rca-note-form");
    await form.locator("textarea").fill("Smoke note: the rollback did not restore service.");
    await form.getByRole("button").click();
    await expect(page.getByTestId("rca-steer")).toContainText("Smoke note", { timeout: 45_000 });
    await expect(page.getByTestId("rca-findings")).toContainText(/rollback did not help/, {
      timeout: 45_000,
    });

    // The timeline says so.
    await page.goto("/app/incidents/221");
    await expect(
      page
        .getByText(
          /Root cause analysis assessed|Analyse de cause racine évaluée|Root-Cause-Analyse bewertet/,
        )
        .first(),
    ).toBeVisible();
    // The side panel carries the cause and the way to the tab.
    await expect(page.getByTestId("ai-rca")).toContainText("Mock hypothesis");

    // Governance: the capability has its own switch, like every other.
    await page.goto("/app/settings/ai");
    await expect(page.getByTestId("ai-cap-investigate")).toBeVisible();
  });
});
