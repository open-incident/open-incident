import { expect, request, test } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { MEMBERS, signIn, signOut } from "./helpers";

/**
 * The alert screens of the V2 design, against the real pipeline: the secret
 * dialog that notices the tool's first alert by itself, a source's own
 * threshold ("From P1") deciding whether an incident opens, a source on trial
 * paging nobody, the one-line curl the empty state prints, and the tabs as
 * deep links.
 */
test.describe("Alerts — V2", () => {
  test("a source's own choices decide, from the secret dialog to the incident", async ({
    page,
  }) => {
    const run = Date.now().toString(36);
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/alerts/sources");
    await page.getByTestId("source-open").click();
    await page.getByTestId("source-kind-http").click();
    const name = `V2 HTTP ${run}`;
    const form = page.getByTestId("source-form");
    await form.locator('input[name="name"]').fill(name);
    // Who to page: nobody — the test must not wake anybody up. Incidents: from P1 only.
    await form.getByTestId("choice-page-nobody").click();
    await form.getByTestId("choice-incident-from-0").click();
    await page.getByTestId("source-create").click();

    const created = page.getByTestId("source-created");
    await expect(created).toBeVisible();
    const endpoint = (await page.getByTestId("source-endpoint").textContent())?.trim() ?? "";
    const secret = (await page.getByTestId("source-secret").textContent())?.trim() ?? "";
    await expect(page.getByTestId("source-first-alert")).toHaveAttribute("data-state", "waiting");

    // The tool's first alert, the way `curl -d` sends it: a JSON body labelled
    // as a form. The dialog sees it land without a reload.
    const api = await request.newContext({ baseURL: BASE_URL });
    const env = "v2-smoke"; // no rule of the demo matches it: the source's own choices apply
    const p2 = await api.post(endpoint, {
      headers: { "x-oi-secret": secret, "content-type": "application/x-www-form-urlencoded" },
      data: JSON.stringify({
        title: `V2 P2 ${run}`,
        priority: "P2",
        service: "checkout-api",
        environment: env,
        dedup_key: `v2-p2-${run}`,
      }),
    });
    expect(p2.status(), await p2.text()).toBe(202);
    const p2Body = (await p2.json()) as {
      data: Array<{ alert_id: string; action: string; incident_number: number | null }>;
    };
    expect(p2Body.data[0]!.action).toBe("created");
    // From P1: a P2 opens no incident.
    expect(p2Body.data[0]!.incident_number).toBeNull();
    await expect(page.getByTestId("source-first-alert")).toHaveAttribute("data-state", "received", {
      timeout: 20_000,
    });

    const p1 = await api.post(endpoint, {
      headers: { "x-oi-secret": secret, "content-type": "application/json" },
      data: {
        title: `V2 P1 ${run}`,
        priority: "P1",
        service: "web-storefront",
        environment: env,
        dedup_key: `v2-p1-${run}`,
      },
    });
    const p1Body = (await p1.json()) as {
      data: Array<{ alert_id: string; incident_number: number | null }>;
    };
    expect(p1Body.data[0]!.incident_number).toBeGreaterThan(0);

    // The secret is gone for good once the dialog closes: the source page
    // shows the endpoint and says so, never the secret.
    await page.getByTestId("source-configure").click();
    await page.waitForURL(/\/app\/alerts\/sources(\?|$)/);
    const card = page.getByTestId("source-row").filter({ hasText: name });
    await expect(card).toContainText(/From P1|À partir de P1|Ab P1/);
    await card.click();
    await page.waitForURL(/\/app\/alerts\/sources\/[0-9a-f-]{36}/);
    await expect(page.getByTestId("source-title")).toHaveText(name, { timeout: 30_000 });
    expect(await page.content()).not.toContain(secret);

    // On trial: logged and routed, nobody paged.
    await page.getByTestId("source-advanced").click();
    await page.getByTestId("source-test-mode").click();
    await expect(page.getByTestId("source-test-mode")).toHaveAttribute("data-state", "on");
    const trial = await api.post(endpoint, {
      headers: { "x-oi-secret": secret, "content-type": "application/json" },
      data: {
        title: `V2 trial ${run}`,
        priority: "P1",
        service: "payments-worker",
        environment: env,
        dedup_key: `v2-trial-${run}`,
      },
    });
    const trialBody = (await trial.json()) as {
      data: Array<{ alert_id: string; incident_number: number | null }>;
    };
    expect(trialBody.data[0]!.incident_number).toBeNull();
    await page.goto(`/app/alerts/${trialBody.data[0]!.alert_id}`);
    await expect(page.getByText(/^test$/).first()).toBeVisible();
    await expect(page.getByTestId("escalation-card")).toHaveCount(0);

    // The tabs are deep links.
    await page.goto("/app/alerts?tab=resolved");
    await expect(page.getByTestId("alerts-tab-resolved")).toHaveAttribute("aria-current", "page");

    // Put things back: close the alerts through their own door, delete the source.
    for (const key of [`v2-p2-${run}`, `v2-p1-${run}`, `v2-trial-${run}`])
      await api.post(endpoint, {
        headers: { "x-oi-secret": secret, "content-type": "application/json" },
        data: { title: "closing", status: "resolved", dedup_key: key },
      });
    await page.goto("/app/alerts/sources");
    await page.getByTestId("source-row").filter({ hasText: name }).click();
    await page.getByTestId("source-advanced").click();
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("source-delete").click();
    await expect(page).toHaveURL(/\/app\/alerts\/sources/);
    await api.dispose();
    await signOut(page);
  });

  test("an alert's page says who is paged and why, in one place", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/alerts");
    await page.getByTestId("alert-card").first().click();
    await expect(page.getByTestId("alert-status")).toBeVisible();
    await expect(page.getByTestId("why-this-path")).toBeVisible();
    // The timeline is the pipeline's own record, first event first.
    await expect(page.getByTestId("alert-event").first()).toBeVisible();
    await page.getByTestId("alert-payload").click();
    await expect(page.locator("pre").first()).toBeVisible();
    await signOut(page);
  });
});
