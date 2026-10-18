import { expect, test } from "@playwright/test";
import { MEMBERS, signIn, signOut } from "./helpers";

/**
 * Settings › Slack & Teams on any instance — with or without the Slack app
 * and the Teams bot. What must hold either way: the two tools side by side
 * with an honest state each, the eight sections or the panel that says why
 * there are none, and the "What people see" preview that follows the tool
 * and the open section. The connection journeys are slack.spec.ts and
 * teams.spec.ts, against the mocks.
 */
test.describe("Settings › Slack & Teams", () => {
  test("both tools, an honest state each, and a preview that follows", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/settings/chat");
    await expect(page.locator('[data-screen-label="Settings — Slack & Teams"]')).toBeVisible();
    const slack = page.getByTestId("chat-card-slack");
    const teams = page.getByTestId("chat-card-teams");
    await expect(slack).toBeVisible();
    await expect(teams).toBeVisible();
    for (const card of [slack, teams])
      expect(["connected", "not-connected", "unavailable"]).toContain(
        await card.getAttribute("data-state"),
      );

    // The preview's header names where the message goes, and moves with the tab.
    const where = page.getByTestId("chat-preview-where");
    await page.getByTestId("chat-preview-tab-slack").click();
    const slackWhere = (await where.textContent()) ?? "";
    await page.getByTestId("chat-preview-tab-teams").click();
    await expect(where).not.toHaveText(slackWhere);
    await page.getByTestId("chat-preview-tab-slack").click();

    const state = await slack.getAttribute("data-state");
    if (state === "connected") {
      // Eight sections; opening one changes what the preview shows.
      for (const id of ["channels", "ann", "page", "alerts", "atlas", "cmd", "people", "health"])
        await expect(page.getByTestId(`chat-sec-${id}`)).toBeVisible();
      await page.getByTestId("chat-sec-health").getByRole("button").first().click();
      await expect(page.getByTestId("chat-preview")).toContainText("TEST");
      await page.getByTestId("chat-sec-page").getByRole("button").first().click();
      // Acknowledge acts on the preview itself.
      const ack = page.getByTestId("chat-preview-action").first();
      await ack.click();
      await expect(page.getByTestId("chat-preview-action")).toHaveCount(0);
    } else if (state === "unavailable") {
      // Said, with what the operator sets — never a dead Connect button.
      await expect(page.getByTestId("chat-unavailable")).toContainText("SLACK_CLIENT_ID");
      await expect(page.getByTestId("chat-connect-slack")).toHaveCount(0);
    } else {
      await expect(page.getByTestId("chat-not-connected")).toBeVisible();
      await expect(page.getByTestId("chat-connect-slack").first()).toBeVisible();
    }
    await signOut(page);
  });

  test("a viewer reads why, and gets no control", async ({ page }) => {
    await signIn(page, MEMBERS.viewer);
    await page.goto("/app/settings/chat");
    await expect(page.getByTestId("role-restricted")).toBeVisible();
    await expect(page.getByTestId("chat-settings")).toHaveCount(0);
    await signOut(page);
  });

  test("the manifest downloads for an admin, and only for an admin", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    const r = await page.request.get("/api/slack/manifest");
    expect(r.status()).toBe(200);
    const manifest = (await r.json()) as {
      features: { slash_commands: Array<{ url: string; usage_hint: string }> };
    };
    expect(manifest.features.slash_commands[0]!.url).toMatch(/\/api\/slack\/commands$/);
    expect(manifest.features.slash_commands[0]!.usage_hint).toContain("atlas stop");
    await signOut(page);
    await signIn(page, MEMBERS.responder);
    expect((await page.request.get("/api/slack/manifest")).status()).toBe(403);
    await signOut(page);
  });
});
