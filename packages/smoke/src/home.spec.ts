import { spawnSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { BASE_URL, TENANT } from "../playwright.config";
import { MEMBERS, PASSWORD, signIn } from "./helpers";

/**
 * The frame and Home, as the V2 design draws them: the rail with who is on
 * call and a "Page me" that really pages, the reader at its foot, a header
 * reduced to the search and the bell, a palette driven from the keyboard —
 * then Home, living and empty.
 *
 * Every check is on test ids or on what the database must have produced, not
 * on wording: the suite runs in whatever language the workspace speaks.
 */
test.describe("Shell", () => {
  test("the rail names who is on call, pages the reader for real, and holds the reader", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app");
    const rail = page.getByTestId("rail");
    await expect(rail.getByTestId("oncall-card")).toBeVisible();
    // The reader moved from the header to the foot of the rail.
    await expect(page.locator("header").getByTestId("account-chip")).toHaveCount(0);
    await expect(rail.getByTestId("account-chip")).toBeVisible();
    await expect(page.locator("header").getByTestId("search-open")).toBeVisible();
    await expect(page.locator("header").getByTestId("bell")).toBeVisible();

    // Page me: a real notification, which lands in the reader's own bell.
    await page.getByTestId("page-me").click();
    await expect(page.getByTestId("test-mode")).toBeVisible();
    await expect(page.getByTestId("toast")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("bell-dot")).toBeVisible({ timeout: 20_000 });

    // The member menu opens upwards with the account and the way out.
    await rail.getByTestId("account-chip").click();
    await expect(page.getByTestId("account-menu-account")).toBeVisible();
    await expect(page.getByTestId("sign-out")).toBeVisible();
  });

  test("a click in the rail swaps the screen and keeps the frame", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app/incidents");
    await page.evaluate(() => {
      (document.querySelector("[data-testid=rail]") as HTMLElement & { _kept?: number })._kept = 1;
    });
    for (const href of ["/app/alerts", "/app/monitors", "/app"]) {
      await page.locator(`[data-testid=rail] a[href="${href}"]`).click();
      await page.waitForURL((u) => u.pathname === href);
      const kept = await page.evaluate(
        () =>
          (document.querySelector("[data-testid=rail]") as HTMLElement & { _kept?: number })
            ._kept ?? 0,
      );
      expect(kept, `the rail was remounted on the way to ${href}`).toBe(1);
    }
  });

  test("⌘K: the keyboard reaches every row, a question searches, D declares", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app");

    await page.getByTestId("search-open").click();
    await expect(page.getByTestId("palette")).toBeVisible();
    // ↓ then ↵ runs the first row — declaring, for an owner.
    await page.getByTestId("palette-input").press("ArrowDown");
    await page.getByTestId("palette-input").press("Enter");
    await page.waitForURL(/\/app\/incidents\?declare=1/);

    await page.goto("/app");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("palette")).toBeVisible();
    await page.getByTestId("palette-input").fill("zzqx checkout");
    // A question: Atlas says what it can do today, and ↵ searches the incidents.
    await expect(page.getByTestId("palette-atlas")).toBeVisible();
    await page.getByTestId("palette-input").press("Enter");
    await page.waitForURL(/\/app\/incidents\?q=zzqx/);

    // "D", outside a field, declares.
    await page.goto("/app");
    await page.locator("main").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("d");
    await page.waitForURL(/\/app\/incidents\?declare=1/);
  });

  test("the Guide opens on Getting started and leads to every chapter", async ({ page }) => {
    await signIn(page, MEMBERS.viewer);
    await page.goto("/app");
    await page.locator('[data-testid=rail] a[href="/app/guide"]').click();
    await page.waitForURL(/\/app\/guide$/);
    const chapters = page.getByTestId("guide-chapters");
    expect(await chapters.locator("a[href^='/app/docs/']").count()).toBeGreaterThanOrEqual(20);
    await chapters.locator("a[href^='/app/docs/']").first().click();
    await page.waitForURL(/\/app\/docs\/[a-z-]+$/);
    await expect(page.locator("article h1")).toBeVisible();
    // The rail keeps "Guide" lit inside the chapters.
    await expect(page.locator('[data-testid=rail] a[href="/app/guide"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

test.describe("Home — living workspace", () => {
  test("burning, monitors, on call, certificates — each card counted from rows", async ({
    page,
  }) => {
    await signIn(page, MEMBERS.owner);
    await page.goto("/app");
    await expect(page.locator("[data-screen-label='Home — living workspace']")).toBeVisible();
    await expect(page.getByTestId("home-burning")).toBeVisible();
    await expect(page.getByTestId("home-monitors")).toBeVisible();
    await expect(page.getByTestId("home-oncall")).toBeVisible();

    // The demo's certificates: one inside a week, one inside a month, three valid.
    const certs = page.getByTestId("home-certificates");
    await expect(certs).toBeVisible();
    await expect(certs.getByTestId("home-cert-badge")).toContainText("1");
    await expect(certs.getByTestId("home-cert-row")).toHaveCount(2);
    await expect(certs.getByTestId("home-cert-row").first()).toContainText("auth.skylark.dev");
    await certs.getByTestId("home-cert-row").first().click();
    await page.waitForURL(/\/app\/monitors\/[0-9a-f-]{36}/);
  });

  test("the right column drops under the left one on a narrow screen", async ({ page }) => {
    await signIn(page, MEMBERS.owner);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/app");
    const burning = page.getByTestId("home-burning");
    const oncall = page.getByTestId("home-oncall");
    let a = (await burning.boundingBox())!;
    let b = (await oncall.boundingBox())!;
    expect(b.x).toBeGreaterThan(a.x + a.width - 1);
    await page.setViewportSize({ width: 960, height: 900 });
    await page.waitForTimeout(300);
    a = (await burning.boundingBox())!;
    b = (await oncall.boundingBox())!;
    expect(b.y).toBeGreaterThan(a.y);
    expect(b.width).toBeLessThanOrEqual(321);
  });
});

/**
 * Home on a workspace that has never been paged: a fresh one, created for this
 * test with the operator's own command and purged after it.
 */
test.describe("Home — empty workspace", () => {
  const slug = `${TENANT}-e`.slice(0, 40);
  const base = BASE_URL.replace(`//${TENANT}.`, `//${slug}.`);
  const db = (args: string[]) =>
    spawnSync("pnpm", ["--filter", "@openincident/db", ...args], {
      encoding: "utf8",
      env: { ...process.env, COREPACK_ENABLE_STRICT: "0" },
    });

  test.afterAll(() => {
    if (process.env.SMOKE_KEEP === "1") return;
    db(["workspace:purge", "--", "--slug", slug, "--yes"]);
  });

  async function enter(page: Page) {
    const made = db([
      "workspace:create",
      "--",
      "--slug",
      slug,
      "--name",
      "Smoke Empty",
      "--owner-email",
      MEMBERS.owner,
      "--owner-name",
      "Amélie Laurent",
      "--locale",
      "en",
    ]);
    const link = /https?:\/\/\S+\/invite\/\S+/.exec(made.stdout ?? "")?.[0];
    expect(link, made.stderr).toBeTruthy();
    // The identity exists already: the invitation only activates the membership.
    await page.goto(link!.replace(/^https?:\/\/[^/]+/, base));
    if (
      await page
        .locator("input[name=password]")
        .isVisible()
        .catch(() => false)
    ) {
      await page.locator("input[name=password]").fill(PASSWORD);
      await page.locator("button[type=submit]").first().click();
      await page.waitForURL(/\/login|\/app/);
    }
    await expect(async () => {
      await page.goto(`${base}/login`);
      if (!/\/app/.test(page.url())) {
        await page.locator("input[type=email]").fill(MEMBERS.owner);
        await page.locator("input[type=password]").fill(PASSWORD);
        await page.locator("button[type=submit]").click();
        await page.waitForURL(/\/app\//, { timeout: 8_000 });
      }
    }).toPass({ timeout: 60_000, intervals: [1_000, 3_000, 6_000] });
    await page.goto(`${base}/app`);
  }

  test("three real steps, then the living workspace says so", async ({ page }) => {
    await enter(page);
    await expect(page.locator("[data-screen-label='Home — empty workspace']")).toBeVisible();
    await expect(page.getByTestId("onboarding-progress")).toHaveText("0 %");
    const steps = page.getByTestId("onboarding-step");
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(1)).toHaveAttribute("data-locked", "true");
    await expect(steps.nth(2)).toHaveAttribute("data-locked", "true");

    // The two doors the design adds, to the screens that do the work.
    await expect(page.getByTestId("home-opsgenie")).toHaveAttribute(
      "href",
      "/app/settings/migrate",
    );
    await expect(page.getByTestId("home-chat").getByRole("button")).toHaveCount(2);

    // Step 1 — « Me »: the path that pages the reader is built on "Continue".
    await page.getByTestId("onboarding-who-me").click();
    const verified = page.getByTestId("onboarding-phone");
    if (await verified.isVisible().catch(() => false)) {
      test.skip(true, "an SMS operator is configured: the phone must be verified first");
    }
    await page.getByTestId("onboarding-next-1").click();
    await expect(steps.nth(0).getByTestId("onboarding-step-done")).toBeVisible();
    await expect(page.getByTestId("onboarding-progress")).toHaveText("33 %");

    // Step 2 — a tool: Datadog, then Grafana; the source is named after the second.
    await page.getByTestId("onboarding-tool-datadog").click();
    await page.getByTestId("onboarding-tool-grafana").click();
    await expect(page.getByTestId("onboarding-source").locator("input[name=kind]")).toHaveValue(
      "grafana",
    );
    await page.getByTestId("onboarding-source-create").click();
    const endpoint = page.getByTestId("onboarding-endpoint");
    await expect(endpoint).toContainText(/\/api\/ingest\/alerts\/[0-9a-f-]{36}\?secret=/);
    await page.getByTestId("onboarding-next-2").click();
    await expect(steps.nth(1).getByTestId("onboarding-step-done")).toContainText("Grafana");

    // Step 3 — the test page leaves through the real channels…
    await page.getByTestId("onboarding-test").click();
    const log = page.getByTestId("onboarding-test-sent");
    await expect(log).toBeVisible({ timeout: 20_000 });
    // …and the reader closes the loop: Home is now the living workspace.
    await page.getByTestId("onboarding-acked").click();
    await expect(page.getByTestId("home-just-done")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("[data-screen-label='Home — living workspace']")).toBeVisible();
  });
});
