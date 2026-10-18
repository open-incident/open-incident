import { expect, test } from "@playwright/test";
import { MEMBERS, signIn, signOut } from "./helpers";

/**
 * The incident journey on the demo workspace: the list shows the reference
 * incident, the detail shows its timeline, a status update really lands in
 * it, a declaration creates a numbered incident. Then the V2 screens: Atlas's
 * review tab first in the list, the timeline's "✦ By Atlas" filter, the
 * CHANNELS card, the note posted with Enter, the severity changed where it is
 * read, and the update drawer's "Send to" switches.
 */
test.describe("Incidents", () => {
  test("INC-217 opens with its timeline and follow-ups", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/incidents/217");
    await expect(page.getByRole("heading", { name: /Pic de latence checkout/ })).toBeVisible();
    await expect(page.getByText("Post-mortem", { exact: false }).first()).toBeVisible();
    await expect(page.getByTestId("timeline-event").first()).toBeVisible();
    await signOut(page);
  });

  test("declaring an incident creates INC-222 and posting an update extends its timeline", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.responder);
    await page.goto("/app/incidents/new");
    const title = `[smoke ${new Date().toISOString().slice(11, 19)}] Latence API`;
    await page.locator('input[name="name"]').fill(title);
    // The default type requires the affected service and the region: pick the first of each.
    // The declaration form picks from the services the workspace has observed.
    await page.locator('select[name="serviceId"]').selectOption({ index: 1 });
    await page.locator('select[name="field.region"]').selectOption({ index: 1 });
    await page.locator('form[data-testid="declare-form"] button[type=submit]').click();
    await page.waitForURL(/\/app\/incidents\/\d+$/);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    // Counted on the update rows rather than on every row: declaring also
    // starts the root cause analysis, which writes its own entry when it lands,
    // and that arrival is not what this test is about.
    const updates = page.locator('[data-testid="timeline-event"][data-kind="update"]');
    const before = await updates.count();
    await page.getByTestId("update-open").click();
    await page.locator('textarea[name="message"]').fill("Smoke update — investigating.");
    await page.locator('form[data-testid="update-form"] button[type=submit]').click();
    await expect(updates).toHaveCount(before + 1);
    await expect(page.getByText("Smoke update — investigating.")).toBeVisible();
    await signOut(page);
  });

  test("a viewer sees incidents but cannot declare", async ({ page }) => {
    await signIn(page, MEMBERS.viewer);
    // "All" is the tab that carries every phase, INC-217 included.
    await page.goto("/app/incidents?tab=all");
    await expect(page.getByText("INC-217")).toBeVisible();
    await expect(page.getByTestId("declare-open")).toHaveCount(0);
    const res = await page.request.get("/app/incidents/new", {
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    expect([302, 303, 307, 403]).toContain(res.status());
    await signOut(page);
  });

  test("the list opens on Atlas's review tab by its address, with no banner above the rows", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/incidents?tab=atlas");
    await expect(
      page.getByRole("link", { name: /Resolved by Atlas|Résolus par Atlas|Von Atlas gelöst/ }),
    ).toHaveAttribute("aria-current", "page");
    await page.goto("/app/incidents");
    await expect(page.getByTestId("incident-row").first()).toBeVisible();
    await expect(page.getByTestId("announcement")).toHaveCount(0);
    await signOut(page);
  });

  test("INC-217: what Atlas did is filtered in the timeline; the channels card says where chat stands", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/incidents/217");
    const events = page.getByTestId("timeline-event");
    await expect(events.first()).toBeVisible();
    const all = await events.count();
    await page.getByTestId("timeline-filter-atlas").click();
    const atlas = page.locator('[data-testid="timeline-event"][data-atlas="1"]');
    const shown = await atlas.count();
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(all);
    await expect(
      page.locator('[data-testid="timeline-event"]:not([data-atlas="1"])').first(),
    ).toBeHidden();
    await page.getByTestId("timeline-filter-all").click();
    await expect(events.first()).toBeVisible();

    const channels = page.getByTestId("incident-channels");
    await expect(channels).toBeVisible();
    await expect(
      channels.getByRole("link", { name: /Settings|Réglages|Einstellungen/ }),
    ).toHaveAttribute("href", "/app/settings/chat");
    await signOut(page);
  });

  test("a note posts with Enter, the severity changes from the facts card, the drawer says where an update goes", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.responder);
    await page.goto("/app/incidents/221");
    const note = `Smoke note ${Date.now().toString(36)}`;
    await page.getByTestId("timeline-note").locator('input[name="message"]').fill(note);
    await page.getByTestId("timeline-note").locator('input[name="message"]').press("Enter");
    await expect(page.getByTestId("timeline-event").filter({ hasText: note })).toBeVisible();

    const picker = page.getByTestId("severity-picker");
    const before = await picker.inputValue();
    const options = await picker
      .locator("option")
      .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    const next = options.find((v) => v && v !== before)!;
    await picker.selectOption(next);
    await expect(async () => {
      await page.reload();
      expect(await page.getByTestId("severity-picker").inputValue()).toBe(next);
    }).toPass({ timeout: 20_000 });
    // Put it back, so the rest of the suite reads the demo as it was.
    await page.getByTestId("severity-picker").selectOption(before);

    await page.getByTestId("resolve-open").click();
    const drawer = page.getByTestId("update-form");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("radio", { name: /Resolved|Résolu|Gelöst/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(drawer.getByTestId("update-subscribers-toggle")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await signOut(page);
  });
});
