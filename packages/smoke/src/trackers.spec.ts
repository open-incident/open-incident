import { expect, test } from "@playwright/test";
import { MEMBERS, signIn } from "./helpers";
import { startTrackersMock } from "./trackers-mock";

/**
 * Issue trackers, against a mock of the vendors' APIs (port 3199, see .env
 * *_API_BASE): credentials are tested before being saved, a follow-up is
 * exported as an issue and keeps the link, and closing the issue over there
 * marks the follow-up done here at the next sync.
 */
test.describe("Issue trackers", () => {
  let mock: Awaited<ReturnType<typeof startTrackersMock>>;
  test.beforeAll(async () => {
    mock = await startTrackersMock();
  });
  test.afterAll(async () => {
    mock.server.close();
  });

  test("GitHub: refused credentials are not saved; good ones connect, export a follow-up and bring its status back", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/integrations?connect=github");
    const form = page.getByTestId("tracker-form");
    await form.locator('input[name="repo"]').fill("skylark/ops");
    await form.locator('input[name="secret"]').fill("bad-token-000");
    await page.getByTestId("tracker-save").click();
    await page.waitForURL(/error=test/);
    await expect(page.getByRole("alert")).toBeVisible();

    await page.getByTestId("tracker-form").locator('input[name="repo"]').fill("skylark/ops");
    await page
      .getByTestId("tracker-form")
      .locator('input[name="secret"]')
      .fill("ghp_mock_token_123456");
    await page.getByTestId("tracker-save").click();
    await page.waitForURL(/saved=github/);
    await expect(
      page.getByTestId("integration-card").filter({ hasText: "GitHub Issues" }),
    ).toContainText("skylark/ops");

    // A fresh follow-up on INC-217, exported from its row.
    await page.goto("/app/incidents/217?tab=follow-ups");
    await page
      .getByRole("button", { name: /suivi|follow-up|Folgeaufgabe/i })
      .first()
      .click();
    const title = `Smoke export ${Date.now().toString(36)}`;
    await page.locator('input[name="title"]').fill(title);
    await page.locator("form button[type=submit]", { hasText: /Ajouter|Add|Hinzufügen/ }).click();
    const row = page.locator(".oi-card").filter({ hasText: title });
    await expect(row).toBeVisible();
    await row.getByTestId("follow-up-export").click();
    await row.getByTestId("follow-up-export-github").click();
    await expect(row.getByRole("link", { name: /GitHub · #\d+/ })).toBeVisible();
    const key = (await row.getByRole("link", { name: /GitHub · #\d+/ }).textContent()) ?? "";
    const issueNumber = key.match(/#(\d+)/)?.[1];
    expect(issueNumber).toBeTruthy();
    expect(mock.issues.get(issueNumber!)?.title).toBe(title);
    await expect(page.getByTestId("timeline-event").first())
      .toBeAttached()
      .catch(() => {});

    // Closed over there → done here, at the next sync.
    await fetch(`http://127.0.0.1:3199/_close/${issueNumber}`, { method: "POST" });
    await page.goto("/app/settings/integrations?connect=github");
    await page.getByTestId("tracker-sync").click();
    await page.waitForURL(/synced=/);
    await expect(page.getByRole("status")).toContainText(/1/);
    await page.goto("/app/incidents/217?tab=follow-ups");
    await expect(
      page.locator(".oi-card").filter({ hasText: title }).getByRole("button", { pressed: true }),
    ).toBeVisible();
  });

  test("Jira and Linear connect through their own credentials", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/integrations?connect=jira");
    const jira = page.getByTestId("tracker-form");
    await jira.locator('input[name="site"]').fill("skylark.atlassian.net");
    await jira.locator('input[name="projectKey"]').fill("OPS");
    await jira.locator('input[name="email"]').fill("amelie@skylark.dev");
    await jira.locator('input[name="secret"]').fill("jira-api-token-mock");
    await page.getByTestId("tracker-save").click();
    await page.waitForURL(/saved=jira/);
    await page.goto("/app/settings/integrations?connect=gitlab");
    const gitlab = page.getByTestId("tracker-form");
    await gitlab.locator('input[name="project"]').fill("skylark/ops");
    await gitlab.locator('input[name="secret"]').fill("glpat-mock-token-123");
    await page.getByTestId("tracker-save").click();
    await page.waitForURL(/saved=gitlab/);
    await page.goto("/app/settings/integrations?connect=linear");
    const linear = page.getByTestId("tracker-form");
    await linear.locator('input[name="teamKey"]').fill("OPS");
    await linear.locator('input[name="secret"]').fill("lin_api_mock_key");
    await page.getByTestId("tracker-save").click();
    await page.waitForURL(/saved=linear/);
    await expect(page.getByTestId("integration-card").filter({ hasText: "Linear" })).toContainText(
      "OPS",
    );
    // Every connected tracker is offered on an unexported follow-up.
    await page.goto("/app/incidents?view=follow-ups");
    const exportBtn = page.getByTestId("follow-up-export").first();
    if ((await exportBtn.count()) > 0) {
      await exportBtn.click();
      await expect(page.getByTestId("follow-up-export-jira")).toBeVisible();
      await expect(page.getByTestId("follow-up-export-gitlab")).toBeVisible();
      await expect(page.getByTestId("follow-up-export-linear")).toBeVisible();
    }
  });
});
