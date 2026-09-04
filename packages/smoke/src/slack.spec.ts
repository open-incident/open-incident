import { createHmac } from "node:crypto";
import { expect, request, test, type APIRequestContext } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { MEMBERS, signIn, signOut } from "./helpers";
import { startSlackMock, type Call } from "./slack-mock";

const SIGNING = process.env.SMOKE_SLACK_SIGNING_SECRET ?? "smoke-signing-secret";

function signed(raw: string): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    "x-slack-request-timestamp": ts,
    "x-slack-signature": `v0=${createHmac("sha256", SIGNING).update(`v0:${ts}:${raw}`).digest("hex")}`,
    "content-type": "application/x-www-form-urlencoded",
  };
}

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

/**
 * The Slack app against a mock Slack API (the web server points SLACK_API_BASE
 * at it): install through OAuth, configure, test; then the real gestures —
 * an incident declared from Slack gets its channel, `/incident update` posts
 * in it, a :pushpin: reaction lands on the timeline, a web update reaches the
 * channel, and the announcement channel receives the living post.
 */
test.describe("Slack app", () => {
  let mock: Awaited<ReturnType<typeof startSlackMock>>;
  let api: APIRequestContext;
  test.beforeAll(async () => {
    mock = await startSlackMock();
    api = await request.newContext({ baseURL: BASE_URL });
  });
  test.afterAll(async () => {
    await api.dispose();
    mock.server.close();
  });
  const calls = async (): Promise<Call[]> =>
    (await (await fetch("http://127.0.0.1:3197/_calls")).json()) as Call[];

  test("install, configure and test the Slack app from the settings", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/integrations");
    await page
      .getByTestId("integration-card")
      .filter({ hasText: "Slack" })
      .getByRole("link", { name: /Connecter|Connect|Verbinden|Configurer|Configure|Konfigurieren/ })
      .click();
    await expect(page.getByTestId("slack-connect")).toBeVisible();
    // Step 1: authorize — the mock redirects straight back with a code.
    const authorize = page.getByTestId("slack-authorize");
    if (await authorize.isVisible()) {
      await authorize.click();
      await page.waitForURL(/connect=slack&step=2/);
    }
    await expect(page.getByTestId("slack-authorized")).toBeVisible();
    // Step 2: configuration — channels come from the mock.
    await page
      .locator('form[data-testid="slack-config"] select[name="announceChannelId"]')
      .selectOption("C_ANNOUNCE");
    await page.getByTestId("slack-config-save").click();
    await page.waitForURL(/step=3/);
    // Step 3: a real test message.
    await page.getByTestId("slack-test").click();
    await expect(page.getByTestId("slack-tested")).toBeVisible();
    const posted = (await calls()).filter(
      (c) => c.method === "chat.postMessage" && c.body.channel === "C_ANNOUNCE",
    );
    expect(posted.length).toBeGreaterThan(0);
    await page.getByTestId("slack-finish").click();
    await expect(
      page
        .getByTestId("integration-card")
        .filter({ hasText: "Slack" })
        .getByText(/Connectée|Connected|Verbunden/),
    ).toBeVisible();
    await signOut(page);
  });

  test("an incident declared from Slack gets its channel; /incident update posts in it; a pin lands on the timeline", async ({
    page,
  }) => {
    mock.reset();
    // `/incident declare` opens the modal (views.open on the mock)…
    const cmd = form({
      team_id: "T_SMOKE",
      user_id: "U_AMELIE",
      channel_id: "C_GENERAL",
      command: "/incident",
      text: "declare Smoke from Slack",
      trigger_id: "trig-1",
    });
    const r1 = await api.post("/api/slack/commands", { headers: signed(cmd), data: cmd });
    expect(r1.status()).toBe(200);
    const opened = (await calls()).find((c) => c.method === "views.open");
    expect(opened).toBeTruthy();
    // The default type requires the affected service: pick the first option the modal offered.
    const view = opened!.body.view as {
      blocks: Array<{ block_id?: string; element?: { options?: Array<{ value: string }> } }>;
    };
    const serviceId = view.blocks.find((b) => b.block_id === "service")?.element?.options?.[0]
      ?.value;
    expect(serviceId).toBeTruthy();
    // …and the submitted view declares the incident.
    const title = `[smoke slack ${new Date().toISOString().slice(11, 19)}] Checkout errors from Slack`;
    const submission = form({
      payload: JSON.stringify({
        type: "view_submission",
        team: { id: "T_SMOKE" },
        user: { id: "U_AMELIE" },
        view: {
          callback_id: "oi_declare",
          private_metadata: JSON.stringify({ channel: "C_GENERAL" }),
          state: {
            values: {
              title: { title: { value: title } },
              service: { service: { selected_option: { value: serviceId } } },
              summary: { summary: { value: "Declared from the Slack modal." } },
            },
          },
        },
      }),
    });
    const r2 = await api.post("/api/slack/interactions", {
      headers: signed(submission),
      data: submission,
    });
    expect(r2.status()).toBe(200);
    expect(await r2.json()).toEqual({ response_action: "clear" });

    // The channel is created after the commit; wait for the mock to see it.
    await expect
      .poll(async () => (await calls()).filter((c) => c.method === "conversations.create").length, {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    const created = (await calls()).find((c) => c.method === "conversations.create")!;
    const channelId = (created.response as { channel: { id: string } }).channel.id;

    await signIn(page, MEMBERS.owner);
    await page.goto("/app/incidents");
    await page
      .getByRole("link", { name: new RegExp(title.replace(/[[\]]/g, "\\$&")) })
      .first()
      .click();
    await page.waitForURL(/\/app\/incidents\/\d+$/);
    const number = Number(page.url().split("/").pop());
    await expect(page.getByTestId("slack-channel")).toContainText("#inc-");

    // /incident update from the channel publishes an update — visible on the web timeline and posted back to Slack.
    const upd = form({
      team_id: "T_SMOKE",
      user_id: "U_KARIM",
      channel_id: channelId,
      command: "/incident",
      text: "update Mitigation in progress from Slack.",
    });
    const r3 = await api.post("/api/slack/commands", { headers: signed(upd), data: upd });
    expect(((await r3.json()) as { text: string }).text).toContain(`INC-${number}`);
    await page.reload();
    await expect(page.getByText("Mitigation in progress from Slack.")).toBeVisible();
    await expect
      .poll(
        async () =>
          (await calls()).filter(
            (c) =>
              c.method === "chat.postMessage" &&
              c.body.channel === channelId &&
              JSON.stringify(c.body.blocks ?? "").includes("Mitigation in progress"),
          ).length,
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);

    // /incident status answers in Slack; a stranger is refused politely.
    const st = form({
      team_id: "T_SMOKE",
      user_id: "U_KARIM",
      channel_id: channelId,
      command: "/incident",
      text: "status",
    });
    expect(
      (
        (await (
          await api.post("/api/slack/commands", { headers: signed(st), data: st })
        ).json()) as { text: string }
      ).text,
    ).toContain(`INC-${number}`);
    const stranger = form({
      team_id: "T_SMOKE",
      user_id: "U_STRANGER",
      channel_id: channelId,
      command: "/incident",
      text: "status",
    });
    expect(
      (
        (await (
          await api.post("/api/slack/commands", { headers: signed(stranger), data: stranger })
        ).json()) as { text: string }
      ).text,
    ).toMatch(/does not match/);
    // A forged signature is refused.
    expect(
      (
        await api.post("/api/slack/commands", {
          headers: { ...signed(st), "x-slack-signature": "v0=deadbeef" },
          data: st,
        })
      ).status(),
    ).toBe(401);

    // :pushpin: on a message → pinned note on the timeline.
    const ev = JSON.stringify({
      type: "event_callback",
      team_id: "T_SMOKE",
      event: {
        type: "reaction_added",
        user: "U_KARIM",
        reaction: "pushpin",
        item: { type: "message", channel: channelId, ts: "1700000000.000200" },
      },
    });
    const r4 = await api.post("/api/slack/events", {
      headers: { ...signed(ev), "content-type": "application/json" },
      data: ev,
    });
    expect(r4.status()).toBe(200);
    await expect(async () => {
      await page.reload();
      await expect(
        page.getByText(/connection pool of checkout-api is exhausted/).first(),
      ).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });

    // A web update with the Slack toggle on reaches the channel too.
    await page.getByTestId("update-open").click();
    await page.locator('textarea[name="message"]').fill("Web update mirrored to Slack.");
    await page.locator('form[data-testid="update-form"] button[type=submit]').click();
    await expect(page.getByText("Web update mirrored to Slack.")).toBeVisible();
    await expect
      .poll(
        async () =>
          (await calls()).filter(
            (c) =>
              c.method === "chat.postMessage" &&
              c.body.channel === channelId &&
              JSON.stringify(c.body.blocks ?? "").includes("Web update mirrored"),
          ).length,
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);

    // The URL challenge of the Events API is answered.
    const challenge = await api.post("/api/slack/events", {
      headers: { "content-type": "application/json" },
      data: { type: "url_verification", challenge: "abc123" },
    });
    expect(await challenge.json()).toEqual({ challenge: "abc123" });
    await signOut(page);
  });
});
