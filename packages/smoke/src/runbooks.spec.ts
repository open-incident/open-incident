import { expect, test } from "@playwright/test";
import { MEMBERS, signIn } from "./helpers";
import { startAiMock } from "./ai-mock";
import { startTrackersMock } from "./trackers-mock";

/**
 * Runbooks: attached to a service from the catalog (a GitHub file, fetched
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

    await page.goto("/app/catalog?type=service&entry=checkout-api");
    const form = page.getByTestId("runbook-form");
    await form.locator('input[name="title"]').fill("Checkout latency runbook");
    await form
      .locator('input[name="sourceUrl"]')
      .fill("https://github.com/skylark/ops/blob/main/runbooks/checkout.md");
    await page.getByTestId("runbook-save").click();
    await page.waitForURL(/entry=checkout-api/);
    const row = page.getByTestId("runbook-row").filter({ hasText: "Checkout latency runbook" });
    await expect(row).toBeVisible();
    await expect(row).toContainText(/fetched|récupéré|abgerufen/i);

    // INC-217 is on checkout-api: the side panel lists the runbook.
    await page.goto("/app/incidents/217");
    await expect(page.getByTestId("ai-runbooks")).toContainText("Checkout latency runbook");
    // The assistant's dossier quotes it.
    ai.reset();
    await page.getByTestId("ai-summary-generate").click();
    await expect(page.getByTestId("ai-summary")).toContainText("Mock summary");
    const calls = ai.calls.filter((c) => c.path === "/v1/chat/completions");
    expect(calls.length).toBeGreaterThan(0);
    const prompt = JSON.stringify(calls[calls.length - 1]!.body);
    expect(prompt).toContain("Runbooks of the affected service");
    expect(prompt).toContain("connection pool");
  });
});
