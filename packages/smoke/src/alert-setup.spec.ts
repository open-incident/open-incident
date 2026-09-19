import { expect, request, test } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { MEMBERS, signIn } from "./helpers";

/**
 * From nothing to "an alert paged someone" through the setup screen: one click
 * names who gets paged, a source is created from the tool grid, its page maps
 * attributes against a real payload and previews the routing, a route is
 * edited on its own page and previewed against recent alerts, and a payload
 * posted to the endpoint is routed, pages, and opens a triage incident.
 */
/** The delete button of a row, in the three languages the suite may run in. */
const DELETE = /^Supprimer$|^Delete$|^Löschen$/;

test.describe("Alert configuration", () => {
  test("the four steps, a source page, a route page, and a real alert through it all", async ({
    page,
  }) => {
    // The keys this run fires under, so the end of it can close them: an alert
    // left firing groups the next run's into itself, and the run that made it
    // is the one that has to clear it.
    const run = Date.now().toString(36);
    const testKey = `setup-test-${run}`;
    const realKey = `setup-real-${run}`;
    await signIn(page, MEMBERS.owner);

    // The hub and its checklist.
    // The demo workspace is already set up, so the steps hide until asked for.
    await page.goto("/app/settings/alerting?setup=1");
    await expect(page.getByTestId("setup-checklist")).toBeVisible();
    // It already pages through its routes; the step reads as done.
    await expect(page.getByTestId("setup-step-pager")).toHaveAttribute("data-done", "1");

    // A source from the tool grid, in three steps.
    await page.goto("/app/settings/alert-sources?new=1");
    await page.getByTestId("source-kind-http").click();
    const name = `Setup HTTP ${Date.now().toString(36)}`;
    await page.locator('[data-testid="source-form"] input[name="name"]').fill(name);
    await page.getByTestId("source-create").click();
    await expect(page.getByTestId("source-created")).toBeVisible();
    const endpoint = (await page.getByTestId("source-endpoint").textContent())?.trim() ?? "";
    const secret = (await page.getByTestId("source-secret").textContent())?.trim() ?? "";
    expect(endpoint).toMatch(/\/api\/ingest\/alerts\/[0-9a-f-]{36}$/);
    await page.getByTestId("source-configure").click();
    await expect(page.getByTestId("source-title")).toHaveText(name);
    const sourceUrl = page.url();
    await expect(page.getByTestId("source-waiting")).toHaveAttribute("data-state", "waiting");

    // The tester says what a payload would do before anything is sent. It
    // lives behind the source's "advanced" disclosure now.
    await page.getByTestId("source-advanced").click();
    const tester = page.getByTestId("payload-tester");
    await tester.locator("textarea").fill(
      JSON.stringify({
        title: "Setup: checkout latency",
        status: "firing",
        priority: "critical",
        service: "web-storefront",
        environment: "production",
        dedup_key: testKey,
      }),
    );
    await page.getByTestId("tester-preview").click();
    const plan = page.getByTestId("tester-plan").first();
    await expect(plan).toBeVisible();
    // "critical" is an alias of P1; production goes through the production route and pages.
    await expect(plan).toContainText("P1");
    await expect(plan).toContainText("Production alerts");

    // Mapping rows preview against the sample once one exists: send the payload as a test alert.
    await page.getByTestId("tester-send-test").click();
    await expect(tester.getByRole("status")).toContainText(/created|grouped|deduplicated/);
    await page.reload();
    await expect(page.getByTestId("source-waiting")).toHaveAttribute("data-state", "received");
    // The reload closed the advanced disclosure the mapping rows live in.
    await page.getByTestId("source-advanced").click();
    await expect(page.getByTestId("mapping-preview").first()).toBeVisible();

    // The real thing: posted to the endpoint with the secret, routed and paging.
    const api = await request.newContext({ baseURL: BASE_URL });
    const res = await api.post(endpoint, {
      headers: { "x-oi-secret": secret, "content-type": "application/json" },
      data: {
        title: "Setup: checkout 5xx",
        status: "firing",
        priority: "P1",
        service: "web-storefront",
        environment: "production",
        dedup_key: realKey,
      },
    });
    expect(res.status(), await res.text()).toBe(202);
    const body = (await res.json()) as {
      data: Array<{ alert_id: string; action: string; incident_number: number | null }>;
    };
    expect(body.data[0]?.action).toBe("created");
    await page.goto(`/app/alerts/${body.data[0]!.alert_id}`);
    await expect(page.getByTestId("escalation-card")).toBeVisible();
    await expect(page.getByTestId("alert-notes")).toBeVisible();
    await page
      .getByTestId("alert-note-form")
      .locator("textarea")
      .fill("Setup smoke: checked the deploy, rolled back.");
    await page.getByTestId("alert-note-form").getByRole("button").click();
    await expect(page.getByTestId("alert-note")).toContainText("Setup smoke");

    // Routes: the list in order, the editor with its preview.
    await page.goto("/app/settings/alert-routes");
    await expect(page.getByTestId("route-row").first()).toBeVisible();
    await page.getByTestId("route-new").click();
    const ruleName = `Setup route ${Date.now().toString(36)}`;
    await page.getByTestId("route-name").fill(ruleName);
    await page.getByTestId("conditions-conditions-add").click();
    await page.getByTestId("route-page-me").click();
    await expect(page.getByTestId("route-rule")).toHaveCount(1);
    await page.getByTestId("route-preview-run").click();
    await expect(page.getByTestId("route-preview")).toContainText(/Setup: checkout/);
    await page.getByTestId("route-save").click();
    await expect(page).toHaveURL(/alert-routes\?saved=/);

    // The source's three choices are the source's own columns, not a rule.
    // They used to be written as a route scoped to that source and slipped in
    // just before the catch-all: it showed up in this list, where nobody had
    // written it, and a rule saved here got a later position and lost to it.
    // Nothing in this list is named after a source any more.
    await expect(page.getByTestId("route-row").filter({ hasText: name })).toHaveCount(0);

    // Attributes: the registry with its coverage.
    await page.goto("/app/settings/alert-attributes");
    const attributes = page.getByTestId("attribute-row");
    const beforeAttributes = await attributes.count();
    expect(beforeAttributes).toBeGreaterThanOrEqual(5);
    await page.getByTestId("attribute-new").click();
    await page.locator('[data-testid="attribute-form"] input[name="key"]').fill("customer");
    await page.locator('[data-testid="attribute-form"] input[name="label"]').fill("Customer");
    await page.getByTestId("attribute-save").click();
    await expect(attributes).toHaveCount(beforeAttributes + 1);

    /*
     * Put the workspace back. Everything above is written for a workspace the
     * suite is pointed at and keeps — the alerts it fired stay firing, the
     * source keeps receiving, the attribute stays in the registry, the rule
     * keeps deciding — and the next run finds a workspace that is no longer
     * the one this test describes.
     */
    await attributes.filter({ hasText: "customer" }).getByRole("button", { name: DELETE }).click();
    await expect(attributes).toHaveCount(beforeAttributes);

    await page.goto("/app/settings/alert-routes");
    const rule = page.getByTestId("route-row").filter({ hasText: ruleName });
    await rule.getByRole("button", { name: DELETE }).click();
    await expect(rule).toHaveCount(0);

    // Closed through the door they came in: the source's own endpoint.
    for (const key of [testKey, realKey]) {
      await api.post(endpoint, {
        headers: { "x-oi-secret": secret, "content-type": "application/json" },
        data: { title: "Setup: closing", status: "resolved", dedup_key: key },
      });
    }
    await page.goto(sourceUrl);
    await page.getByTestId("source-advanced").click();
    await page.getByTestId("source-delete").click();
    await expect(page).toHaveURL(/\/app\/alerts\/sources/);
    await expect(page.getByText(name)).toHaveCount(0);
    await api.dispose();
  });
});
