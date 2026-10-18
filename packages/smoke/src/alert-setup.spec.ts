import { expect, request, test } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { MEMBERS, signIn } from "./helpers";

/**
 * From nothing to "an alert paged someone": a source is created from the tool
 * grid, its page maps attributes against a real payload and previews the
 * routing, a route is edited on its own page and previewed against recent
 * alerts, and a payload posted to the endpoint is routed, pages, and opens a
 * triage incident.
 */

test.describe("Alert configuration", () => {
  test("a source page, a route page, and a real alert through it all", async ({ page }) => {
    // The keys this run fires under, so the end of it can close them: an alert
    // left firing groups the next run's into itself, and the run that made it
    // is the one that has to clear it.
    const run = Date.now().toString(36);
    const testKey = `setup-test-${run}`;
    const realKey = `setup-real-${run}`;
    await signIn(page, MEMBERS.owner);

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
    // The secret is shown once, with a line that waits for the first alert.
    await expect(page.getByTestId("source-first-alert")).toHaveAttribute("data-state", "waiting");
    // "I've added it": back to the sources, where the new one has its card.
    await page.getByTestId("source-configure").click();
    await page.waitForURL(/\/app\/alerts\/sources(\?|$)/);
    await page.getByTestId("source-row").filter({ hasText: name }).click();
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
      .locator('input[name="body"]')
      .fill("Setup smoke: checked the deploy, rolled back.");
    await page.getByTestId("alert-note-form").getByRole("button").click();
    await expect(page.getByTestId("alert-note")).toContainText("Setup smoke");

    // Rules: the list in order, then the full editor ("More options…") with its preview.
    await page.goto("/app/settings/rules");
    await expect(page.getByTestId("route-row").first()).toBeVisible();
    await page.goto("/app/settings/rules/new");
    const ruleName = `Setup route ${Date.now().toString(36)}`;
    await page.getByTestId("route-name").fill(ruleName);
    await page.getByTestId("conditions-conditions-add").click();
    await page.getByTestId("route-page-me").click();
    await expect(page.getByTestId("route-rule")).toHaveCount(1);
    await page.getByTestId("route-preview-run").click();
    await expect(page.getByTestId("route-preview")).toContainText(/Setup: checkout/);
    await page.getByTestId("route-save").click();
    await expect(page).toHaveURL(/\/app\/settings\/rules(\?|$)/);

    // The source's three choices are the source's own columns, not a rule.
    // They used to be written as a route scoped to that source and slipped in
    // just before the catch-all: it showed up in this list, where nobody had
    // written it, and a rule saved here got a later position and lost to it.
    // Nothing in this list is named after a source any more.
    await expect(page.getByTestId("route-row").filter({ hasText: name })).toHaveCount(0);

    // Labels: observed in the alerts — the ones just sent among them — and
    // read the way the pipeline reads them, which a manager can change.
    await page.goto("/app/settings/labels");
    const environment = page.locator('[data-testid="label-row"][data-key="environment"]');
    await expect(environment).toBeVisible();
    const required = environment.getByTestId("label-required-chip");
    const wasRequired = (await required.count()) > 0;
    const flipRequired = async () => {
      await environment.click();
      await page.getByTestId("label-required").dispatchEvent("click");
      await page.getByTestId("label-dialog-submit").click();
      await expect(page.getByTestId("label-dialog")).toHaveCount(0);
    };
    await flipRequired();
    await expect(required).toHaveCount(wasRequired ? 0 : 1);

    /*
     * Put the workspace back. Everything above is written for a workspace the
     * suite is pointed at and keeps — the alerts it fired stay firing, the
     * source keeps receiving, the attribute stays in the registry, the rule
     * keeps deciding — and the next run finds a workspace that is no longer
     * the one this test describes.
     */
    await flipRequired();
    await expect(required).toHaveCount(wasRequired ? 1 : 0);

    await page.goto("/app/settings/rules");
    const rule = page.getByTestId("route-row").filter({ hasText: ruleName });
    // Deleting is on the rule's own page, and asks first.
    const ruleId = await rule.getAttribute("data-rule-id");
    await page.goto(`/app/settings/rules/${ruleId}`);
    await page.getByTestId("rule-delete").click();
    await page.getByTestId("rule-delete-dialog-submit").click();
    await expect(page).toHaveURL(/\/app\/settings\/rules(\?|$)/);
    await expect(page.getByTestId("route-row").filter({ hasText: ruleName })).toHaveCount(0);

    // Closed through the door they came in: the source's own endpoint.
    for (const key of [testKey, realKey]) {
      await api.post(endpoint, {
        headers: { "x-oi-secret": secret, "content-type": "application/json" },
        data: { title: "Setup: closing", status: "resolved", dedup_key: key },
      });
    }
    await page.goto(sourceUrl);
    // Deleting sits under Advanced, with pausing and the trial mode, and asks
    // first; the browser's dialog is accepted.
    await page.getByTestId("source-advanced").click();
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("source-delete").click();
    await expect(page).toHaveURL(/\/app\/alerts\/sources/);
    await expect(page.getByText(name)).toHaveCount(0);
    await api.dispose();
  });
});

// The welcome screen's tool grid (the source follows the tool the second click
// picked) is checked in home.spec.ts, on a workspace of its own that really is
// empty — here every step was already done and the check always skipped.
