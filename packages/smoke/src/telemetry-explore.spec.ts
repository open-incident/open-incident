import { expect, test } from "@playwright/test";
import { MEMBERS, signIn, telemetryInstalled } from "./helpers";

/**
 * Telemetry, as five questions rather than eleven signals.
 *
 * What is guarded here is the two things the grouping is for. The signal
 * selector has to carry the window and the filter with it — that is the whole
 * point of one Explorer instead of seven tabs, and it is one line of state
 * away from silently not happening. And every one of the eleven old addresses
 * has to still land where its content went: they are in runbooks, in
 * bookmarks and in alert bodies the product has already sent.
 */
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await signIn(page, MEMBERS.owner);
  test.skip(!(await telemetryInstalled(page)), "no telemetry module on this instance");
});

test("the five tabs are there, and the rail no longer carries dashboards", async ({ page }) => {
  await page.goto("/app/telemetry");
  for (const tab of ["overview", "explore", "dashboards", "slos", "setup"]) {
    await expect(page.getByTestId(`telemetry-tab-${tab}`)).toBeVisible();
  }
  // Dashboards moved in here, so the rail entry is gone — and its old address
  // still arrives.
  await expect(page.locator('aside a[href="/app/dashboards"]')).toHaveCount(0);
  await page.goto("/app/dashboards");
  await expect(page).toHaveURL(/tab=dashboards/);
  await expect(page.getByTestId("dashboards-tab")).toBeVisible();
});

test("the window and the filter survive a change of signal", async ({ page }) => {
  const filter = "service_name = 'checkout-api'";
  await page.goto(
    `/app/telemetry?tab=explore&signal=logs&range=6h&q=${encodeURIComponent(filter)}`,
  );
  await expect(page.getByTestId("telemetry-signal-logs")).toBeVisible();

  await page.getByTestId("telemetry-signal-traces").click();
  await page.waitForURL(/signal=traces/);
  const url = new URL(page.url());
  expect(url.searchParams.get("range")).toBe("6h");
  expect(url.searchParams.get("q")).toBe(filter);

  // And the window is a link like any other: changing it keeps the signal.
  await page.getByTestId("telemetry-range-24h").click();
  await page.waitForURL(/range=24h/);
  expect(new URL(page.url()).searchParams.get("signal")).toBe("traces");
});

test("every old address lands where its content went", async ({ page }) => {
  const moved: Array<[string, string]> = [
    ["logs", "telemetry-signal-logs"],
    ["traces", "telemetry-signal-traces"],
    ["metrics", "telemetry-signal-metrics"],
    ["exceptions", "telemetry-signal-exceptions"],
    ["profiles", "telemetry-signal-profiles"],
    ["rum", "telemetry-signal-rum"],
    ["sql", "telemetry-signal-sql"],
    ["services", "services-tab"],
    ["map", "services-tab"],
    ["connect", "collector-seen"],
    ["slos", "slo-tab"],
  ];
  for (const [tab, marker] of moved) {
    await page.goto(`/app/telemetry?tab=${tab}`);
    await expect(page.locator("text=Application error"), tab).toHaveCount(0);
    await expect(page.getByTestId(marker).first(), tab).toBeVisible();
  }
});
