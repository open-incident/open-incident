import { expect, test } from "@playwright/test";
import { MEMBERS, signIn } from "./helpers";
import { startAiMock } from "./ai-mock";
import { startTrackersMock } from "./trackers-mock";

/**
 * Runbooks: attached to a service from its own page (a GitHub file, fetched
 * through the API), shown on the incident, and quoted to the assistant only
 * when documentation is an allowed source.
 */
test.describe("Runbooks", () => {
  let ai: Awaited<ReturnType<typeof startAiMock>>;
  let forge: Awaited<ReturnType<typeof startTrackersMock>>;
  test.beforeAll(async () => {
    ai = await startAiMock();
    forge = await startTrackersMock();
  });
  test.afterAll(async () => {
    ai.server.close();
    forge.server.close();
  });

  test("a GitHub runbook is fetched, shown on the incident and read by the assistant when allowed", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    // Documentation as a source is off by default: switch it on.
    await page.goto("/app/settings/ai");
    const docsToggle = page.locator('input[name="src_docs"]');
    if (!(await docsToggle.isChecked())) await docsToggle.locator("xpath=..").click();
    await page.getByTestId("ai-save").click();
    await page.waitForURL(/saved=1/);

    await page.goto("/app/services");
    await page.getByRole("link", { name: "checkout-api" }).first().click();
    await page.waitForURL(/\/app\/services\/[0-9a-f-]+/);
    const form = page.getByTestId("runbook-form");
    await form.locator('input[name="title"]').fill("Checkout latency runbook");
    await form
      .locator('input[name="sourceUrl"]')
      .fill("https://github.com/skylark/ops/blob/main/runbooks/checkout.md");
    await page.getByTestId("runbook-save").click();
    await page.waitForURL(/\/app\/services\/[0-9a-f-]+/);
    const row = page.getByTestId("runbook-row").filter({ hasText: "Checkout latency runbook" });
    await expect(row).toBeVisible();
    await expect(row).toContainText(/fetched|récupéré|abgerufen/i);

    // INC-217 is on checkout-api: the Context tab lists the runbook, with the
    // host it came from and when it was fetched.
    await page.goto("/app/incidents/217?tab=context");
    await expect(page.getByTestId("ai-runbooks")).toContainText("Checkout latency runbook");
    // The assistant's dossier quotes it. The summary is an Atlas action.
    ai.reset();
    await page.goto("/app/incidents/217?tab=atlas");
    await page.getByTestId("ai-summary-generate").click();
    await expect(page.getByTestId("ai-summary")).toContainText("Mock summary");
    // The summary lands in the page as soon as the action returns, and the
    // mock records the call a moment before that — but an incident that
    // already carries a summary shows the old one straight away, so the text
    // assertion above can pass before anything was asked. Poll the mock.
    await expect
      .poll(() => ai.calls.filter((c) => c.path === "/v1/chat/completions").length)
      .toBeGreaterThan(0);
    const calls = ai.calls.filter((c) => c.path === "/v1/chat/completions");
    const prompt = JSON.stringify(calls[calls.length - 1]!.body);
    expect(prompt).toContain("Runbooks of the affected service");
    expect(prompt).toContain("connection pool");

    // Put the service back as it was: a second run would otherwise find two
    // runbooks by that title and every assertion on "the" row would be
    // ambiguous. A suite pointed at a workspace it keeps has to leave it as it
    // found it.
    await page.goto("/app/services");
    await page.getByRole("link", { name: "checkout-api" }).first().click();
    await page.waitForURL(/\/app\/services\/[0-9a-f-]+/);
    const created = page.getByTestId("runbook-row").filter({ hasText: "Checkout latency runbook" });
    // Re-counted every turn: the click reloads the page, so a count taken
    // before the loop is stale by the second iteration.
    for (let guard = 0; guard < 5; guard++) {
      const left = await created.count();
      if (left === 0) break;
      await created.first().getByTestId("runbook-delete").click();
      await expect(created).toHaveCount(left - 1);
    }
    await expect(created).toHaveCount(0);
  });
});
