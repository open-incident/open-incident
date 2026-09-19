import { expect, test } from "@playwright/test";
import { MEMBERS, signIn } from "./helpers";
import { startAiMock } from "./ai-mock";

/**
 * The post-mortem as a document: a section written in markdown with a live
 * preview, a section added, a comment left and resolved, the history that
 * restores an earlier version, the assistant's check against the facts, the
 * markdown export, and the dashboard that lists every document.
 */
test.describe("Post-mortem editor", () => {
  let mock: Awaited<ReturnType<typeof startAiMock>>;
  test.beforeAll(async () => {
    mock = await startAiMock();
  });
  test.afterAll(async () => {
    mock.server.close();
  });

  test("write, comment, review, restore, export, list", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    // INC-216 is closed: the document exists or starts here.
    await page.goto("/app/incidents/216?tab=post-incident");
    const start = page.getByTestId("pm-start");
    if ((await start.count()) > 0) await start.click();
    await expect(page.getByTestId("pm-document")).toBeVisible();

    // Markdown, previewed, saved, rendered.
    const section = page.getByTestId("pm-section-impact");
    await section.getByRole("button", { name: /Edit|Modifier|Bearbeiten/ }).click();
    await section
      .locator("textarea")
      .fill("**Smoke impact** on checkout\n\n- 4 % of attempts timed out\n- eu-west-1 only");
    await section.getByRole("button", { name: /Preview|Aperçu|Vorschau/ }).click();
    await expect(page.getByTestId("pm-preview").locator("strong")).toHaveText("Smoke impact");
    await section.getByRole("button", { name: /^(Save|Enregistrer|Speichern)$/ }).click();
    await expect(section.locator("strong")).toHaveText("Smoke impact");
    await expect(section.locator("li")).toHaveCount(2);

    // A section of the workspace's own.
    const add = page.getByTestId("pm-add-section");
    await add.locator("input[name=title]").fill("Smoke lessons");
    await add.getByRole("button").click();
    await expect(page.getByTestId("pm-section-smoke_lessons")).toBeVisible();
    // The contents rail is gone from the design; the section itself carries its
    // title, which is what the reader looks for.
    await expect(page.getByTestId("pm-section-smoke_lessons")).toContainText("Smoke lessons");

    // A comment, then resolved.
    await section.getByTestId("pm-comment-toggle").click();
    await section
      .getByTestId("pm-comment-form")
      .locator("textarea")
      .fill("Smoke comment: check the percentage.");
    await section.getByTestId("pm-comment-form").getByRole("button").click();
    // Comments live in the right drawer now; it has to be opened to be read.
    await page.getByTestId("pm-comments-toggle").click();
    await expect(page.getByTestId("pm-open-comments")).toContainText("Smoke comment");
    await section.getByRole("button", { name: /Resolve|Résoudre|Erledigen/ }).click();
    await expect(page.getByTestId("pm-open-comments")).not.toContainText("Smoke comment");

    // The history records every step and restores the earlier text.
    const history = page.getByTestId("pm-history");
    await expect(history).toContainText(/edited|a modifié|hat bearbeitet/);
    // The first "Restore" is the previous version: the impact written, the section not yet added.
    await history.getByTestId("pm-restore").first().click();
    await expect(history).toContainText(/restored|a restauré|wiederhergestellt/);

    // The assistant checks the draft against the facts: badges, nothing rewritten.
    await page.getByTestId("pm-review").click();
    await expect(page.getByTestId("pm-review-summary")).toBeVisible();
    await expect(page.getByTestId("pm-review-note").first()).toBeVisible();

    // Markdown, as a file.
    const md = await page.request.get("/app/incidents/216/post-mortem/markdown");
    expect(md.status()).toBe(200);
    expect(md.headers()["content-type"]).toContain("text/markdown");
    expect(await md.text()).toContain("# ");

    // The dashboard lists it.
    await page.goto("/app/post-mortems");
    await expect(page.getByTestId("pm-row").filter({ hasText: "INC-216" })).toBeVisible();
    await page.goto("/app/post-mortems?status=missing");
    await expect(page.getByTestId("pm-filters")).toBeVisible();
  });
});
