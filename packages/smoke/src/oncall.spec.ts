import { expect, request, test } from "@playwright/test";
import { BASE_URL, MAILPIT_URL } from "../playwright.config";
import { MEMBERS, signIn, signOut } from "./helpers";

/**
 * On-call & alerting, end to end: a source created in the settings really
 * ingests, the alert is routed, opens a triage incident and escalates to the
 * person on call; acknowledging stops it; an incident can be escalated by hand
 * with a preview of who gets paged; schedules take overrides; a test
 * notification really lands in the mailbox.
 */
test.describe("On-call & alerting", () => {
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");

  test("an alert posted to a new source is routed, escalated, acknowledged and resolved", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/alert-sources");
    await page.getByTestId("source-open").click();
    await page.locator('form[data-testid="source-form"] select[name="kind"]').selectOption("http");
    await page
      .locator('form[data-testid="source-form"] input[name="name"]')
      .fill(`Smoke HTTP ${stamp}`);
    await page.locator('form[data-testid="source-form"] button[type=submit]').click();
    const endpoint = (await page.getByTestId("source-endpoint").textContent())?.trim() ?? "";
    const secret = (await page.getByTestId("source-secret").textContent())?.trim() ?? "";
    expect(endpoint).toMatch(/\/api\/ingest\/alerts\/[0-9a-f-]{36}$/);
    expect(secret).toMatch(/^oisrc_[a-f0-9]{40}$/);

    const api = await request.newContext({ baseURL: BASE_URL });
    const title = `[smoke ${stamp}] checkout-api error budget burn`;
    const key = `smoke-${stamp}`;
    // Wrong secret: refused. Right secret: accepted, routed to "Production alerts" → triage incident + escalation.
    expect(
      (await api.post(endpoint, { headers: { "x-oi-secret": "nope" }, data: { title } })).status(),
    ).toBe(401);
    const res = await api.post(endpoint, {
      headers: { "x-oi-secret": secret },
      data: {
        title,
        priority: "P1",
        service: "checkout-api",
        environment: "production",
        dedup_key: key,
      },
    });
    expect(res.status(), await res.text()).toBe(202);
    const body = (await res.json()) as {
      data: Array<{ alert_id: string; action: string; incident_number: number | null }>;
    };
    expect(body.data[0]!.action).toBe("created");
    expect(body.data[0]!.incident_number).toBeGreaterThan(0);
    const alertId = body.data[0]!.alert_id;

    // Same key again: deduplicated, no second incident.
    const again = await api.post(endpoint, {
      headers: { "x-oi-secret": secret },
      data: {
        title,
        priority: "P1",
        service: "checkout-api",
        environment: "production",
        dedup_key: key,
      },
    });
    expect(((await again.json()) as { data: Array<{ action: string }> }).data[0]!.action).toBe(
      "deduplicated",
    );

    await page.goto("/app/alerts");
    await expect(page.getByTestId("alert-card").filter({ hasText: title })).toBeVisible();
    await page.goto(`/app/alerts/${alertId}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByTestId("escalation-card")).toBeVisible();
    await expect(page.getByTestId("escalation-countdown")).toBeVisible();
    await page.getByTestId("alert-ack").click();
    await expect(page.getByTestId("acked-card")).toBeVisible();
    await expect(page.getByTestId("escalation-card")).toHaveCount(0);

    // The incident it opened is in triage, created from the alert, acknowledged by the owner.
    await page.goto(`/app/incidents/${body.data[0]!.incident_number}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByTestId("linked-alert").first()).toBeVisible();

    // Resolution from the source closes the alert.
    const resolved = await api.post(endpoint, {
      headers: { "x-oi-secret": secret },
      data: { title, status: "resolved", dedup_key: key },
    });
    expect(((await resolved.json()) as { data: Array<{ action: string }> }).data[0]!.action).toBe(
      "resolved",
    );
    await page.goto(`/app/alerts/${alertId}`);
    await expect(page.getByText(/Résolue|Resolved|Gelöst/).first()).toBeVisible();
    await api.dispose();
    await signOut(page);
  });

  test("a source test sends a real alert in test mode that pages nobody", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/alert-sources");
    const row = page.getByTestId("source-row").filter({ hasText: "Datadog" }).first();
    await row.getByTestId("source-test").click();
    await page.waitForURL(/tested=/);
    await page.getByRole("link", { name: /Ouvrir l'alerte|Open the test alert|Testalarm/ }).click();
    await expect(page.getByText(/mode test|test mode|Testmodus/i).first()).toBeVisible();
    await expect(page.getByTestId("escalation-card")).toHaveCount(0);
    await signOut(page);
  });

  test("the schedule shows who is on call and a click reassigns one slot", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/on-call");
    await expect(page.getByRole("heading", { name: "Platform primary" })).toBeVisible();
    await expect(page.getByTestId("oncall-now").first()).toBeVisible();
    await expect(page.getByTestId("oncall-me")).toBeVisible();
    const cells = page.getByTestId("shift-cell");
    await expect(cells.first()).toBeVisible();
    // Pick a filled cell of the day rotation (the first row), reassign it to someone else.
    await cells.nth(2).click();
    await expect(page.getByTestId("reassign")).toBeVisible();
    await page.getByTestId("reassign-to").first().click();
    await expect(page.getByText(/Override —|Override –|Ersetzung —/).first()).toBeVisible();
    await page
      .getByRole("button", { name: /Retirer l'override|Remove the override|Override entfernen/ })
      .first()
      .click();
    // iCal really answers.
    const ical = await page.request.get(
      (await page.locator('a[href^="/api/oncall/ical/"]').getAttribute("href"))!,
    );
    expect(ical.status()).toBe(200);
    expect(await ical.text()).toContain("BEGIN:VCALENDAR");
    await signOut(page);
  });

  test("escalating an incident previews who gets paged, then pages them", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/incidents/220");
    await page.getByTestId("escalate-open").click();
    await expect(
      page
        .getByTestId("escalate-preview")
        .getByText(/Niveau 1|Level 1|Stufe 1/)
        .first(),
    ).toBeVisible();
    await page.getByTestId("escalate-confirm").click();
    await expect(page.getByTestId("incident-escalation").first()).toBeVisible();
    await expect(
      page
        .getByTestId("timeline-event")
        .filter({ hasText: /Escalade|Escalation|Eskalation/ })
        .first(),
    ).toBeVisible();
    await signOut(page);
  });

  test("the notification test really lands in the mailbox with an honest status", async ({
    page,
  }) => {
    const since = Date.now();
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/on-call/notifications");
    await page.getByTestId("notif-test").click();
    await page.waitForURL(/test=1/);
    await expect(page.getByTestId("delivery-row").first()).toBeVisible();
    await expect(async () => {
      const res = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=20`);
      const { messages } = (await res.json()) as {
        messages: Array<{ Subject: string; Created: string; To: Array<{ Address: string }> }>;
      };
      const hit = messages.find(
        (m) =>
          m.Subject.includes("test notification") &&
          m.To.some((x) => x.Address === MEMBERS.owner) &&
          new Date(m.Created).getTime() >= since - 5_000,
      );
      expect(hit).toBeTruthy();
    }).toPass({ timeout: 20_000 });
    await page.reload();
    await expect(
      page
        .getByTestId("delivery-row")
        .first()
        .getByText(/envoy|sent|gesendet/i),
    ).toBeVisible();
    // A step can be added to the low-urgency rule and removed.
    // Ten steps at most: when a previous run filled the rule, remove one before adding.
    if (!(await page.getByTestId("rule-add-low").isVisible())) {
      await page
        .getByTestId("rule-low")
        .getByRole("button", { name: /Supprimer|Delete|Löschen/ })
        .last()
        .click();
      await expect(page.getByTestId("rule-add-low")).toBeVisible();
    }
    await page.getByTestId("rule-add-low").click();
    await expect(page.getByTestId("rule-low").getByText(/^3$/)).toBeVisible();
    await signOut(page);
  });

  test("the paths page draws the graph and a dry run names who would be paged", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/on-call/paths");
    await expect(page.getByTestId("path-level").first()).toBeVisible();
    await page.getByTestId("path-test").click();
    await expect(page.getByTestId("path-test-result")).toBeVisible();
    await page.goto("/app/settings/alert-routes");
    await expect(
      page.getByTestId("route-row").filter({ hasText: "Production alerts" }),
    ).toBeVisible();
    await page.goto("/app/settings/alert-priorities");
    await expect(page.getByTestId("priority-row")).toHaveCount(4);
    await page.goto("/app/settings/working-hours");
    await expect(page.getByTestId("hours-row").filter({ hasText: "EU business" })).toBeVisible();
    await page.goto("/app/settings/integrations");
    await expect(page.getByTestId("integration-card").filter({ hasText: "Datadog" })).toBeVisible();
    await signOut(page);
  });
});
