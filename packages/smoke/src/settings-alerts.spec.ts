import { expect, test } from "@playwright/test";
import { MEMBERS, signIn } from "./helpers";

/**
 * Settings › Alerts (design V2): Rules, Alert severities, Labels.
 *
 * A rule is written in the design's dialog with an Atlas directive, moved in
 * the order — from the keyboard and by dragging — and the whole set replayed
 * on the last alerts; a severity level is edited and put back; the labels
 * list says what the alerts carry, which key ties them to services and which
 * one the redaction before Atlas rewrites. Everything is real and everything
 * the run writes is undone before it ends.
 */
test.describe("Settings › Alerts", () => {
  test("rules: a sentence with an Atlas directive, moved, previewed, deleted", async ({ page }) => {
    const run = Date.now().toString(36);
    const service = `smoke-${run}`;
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/rules");
    const rows = page.getByTestId("route-row");
    await expect(rows.first()).toBeVisible();
    const before = await rows.count();

    // New rule: "If severity is P1 and label service = smoke-… → ✦ never let Atlas act".
    await page.getByTestId("rule-new").click();
    const dialog = page.getByTestId("rule-new-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("rule-severity").selectOption({ index: 1 });
    await dialog.getByTestId("rule-label").fill(`service = ${service}`);
    await dialog.getByTestId("rule-then").selectOption("atlas:never");
    await page.getByTestId("rule-new-dialog-submit").click();
    await expect(dialog).toHaveCount(0);
    await expect(rows).toHaveCount(before + 1);
    const mine = rows.filter({ hasText: service });
    await expect(mine.getByTestId("rule-sentence")).toContainText(service);
    await expect(mine.getByTestId("rule-atlas")).toBeVisible();
    await expect(mine.getByTestId("rule-atlas")).toContainText("✦");
    // "Add at the end": the last rule.
    await expect(mine.getByTestId("rule-handle")).toHaveText(String(before + 1));

    // Edited in the same dialog: the directive turns into "let Atlas handle it".
    await mine.getByTestId("rule-edit").click();
    const edit = page.getByTestId("rule-edit-dialog");
    await expect(edit.getByTestId("rule-label")).toHaveValue(`service = ${service}`);
    await edit.getByTestId("rule-then").selectOption("atlas:handle");
    await page.getByTestId("rule-edit-dialog-submit").click();
    await expect(edit).toHaveCount(0);
    await expect(mine.getByTestId("rule-atlas")).toBeVisible();

    // One place up from the keyboard, then to the top by dragging — real positions.
    // The edit's toast first goes, so the next one is the move's.
    await expect(page.getByTestId("settings-toast")).toHaveCount(0, { timeout: 10_000 });
    await mine.getByTestId("rule-handle").focus();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId("settings-toast")).toBeVisible();
    await page.reload();
    await expect(mine.getByTestId("rule-handle")).toHaveText(String(before));
    if (before > 1) {
      await mine.getByTestId("rule-handle").dragTo(rows.first().getByTestId("rule-handle"));
      await expect(page.getByTestId("settings-toast")).toBeVisible();
      await page.reload();
      await expect(mine.getByTestId("rule-handle")).toHaveText("1");
    }

    // The rules as they stand, replayed on the last alerts — the answer in a toast.
    await page.getByTestId("rules-preview").click();
    await expect(page.getByTestId("settings-toast")).toContainText(/\d/);

    // Deleted from its own page ("More options…"), after a confirmation.
    const id = await mine.getAttribute("data-rule-id");
    await page.goto(`/app/settings/rules/${id}`);
    await expect(page.getByTestId("route-form")).toBeVisible();
    await page.getByTestId("rule-delete").click();
    await page.getByTestId("rule-delete-dialog-submit").click();
    await expect(page).toHaveURL(/\/app\/settings\/rules(\?|$)/);
    await expect(rows).toHaveCount(before);
  });

  test("alert severities: the levels, one edited and put back", async ({ page }) => {
    const run = Date.now().toString(36);
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/alert-severities");
    const rows = page.getByTestId("priority-row");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThanOrEqual(2);
    const first = rows.first();

    await first.getByTestId("severity-edit").click();
    const dialog = page.getByTestId("severity-dialog");
    const description = dialog.getByTestId("severity-description");
    const was = await description.inputValue();
    await description.fill(`Critical ${run}`);
    await page.getByTestId("severity-dialog-submit").click();
    await expect(dialog).toHaveCount(0);
    await expect(first).toContainText(`Critical ${run}`);

    await first.getByTestId("severity-edit").click();
    await dialog.getByTestId("severity-description").fill(was);
    await page.getByTestId("severity-dialog-submit").click();
    await expect(dialog).toHaveCount(0);
    await expect(first).not.toContainText(run);
  });

  test("labels: what the alerts carry, what ties them to services, what Atlas never reads", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/labels");
    const rows = page.getByTestId("label-row");
    await expect(rows.first()).toBeVisible();
    const service = page.locator('[data-testid="label-row"][data-key="service"]');
    await expect(service.getByTestId("label-services")).toBeVisible();
    // The demo's customer contacts are email addresses: redacted before any model call.
    const customer = page.locator('[data-testid="label-row"][data-key="customer"]');
    await expect(customer.getByTestId("label-redacted")).toBeVisible();
    // The pipeline's own bookkeeping is not a label.
    await expect(page.locator('[data-testid="label-row"][data-key="source_name"]')).toHaveCount(0);

    // A row opens how the pipeline reads the key.
    await service.click();
    const dialog = page.getByTestId("label-dialog");
    await expect(dialog.getByTestId("label-kind")).toHaveValue("service");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
});
