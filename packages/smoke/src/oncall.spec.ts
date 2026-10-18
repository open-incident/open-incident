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
    await page.goto("/app/alerts/sources");
    await page.getByTestId("source-open").click();
    await page.getByTestId("source-kind-http").click();
    await page
      .locator('[data-testid="source-form"] input[name="name"]')
      .fill(`Smoke HTTP ${stamp}`);
    await page.locator('[data-testid="source-form"] button[type=submit]').click();
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
    await page.goto("/app/alerts/sources");
    // The grid lists the sources; sending a test belongs to the source's page.
    await page.getByTestId("source-row").filter({ hasText: "Datadog" }).first().click();
    await page.getByTestId("source-test").click();
    await page.waitForURL(/tested=/);
    await page.getByRole("link", { name: /^(Open it|L'ouvrir|Öffnen)$/ }).click();
    await expect(page.getByText(/mode test|test mode|Testmodus/i).first()).toBeVisible();
    await expect(page.getByTestId("escalation-card")).toHaveCount(0);
    await signOut(page);
  });

  test("the schedule shows who is on call and a click reassigns one slot", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    // Who is on call, and the seven-day grid, are the "Now" tab; the schedule's
    // name is a card title there rather than a heading element.
    await page.goto("/app/on-call?tab=now");
    await expect(
      page.getByTestId("oncall-now").filter({ hasText: "Platform primary" }).first(),
    ).toBeVisible();
    const grid = page.getByTestId("oncall-grid");
    await expect(grid).toBeVisible();
    // A cell two days ahead: a slot that has not started, whatever the hour.
    const target = grid.getByTestId("shift-cell").nth(2);
    const day = await target.getAttribute("data-day");
    const rotation = await target.getAttribute("data-rotation");
    const cell = page.locator(
      `[data-testid="shift-cell"][data-day="${day}"][data-rotation="${rotation}"]`,
    );
    const hadOverride = (await cell.getAttribute("data-override")) === "1";
    await cell.click();
    await expect(page.getByTestId("reassign")).toBeVisible();
    await page.getByTestId("reassign-to").first().click();
    // The band closes; the cell carries the OVERRIDE tag.
    await expect(page.getByTestId("reassign")).toHaveCount(0);
    await expect(cell).toHaveAttribute("data-override", "1");
    await expect(cell).toContainText(/override|remplacement|Ersetzung/i);
    // Taking it back is the same cell: the band lists the override to remove.
    await cell.click();
    await page.getByTestId("override-remove").last().click();
    await expect(page.getByTestId("reassign")).toHaveCount(0);
    if (!hadOverride) await expect(cell).not.toHaveAttribute("data-override", "1");

    // The month view: the week-ends of the next two months, two cells each.
    await page.getByTestId("grid-view-month").click();
    await expect(page).toHaveURL(/view=month/);
    const rows = await page.getByTestId("rotation-people-toggle").count();
    await expect(page.getByTestId("shift-cell")).toHaveCount(rows * 16);
    for (const d of await page
      .getByTestId("shift-cell")
      .evaluateAll((els) => els.slice(0, 16).map((e) => e.getAttribute("data-day") ?? ""))) {
      const w = new Date(`${d}T12:00:00Z`).getUTCDay();
      expect([0, 6]).toContain(w);
    }

    // iCal really answers. The subscription link lives with the schedules.
    await page.goto("/app/on-call?tab=schedules");
    const ical = await page.request.get(
      (await page.locator('a[href^="/api/oncall/ical/"]').first().getAttribute("href"))!,
    );
    expect(ical.status()).toBe(200);
    expect(await ical.text()).toContain("BEGIN:VCALENDAR");
    await signOut(page);
  });

  test("the people of a rotation change at the next handover, the shift under way is kept", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/on-call?tab=now");
    await page.getByTestId("rotation-people-toggle").first().click();
    const panel = page.getByTestId("rotation-people");
    await expect(panel).toBeVisible();
    const order = async () =>
      panel
        .getByTestId("people-row")
        .evaluateAll((els) => els.map((e) => e.getAttribute("data-member") ?? ""));
    const before = await order();
    expect(before.length).toBeGreaterThanOrEqual(3);
    const today = page.locator('[data-testid="shift-cell"]').first();
    const holderToday = (await today.textContent()) ?? "";

    // Move the person due at the next handover one turn later.
    await panel.getByTestId("people-row").nth(1).getByTestId("people-down").click();
    await expect.poll(order).toEqual([before[0], before[2], before[1], ...before.slice(3)]);
    // The person on the current turn is still first, the panel says from when
    // the new order runs, and today's cell has not moved.
    await expect(panel.getByTestId("people-applies")).toContainText(
      /next handover|prochaine relève|nächsten Übergabe/,
    );
    await expect(page.locator('[data-testid="shift-cell"]').first()).toHaveText(holderToday);

    // Put it back: the waiting order is replaced, not stacked.
    await panel.getByTestId("people-row").nth(2).getByTestId("people-up").click();
    await expect.poll(order).toEqual(before);

    // Members on the Schedules tab opens the same list.
    await page.goto("/app/on-call?tab=schedules");
    await page.getByTestId("schedule-members").first().click();
    await expect(page.getByTestId("rotation-people").first()).toBeVisible();
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
        .filter({ hasText: /Escalade|Escalation|Eskalation|Paging|Appel de|Alarmierung/ })
        .first(),
    ).toBeVisible();
    await signOut(page);
  });

  test("the notification test really lands in the mailbox with an honest status", async ({
    page,
  }) => {
    const since = Date.now();
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/on-call?tab=notifications");
    // Every channel the instance cannot use says so, dashed, with the reason.
    for (const row of await page.getByTestId("contact-unavailable").all())
      await expect(row).toContainText(
        /Unavailable|Indisponible|nicht verfügbar|Turned off|Désactivé|ausgeschaltet/,
      );
    await page.getByTestId("notif-test").click();
    await page.waitForURL(/test=1/);
    await expect(page.getByTestId("notif-test-queued")).toBeVisible();
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
    }).toPass({ timeout: 60_000 });
    // The email row's status is the real one of that delivery.
    await page.reload();
    await expect(
      page.locator('[data-testid="contact-row"][data-kind="email"]').getByTestId("contact-status"),
    ).toHaveText(/sent|delivered|envoy|remis|gesendet|zugestellt/i);

    // A step can be added to the low-urgency rule and taken out again.
    const low = page.getByTestId("rule-low");
    const steps = low.getByTestId("rule-step");
    if (await page.getByTestId("rule-open-low").isVisible()) {
      const count = await steps.count();
      await page.getByTestId("rule-open-low").click();
      await page.locator('[data-testid="rule-low"] select[name="kind"]').selectOption("email");
      await page.locator('[data-testid="rule-low"] select[name="delayMinutes"]').selectOption("30");
      await page.getByTestId("rule-add-low").click();
      await expect(steps).toHaveCount(count + 1);
      const added = steps.filter({ hasText: /30/ });
      await added.hover();
      await added.getByTestId("rule-step-remove").click();
      await expect(steps).toHaveCount(count);
    }
    await signOut(page);
  });

  test("the paths page draws the graph and a dry run names who would be paged", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/on-call?tab=policies");
    await expect(page.getByTestId("path-level").first()).toBeVisible();
    // Teams have no tab of their own; the policies lead to them.
    await page.getByTestId("policy-teams-link").click();
    await expect(page).toHaveURL(/tab=teams/);
    await expect(page.getByTestId("oncall-tab-policies")).toHaveAttribute("aria-current", "page");
    await page.goto("/app/on-call?tab=policies");
    // One dry run per policy card now, so the first is the one to drive.
    await page.getByTestId("path-test").first().click();
    await expect(page.getByTestId("path-test-result").first()).toBeVisible();
    // Rules, alert severities, working hours and integrations are Settings
    // screens: their own specs drive them.
    await signOut(page);
  });
});
