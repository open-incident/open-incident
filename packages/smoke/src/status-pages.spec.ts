import { expect, request, test } from "@playwright/test";
import { MAILPIT_URL, STATUS_BASE_URL } from "../playwright.config";
import { MEMBERS, signIn, signOut } from "./helpers";

/**
 * Status pages, end to end: the admin screen shows the demo page; the public
 * app (a separate server reading snapshots) renders it with its components,
 * uptime and past incident; a visitor subscribes with double opt-in; the feeds
 * answer; an update published from an incident appears on the public page.
 */
test.describe("Status pages", () => {
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");

  test("the public page serves the snapshot, subscriptions and feeds", async ({ page }) => {
    await page.goto(STATUS_BASE_URL);
    await expect(page.getByText("Skylark Status").first()).toBeVisible();
    await expect(page.getByTestId("overall")).toBeVisible();
    await expect(page.getByTestId("components").getByText("Checkout")).toBeVisible();
    await expect(page.getByText("Performance dégradée du checkout")).toBeVisible();
    // Feeds
    const api = await request.newContext();
    const rss = await api.get(`${STATUS_BASE_URL}/rss.xml`);
    expect(rss.status()).toBe(200);
    expect(await rss.text()).toContain("<rss");
    expect((await api.get(`${STATUS_BASE_URL}/atom.xml`)).status()).toBe(200);
    /*
     * An unknown host is a 404, never a page.
     *
     * Derived from the base URL rather than written out: the same suite runs
     * against `next start` in the clear and against the production topology
     * behind Caddy, and a literal `http://…:3107` answers 400 on the second
     * one — the TLS terminator rejecting a plaintext request, which says
     * nothing about what the status app does with a host it does not know.
     */
    const unknownHost = STATUS_BASE_URL.replace(/\/\/[^./]+\./, "//nobody.");
    expect((await api.get(unknownHost)).status()).toBe(404);
    // Subscribe → confirmation email → confirmed.
    const email = `visitor.${stamp}@example.com`;
    const since = Date.now();
    await page.getByTestId("subscribe-open").click();
    await page.locator('form[data-testid="subscribe-form"] input[name="email"]').fill(email);
    await page.locator('form[data-testid="subscribe-form"] button[type=submit]').click();
    await expect(page.getByTestId("subscribed")).toBeVisible();
    let link = "";
    await expect(async () => {
      const res = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=30`);
      const { messages } = (await res.json()) as {
        messages: Array<{ ID: string; To: Array<{ Address: string }>; Created: string }>;
      };
      const hit = messages.find(
        (m) =>
          m.To.some((x) => x.Address === email) && new Date(m.Created).getTime() >= since - 5_000,
      );
      expect(hit).toBeTruthy();
      const body = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${hit!.ID}`)).json()) as {
        Text: string;
      };
      link = /https?:\/\/\S+\/confirm\/[a-f0-9]+/.exec(body.Text)?.[0] ?? "";
      expect(link).toBeTruthy();
    }).toPass({ timeout: 60_000 });
    await page.goto(link);
    await expect(page.getByTestId("confirmed")).toBeVisible();
    await api.dispose();
  });

  test("the admin screen edits components and schedules a maintenance", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/status-pages");
    await expect(page.getByRole("heading", { name: "Skylark Status" })).toBeVisible();
    expect(await page.getByTestId("component-row").count()).toBeGreaterThanOrEqual(5);
    await expect(
      page.getByTestId("public-incident").filter({ hasText: "Performance dégradée du checkout" }),
    ).toBeVisible();
    await page.getByTestId("component-new").click();
    const name = `Smoke component ${stamp}`;
    await page.locator('form[data-testid="component-form"] input[name="name"]').fill(name);
    await page.locator('form[data-testid="component-form"] button[type=submit]').click();
    await expect(page.getByTestId("component-row").filter({ hasText: name })).toBeVisible();
    // The public page sees it at once — the snapshot was rewritten.
    await page.goto(STATUS_BASE_URL);
    await expect(page.getByTestId("components").getByText(name)).toBeVisible();
    await page.goto("/app/status-pages");
    await page
      .getByTestId("component-row")
      .filter({ hasText: name })
      .getByRole("button", { name: /^✕$|Supprimer|Delete|Löschen/ })
      .click();
    await expect(page.getByTestId("component-row").filter({ hasText: name })).toHaveCount(0);
    // Maintenance
    await page.getByTestId("maintenance-open").click();
    const title = `Smoke maintenance ${stamp}`;
    await page.locator('form[data-testid="maintenance-form"] input[name="title"]').fill(title);
    const start = new Date(Date.now() + 2 * 3_600_000);
    const end = new Date(Date.now() + 3 * 3_600_000);
    const local = (d: Date) =>
      new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await page
      .locator('form[data-testid="maintenance-form"] input[type="datetime-local"]')
      .nth(0)
      .fill(local(start));
    await page
      .locator('form[data-testid="maintenance-form"] input[type="datetime-local"]')
      .nth(1)
      .fill(local(end));
    await page
      .locator('form[data-testid="maintenance-form"] input[name="componentIds"]')
      .first()
      .check();
    await page.locator('form[data-testid="maintenance-form"] button[type=submit]').click();
    await expect(page.getByTestId("maintenance-row").filter({ hasText: title })).toBeVisible();
    await page
      .getByTestId("maintenance-row")
      .filter({ hasText: title })
      .getByRole("button", { name: /Annuler|Cancel|Abbrechen/ })
      .click();
    await signOut(page);
  });

  test("an update published from an incident reaches the public page", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    // INC-220 is SEV2 and active: eligible for publication.
    await page.goto("/app/incidents/220");
    await expect(page.getByTestId("status-page-section")).toBeVisible();
    await page.getByTestId("update-open").click();
    const message = `Public update ${stamp} — mitigation in progress.`;
    await page.locator('textarea[name="message"]').fill(message);
    const toggle = page.getByTestId("update-status-page-toggle");
    await expect(toggle).toBeVisible();
    if ((await toggle.locator('input[name="statusPage"]').getAttribute("value")) !== "on")
      await toggle.click();
    await page.locator('form[data-testid="update-form"] button[type=submit]').click();
    await expect(page.getByText(message)).toBeVisible();
    await expect(
      page.getByTestId("status-page-section").getByText(/Publié|Published|Veröffentlicht/),
    ).toBeVisible();
    // The timeline shows the update over SSE before the action has finished
    // publishing; the public page is polled until the snapshot carries it.
    await expect(async () => {
      await page.goto(STATUS_BASE_URL);
      await expect(page.getByText(message)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await signOut(page);
  });

  /**
   * A published update goes out with the words it had. Correcting one changes
   * the page and says it was changed — and does not email 150 people a second
   * time to tell them the service was called api-gateway, not checkout.
   */
  test("a published update can be corrected, and the page says so", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/status-pages");
    const updates = page.getByTestId("public-updates").first();
    await expect(updates).toBeVisible();
    await updates.locator("summary").click();
    const form = page.getByTestId("update-form").first();
    const corrected = `Corrected at ${stamp} — the affected service was api-gateway.`;
    await form.locator("textarea").fill(corrected);
    await form.getByTestId("correct-update").click();
    await page.waitForURL(/corrected=1/);
    // The admin screen carries the mark, and so does the public page.
    await expect(page.getByText(/corrected|corrigé|korrigiert/).first()).toBeVisible();
    /*
     * On the public page an ongoing incident shows its updates outright and a
     * past one keeps them behind its entry, so both are tried: which of the
     * two this update belongs to depends on the incident it was published
     * from, and the correction has to be visible either way.
     */
    await expect(async () => {
      await page.goto(STATUS_BASE_URL);
      if (!(await page.getByText(corrected).count())) {
        const history = page.getByTestId("history-item");
        for (let i = 0; i < (await history.count()); i++) await history.nth(i).click();
      }
      await expect(page.getByText(corrected).first()).toBeVisible({ timeout: 2_000 });
      await expect(page.getByText(/corrected|corrigé|korrigiert/).first()).toBeVisible({
        timeout: 2_000,
      });
    }).toPass({ timeout: 30_000 });
    await signOut(page);
  });

  /**
   * A window that has not started can move. It used to take a cancellation and
   * a new maintenance, which tells every subscriber two things about one event.
   */
  test("a scheduled maintenance can be moved", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/status-pages");
    await page.getByTestId("maintenance-open").click();
    const title = `Smoke move ${stamp}`;
    const local = (d: Date) =>
      new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    const create = page.getByTestId("maintenance-form");
    await create.locator('input[name="title"]').fill(title);
    await create
      .locator('input[type="datetime-local"]')
      .nth(0)
      .fill(local(new Date(Date.now() + 2 * 3_600_000)));
    await create
      .locator('input[type="datetime-local"]')
      .nth(1)
      .fill(local(new Date(Date.now() + 3 * 3_600_000)));
    await create.locator("button[type=submit]").click();
    const row = page.getByTestId("maintenance-row").filter({ hasText: title });
    await expect(row).toBeVisible();

    await row.getByTestId("maintenance-edit").click();
    const edit = page.getByTestId("maintenance-edit-form");
    await expect(edit).toBeVisible();
    // The form arrives filled: an editor that opens empty rewrites by accident.
    expect(await edit.locator('input[name="title"]').inputValue()).toBe(title);
    const moved = new Date(Date.now() + 48 * 3_600_000);
    await edit.locator('input[type="datetime-local"]').nth(0).fill(local(moved));
    await edit
      .locator('input[type="datetime-local"]')
      .nth(1)
      .fill(local(new Date(moved.getTime() + 3_600_000)));
    await edit.locator("button[type=submit]").click();
    await page.waitForURL(/maintenance=edited/);
    const day = String(moved.getDate()).padStart(2, "0");
    await expect(
      page.getByTestId("maintenance-row").filter({ hasText: title }).first(),
    ).toContainText(day);

    // Cancel it so the demo workspace is left as it was found.
    await page
      .getByTestId("maintenance-row")
      .filter({ hasText: title })
      .getByRole("button", { name: /Annuler|Cancel|Abbrechen/ })
      .click();
    await signOut(page);
  });
});
