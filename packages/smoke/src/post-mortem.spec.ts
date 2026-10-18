import { expect, test } from "@playwright/test";
import { MEMBERS, signIn } from "./helpers";
import { startAiMock } from "./ai-mock";

/**
 * The post-mortem as a document: a section written in markdown with a live
 * preview, a section added, a comment left and resolved, the history that
 * restores an earlier version, the assistant's check against the facts, the
 * markdown export, and the dashboard that lists every document. Then the V2
 * document of INC-217: its three phases, the team's comments in the right-hand
 * panel, a decision added and read back from the timeline, the PDF view.
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

    // A section of the workspace's own — "+ Add a section" at the end of the document.
    await page.getByTestId("pm-add-section-open").click();
    const add = page.getByTestId("pm-add-section");
    await add.locator("input[name=title]").fill("Smoke lessons");
    await add.locator("button[type=submit]").click();
    await expect(page.getByTestId("pm-section-smoke_lessons")).toBeVisible();
    // The contents rail is gone from the design; the section itself carries its
    // title, which is what the reader looks for.
    await expect(page.getByTestId("pm-section-smoke_lessons")).toContainText("Smoke lessons");

    // A comment, then resolved. It shows under the section as soon as it is
    // posted — a note of the team, with who wrote it.
    await section.getByTestId("pm-comment-toggle").click();
    await section
      .getByTestId("pm-comment-form")
      .locator("textarea")
      .fill("Smoke comment: check the percentage.");
    await section.getByTestId("pm-comment-form").getByRole("button").click();
    await expect(section.getByTestId("pm-comments")).toContainText("Smoke comment");
    await expect(section.getByTestId("pm-comment-toggle")).toContainText("1");
    await section.getByRole("button", { name: /Resolve|Résoudre|Erledigen/ }).click();
    // The drawer's counter is the open ones; the resolved comment stays in the
    // list with its mark, and the count drops back to none.
    await expect(page.getByTestId("pm-comments-toggle")).toContainText(/\b0\b/);

    // The history records every step and restores the earlier text. It is
    // folded at the bottom of the comments panel.
    await page.getByTestId("pm-comments-toggle").click();
    await expect(page.getByTestId("pm-open-comments")).toContainText("Smoke comment");
    await page.getByTestId("pm-history-toggle").click();
    const history = page.getByTestId("pm-history");
    await expect(history).toContainText(/edited|a modifié|hat bearbeitet/);
    // The first "Restore" is the previous version: the impact written, the section not yet added.
    await history.getByTestId("pm-restore").first().click();
    await expect(history).toContainText(/restored|a restauré|wiederhergestellt/);

    // The assistant checks the draft against the facts: badges, nothing rewritten.
    // The drawer is closed first — it is fixed to the right and covers the
    // document's own actions while it is open.
    await page.getByTestId("pm-drawer-close").click();
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

  test("INC-217: phases, the team's comments, a decision, the PDF view", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/incidents/217?tab=post-incident");
    await expect(page.getByTestId("pm-document")).toBeVisible();
    // Documenting, reviewing, learning — each one opens its tasks.
    await expect(page.getByTestId("pm-phase")).toHaveCount(3);
    await page.getByTestId("pm-phase").last().locator("summary").click();
    await expect(page.getByTestId("pm-tasks").last()).toContainText(
      /Share the post-mortem|Partager le post-mortem|Post-Mortem teilen/,
    );
    await page.getByTestId("pm-phase").last().locator("summary").click();

    // The seeded comments of the team: under their sections, and all of them
    // in the panel with the section they are on.
    await expect(
      page.getByTestId("pm-section-root_cause").getByTestId("pm-comments"),
    ).toContainText("Karim Haddad");
    await page.getByTestId("pm-comments-toggle").click();
    const panel = page.getByTestId("pm-open-comments");
    await expect(panel).toContainText("Karim Haddad");
    await expect(panel).toContainText("Thomas Moreau");
    await expect(panel).toContainText("«");
    await page.getByTestId("pm-drawer-close").click();

    // A decision, written to the timeline and read back by the document.
    const decisions = page.getByTestId("pm-decisions");
    await expect(decisions.getByTestId("pm-decision").first()).toBeVisible();
    const before = await decisions.getByTestId("pm-decision").count();
    const title = `Smoke decision ${Date.now().toString(36)}`;
    await decisions.getByTestId("pm-decision-add").click();
    await decisions.locator('input[name="title"]').fill(title);
    await decisions.locator('input[name="why"]').fill("because the smoke says so");
    await decisions.locator("button[type=submit]").click();
    await expect(decisions.getByTestId("pm-decision")).toHaveCount(before + 1);
    await expect(decisions).toContainText(title);
    await page.goto("/app/incidents/217");
    await expect(page.getByTestId("timeline-event").filter({ hasText: title })).toContainText(
      /Decision|Décision|Entscheidung/,
    );

    // "Export PDF" is the document alone, without the team's comments.
    const pdf = await page.request.get("/app/incidents/217/post-mortem?print=1");
    expect(pdf.status()).toBe(200);
    const html = await pdf.text();
    expect(html).toContain(title);
    expect(html).not.toContain("faisons de l");
  });
});
