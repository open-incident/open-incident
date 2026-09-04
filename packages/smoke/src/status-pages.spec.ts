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
    // An unknown host is a 404, never a page.
    expect((await api.get(`http://nobody.status.localhost:3107/`)).status()).toBe(404);
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
    }).toPass({ timeout: 20_000 });
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
      .getByRole("button")
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
});
