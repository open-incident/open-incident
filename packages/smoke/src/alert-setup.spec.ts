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
test.describe("Alert configuration", () => {
  test("the four steps, a source page, a route page, and a real alert through it all", async ({
    page,
  }) => {
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
        dedup_key: `setup-${Date.now()}`,
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
        dedup_key: `setup-real-${Date.now()}`,
      },
    });
    expect(res.status()).toBe(202);
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
    await page.getByTestId("route-name").fill(`Setup route ${Date.now().toString(36)}`);
    await page.getByTestId("conditions-conditions-add").click();
    await page.getByTestId("route-page-me").click();
    await expect(page.getByTestId("route-rule")).toHaveCount(1);
    await page.getByTestId("route-preview-run").click();
    await expect(page.getByTestId("route-preview")).toContainText(/Setup: checkout/);
    await page.getByTestId("route-save").click();
    await expect(page).toHaveURL(/alert-routes\?saved=/);

    // Attributes: the registry with its coverage.
    await page.goto("/app/settings/alert-attributes");
    await expect(page.getByTestId("attribute-row")).toHaveCount(5);
    await page.getByTestId("attribute-new").click();
    await page.locator('[data-testid="attribute-form"] input[name="key"]').fill("customer");
    await page.locator('[data-testid="attribute-form"] input[name="label"]').fill("Customer");
    await page.getByTestId("attribute-save").click();
    await expect(page.getByTestId("attribute-row")).toHaveCount(6);
  });
});
