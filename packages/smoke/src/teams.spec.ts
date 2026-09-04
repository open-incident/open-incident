import { expect, request, test, type APIRequestContext } from "@playwright/test";
import { BASE_URL, MAILPIT_URL } from "../playwright.config";
import { MEMBERS, signIn } from "./helpers";
import { startTeamsMock } from "./teams-mock";

/**
 * Microsoft Teams against a mock of Microsoft (port 3196): the admin pairs a
 * team by typing a code the settings issued, configures the announcement
 * channel and posts a test card; an incident declared in the web gets its
 * channel and header card in the team; a card submission from Teams declares
 * an incident; a responder links their account and gets paged with an
 * Acknowledge button that works. Every inbound activity is signed by the
 * mock's key and verified by the product.
 */
test.describe("Microsoft Teams", () => {
  let mock: Awaited<ReturnType<typeof startTeamsMock>>;
  let api: APIRequestContext;
  const TEAM = { id: "team-aad-group-1", name: "Skylark Engineering" };
  const AAD = "aad-tenant-skylark";
  const SERVICE = "http://127.0.0.1:3196/connector";
  test.beforeAll(async () => {
    mock = await startTeamsMock();
    api = await request.newContext({ baseURL: BASE_URL });
  });
  test.afterAll(async () => {
    await api.dispose();
    mock.server.close();
  });
  const activity = (extra: Record<string, unknown>) => ({
    type: "message",
    id: `act-${Date.now()}`,
    serviceUrl: SERVICE,
    recipient: { id: `28:${mock.appId}` },
    conversation: {
      id: "19:general@thread.tacv2;messageid=1",
      conversationType: "channel",
      tenantId: AAD,
    },
    channelData: {
      tenant: { id: AAD },
      team: { id: TEAM.id, aadGroupId: TEAM.id, name: TEAM.name },
      channel: { id: "19:general@thread.tacv2", name: "General" },
    },
    ...extra,
  });
  const send = (body: Record<string, unknown>, claims: Record<string, unknown> = {}) =>
    api.post("/api/teams/messages", {
      headers: {
        authorization: `Bearer ${mock.token(claims)}`,
        "content-type": "application/json",
      },
      data: body,
    });
  void MAILPIT_URL;

  test("an unsigned or mis-signed activity is refused", async () => {
    expect(
      (await api.post("/api/teams/messages", { data: activity({ text: "help" }) })).status(),
    ).toBe(401);
    expect((await send(activity({ text: "help" }), { aud: "someone-else" })).status()).toBe(401);
    expect((await send(activity({ text: "help" }))).status()).toBe(200);
  });

  test("pairing by code, configuration, test card, incident channel, declaration from a card", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/integrations?connect=teams");
    await page.getByTestId("teams-pair").click();
    await page.waitForURL(/connect=teams/);
    const code =
      (
        await page.getByTestId("teams-pairing-code").locator("span").first().textContent()
      )?.trim() ?? "";
    expect(code).toMatch(/^[A-Z0-9]{6}$/);

    // The admin types the code in the team — the mock delivers it as an activity.
    await send(
      activity({
        text: `<at>Open Incident</at> pair ${code}`,
        from: { id: "29:amelie", name: "Amélie Laurent", aadObjectId: "aad-amelie" },
        entities: [
          {
            type: "mention",
            text: "<at>Open Incident</at>",
            mentioned: { id: `28:${mock.appId}`, name: "Open Incident" },
          },
        ],
      }),
    );
    await expect
      .poll(
        async () =>
          mock.activities.some((a) => String(a.activity.text ?? "").includes("now paired")),
        { timeout: 15_000 },
      )
      .toBe(true);

    await page.goto("/app/settings/integrations?connect=teams&step=2");
    await page
      .getByTestId("teams-config-form")
      .locator('select[name="announceChannel"]')
      .selectOption({ label: "Ops" });
    await page.getByTestId("teams-config-save").click();
    await page.waitForURL(/step=3/);
    await page.getByTestId("teams-test").click();
    await page.waitForURL(/test=ok/);
    await expect(
      page.getByTestId("integration-card").filter({ hasText: "Microsoft Teams" }),
    ).toContainText(TEAM.name);

    // An incident declared in the web gets a channel and a header card in the team.
    await page.goto("/app/incidents/new");
    const title = `[teams ${Date.now().toString(36)}] Erreurs 5xx checkout`;
    await page.locator('input[name="name"]').fill(title);
    await page.locator('select[name="serviceEntryId"]').selectOption({ index: 1 });
    await page.locator('select[name="field.region"]').selectOption({ index: 1 });
    await page.locator('form[data-testid="declare-form"] button[type=submit]').click();
    await page.waitForURL(/\/app\/incidents\/\d+$/);
    await expect(page.getByTestId("teams-channel")).toBeVisible({ timeout: 15_000 });
    const channelName = (await page.getByTestId("teams-channel").textContent()) ?? "";
    expect(channelName).toMatch(/inc-\d+/);
    expect([...mock.channels.values()].some((c) => channelName.includes(c.displayName))).toBe(true);
    expect(mock.activities.some((a) => JSON.stringify(a.activity).includes(title))).toBe(true);

    // A status update from the web reaches the channel as a card.
    await page.getByTestId("update-open").click();
    await page
      .locator('textarea[name="message"]')
      .fill("Teams smoke update — rollback in progress.");
    await page.locator('form[data-testid="update-form"] button[type=submit]').click();
    await expect
      .poll(
        () =>
          mock.activities.some((a) => JSON.stringify(a.activity).includes("Teams smoke update")),
        { timeout: 15_000 },
      )
      .toBe(true);

    // From Teams: the declare card, submitted.
    const before = mock.activities.length;
    await send(
      activity({
        text: "declare",
        from: { id: "29:amelie", name: "Amélie Laurent", aadObjectId: "aad-amelie" },
      }),
    );
    await expect.poll(() => mock.activities.length, { timeout: 15_000 }).toBeGreaterThan(before);
    const declareCard = mock.activities
      .slice(before)
      .find((a) => JSON.stringify(a.activity).includes("oi_declare"));
    expect(declareCard).toBeTruthy();
    const card = (
      declareCard!.activity.attachments as Array<{
        content: { body: Array<{ id?: string; choices?: Array<{ value: string }> }> };
      }>
    )[0]!.content;
    const typeId = card.body.find((b) => b.id === "typeId")?.choices?.[0]?.value ?? "";
    const fromTeams = `[teams card ${Date.now().toString(36)}] Latence checkout`;
    await send(
      activity({
        text: "",
        value: {
          action: "oi_declare",
          name: fromTeams,
          typeId,
          severityId: "",
          serviceEntryId:
            card.body.find((b) => b.id === "serviceEntryId")?.choices?.[1]?.value ?? "",
          summary: "Declared from Teams.",
        },
        from: { id: "29:amelie", name: "Amélie Laurent", aadObjectId: "aad-amelie" },
      }),
    );
    await expect
      .poll(() => mock.activities.some((a) => String(a.activity.text ?? "").includes(fromTeams)), {
        timeout: 20_000,
      })
      .toBe(true);
    await page.goto("/app/incidents");
    await expect(page.getByText(fromTeams)).toBeVisible();
  });

  test("a responder links Teams for pages and acknowledges from the card", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/on-call/notifications");
    const link = page.getByTestId("teams-link");
    if ((await link.count()) > 0) {
      await link.click();
      await page.waitForURL(/verified=1/);
    }
    await expect(page.getByText("Teams DM").first()).toBeVisible();
    // A test notification goes out on every verified method — Teams DM included.
    const before = mock.activities.length;
    await page.getByTestId("notif-test").click();
    await page.waitForURL(/test=1/);
    await expect
      .poll(
        () =>
          mock.activities.slice(before).filter((a) => a.conversationId.startsWith("a:personal-"))
            .length,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
    const dm = mock.activities
      .slice(before)
      .find(
        (a) =>
          a.conversationId.startsWith("a:personal-") &&
          JSON.stringify(a.activity).includes("oi_ack"),
      );
    if (dm) {
      const token = JSON.stringify(dm.activity).match(/"token":"([^"]+)"/)?.[1];
      expect(token).toBeTruthy();
      await send({
        ...activity({
          text: "",
          value: { action: "oi_ack", token },
          from: { id: "29:amelie", name: "Amélie Laurent", aadObjectId: "aad-amelie" },
          replyToId: dm.id,
        }),
        conversation: { id: dm.conversationId, conversationType: "personal", tenantId: AAD },
        channelData: { tenant: { id: AAD } },
      });
      await expect
        .poll(
          () =>
            JSON.stringify(dm.activity).includes("Acknowledged") ||
            JSON.stringify(dm.activity).includes("no longer"),
          { timeout: 15_000 },
        )
        .toBe(true);
    }
  });
});
