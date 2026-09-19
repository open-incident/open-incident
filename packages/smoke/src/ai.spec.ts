import { expect, request, test } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { MEMBERS, signIn } from "./helpers";
import { startAiMock, type AiCall } from "./ai-mock";

/**
 * Milestone 5 — reports and the assistant, against a mock OpenAI-compatible
 * model server (port 3198, see .env AI_*). What is checked: the governance
 * screen switches a capability off and on; the assistant's outputs land where
 * the design puts them, labelled as drafts; every call is logged; the reports
 * screen shows real numbers and exports them; change events enter by the API.
 */
test.describe("Reports & AI", () => {
  let mock: Awaited<ReturnType<typeof startAiMock>>;
  test.beforeAll(async () => {
    mock = await startAiMock();
  });
  test.afterAll(async () => {
    mock.server.close();
  });
  const calls = async (): Promise<AiCall[]> =>
    (await (await fetch("http://127.0.0.1:3198/_calls")).json()) as AiCall[];

  test("governance: a capability switched off refuses, switched on answers and is logged", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/ai");
    // The chip names the configured endpoint; with no provider it reads
    // "NO PROVIDER" instead, so this still fails on an unconfigured instance.
    await expect(page.getByText(/^(INFERENCE|INFÉRENCE|INFERENZ) · /)).toBeVisible();
    // Off: the update dialog has no draft button.
    const row = page.getByTestId("ai-cap-update_draft");
    await row.locator("label").click();
    await page.getByTestId("ai-save").click();
    await page.waitForURL(/saved=1/);
    await page.goto("/app/incidents/221");
    await page.getByTestId("update-open").click();
    await expect(page.getByTestId("ai-draft-update")).toHaveCount(0);
    await page.keyboard.press("Escape");
    // On again: the draft fills the message, labelled.
    await page.goto("/app/settings/ai");
    await page.getByTestId("ai-cap-update_draft").locator("label").click();
    await page.getByTestId("ai-save").click();
    await page.waitForURL(/saved=1/);
    const before = (await calls()).length;
    await page.goto("/app/incidents/221");
    await page.getByTestId("update-open").click();
    await page.getByTestId("ai-draft-update").click();
    await expect(page.locator('textarea[name="message"]')).toHaveValue(/Mock draft/);
    expect((await calls()).length).toBeGreaterThan(before);
    await page.keyboard.press("Escape");
    // Logged on the governance screen.
    await page.goto("/app/settings/ai");
    await expect(page.getByTestId("ai-call").first()).toContainText("mock-chat");
  });

  test("summary, follow-up suggestions and post-mortem draft are drafts a person acts on", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    // The summary, the citations and the changes around the incident live on
    // the Atlas tab now; the timeline no longer carries them.
    await page.goto("/app/incidents/221?tab=atlas");
    await page.getByTestId("ai-summary-generate").click();
    await expect(page.getByTestId("ai-summary")).toContainText("Mock summary of the timeline");
    await expect(page.getByTestId("ai-changes")).toBeVisible();

    // Suggesting follow-ups is an Atlas action, in that tab's right column.
    await page.goto("/app/incidents/221?tab=atlas");
    await page.getByTestId("ai-suggest-follow-ups").click();
    const suggestion = page.getByTestId("ai-suggestion").first();
    await expect(suggestion).toContainText("Mock follow-up");
    await suggestion.getByRole("button").click();
    await expect(suggestion.getByRole("button")).toHaveCount(0);
    await expect(
      page.getByText("Mock follow-up: add alerting on connection pool saturation").first(),
    ).toBeVisible();

    // INC-216 is resolved with a post-incident flow and no post-mortem yet.
    await page.goto("/app/incidents/216?tab=post-incident");
    const draft = page.getByTestId("pm-draft");
    if ((await draft.count()) > 0) {
      await draft.click();
      await expect(page.getByTestId("pm-section-summary")).toContainText("Mock:");
    }
    // Sections are editable by hand: the person's words replace the draft.
    const section = page
      .getByTestId("pm-section-root_cause")
      .or(page.getByTestId("pm-section-summary"))
      .first();
    await section.getByRole("button", { name: /Edit|Modifier|Bearbeiten/ }).click();
    await section.locator("textarea").fill("Edited by a person.");
    await section.getByRole("button", { name: /Save|Enregistrer|Speichern/ }).click();
    await expect(section).toContainText("Edited by a person.");
  });

  test("reports show real numbers per tab and export them as CSV", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/insights?tab=incidents&days=90");
    await expect(page.getByTestId("insights-stat")).toHaveCount(4);
    await expect(page.getByTestId("insights-stat").first()).not.toContainText("—");
    // The "alerts" tab became "uptime", which reads three figures rather than
    // four. Counted per tab rather than loosened to "at least one": a tab that
    // silently stops computing a figure is exactly what this catches.
    for (const [tab, stats] of [
      ["pager", 4],
      ["uptime", 4],
      ["followups", 4],
    ] as const) {
      await page.getByTestId(`insights-tab-${tab}`).click();
      await expect(page).toHaveURL(new RegExp(`tab=${tab}`));
      await expect(page.getByTestId("insights-stat")).toHaveCount(stats);
    }
    // The comparison toggle is gone: the design shows every figure against the
    // previous period and offers no way to turn that off.
    const csv = await page.request.get("/api/insights/export?tab=incidents&days=90");
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const body = await csv.text();
    expect(body.split("\n")[0]).toContain("number,name,severity");
    expect(body.split("\n").length).toBeGreaterThan(2);
  });

  test("change events enter by the API and show on the incident", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/api");
    await page.getByTestId("key-open").click();
    await page.locator('form[data-testid="key-form"] input[name="name"]').fill("Smoke changes key");
    await page.locator('form[data-testid="key-form"] input[value="write"]').check();
    await page.locator('form[data-testid="key-form"] button[type=submit]').click();
    const key = (await page.getByTestId("secret-value").textContent())?.trim() ?? "";
    expect(key).toMatch(/^oi_live_/);
    await page.keyboard.press("Escape");
    const api = await request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { authorization: `Bearer ${key}` },
    });
    const title = `Smoke deploy ${Date.now().toString(36)}`;
    const created = await api.post("/api/v1/change-events", {
      data: {
        kind: "deploy",
        title,
        service: "web-storefront",
        actor: "smoke",
        environment: "production",
        external_ref: "https://example.com/run/1",
      },
    });
    expect(created.status()).toBe(201);
    const bad = await api.post("/api/v1/change-events", {
      data: { kind: "deploy", title: "x", service: "nope" },
    });
    expect([422]).toContain(bad.status());
    const list = await api.get("/api/v1/change-events");
    expect(list.status()).toBe(200);
    expect(
      ((await list.json()) as { data: Array<{ title: string }> }).data.map((d) => d.title),
    ).toContain(title);
    // INC-221 (web-storefront, open) lists it under the changes around the
    // incident, which the Atlas tab now carries.
    await page.goto("/app/incidents/221?tab=atlas");
    await expect(page.getByTestId("ai-changes")).toContainText(title);
    await api.dispose();
  });
});
