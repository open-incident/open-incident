import { expect, test } from "@playwright/test";
import { MEMBERS, signIn, telemetryInstalled } from "./helpers";

/**
 * The three drawings the explorer opens on, and the rule that picks between
 * two of them.
 *
 * A dot is one trace, so a cloud costs the window: measured on 22 million
 * spans, a day of dots was five seconds and a week was twenty-two. So the
 * cloud is drawn up to six hours and the per-minute bands beyond, and *that
 * switch* is the thing worth a test — it is one comparison away from silently
 * not happening, and the screen it protects is the one people open during an
 * incident.
 *
 * Every drawing is also a zoom: clicking a bar or a half-axis puts an explicit
 * window in the address, which is what makes a spike shareable.
 */
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await signIn(page, MEMBERS.owner);
  test.skip(!(await telemetryInstalled(page)), "no telemetry module on this instance");
});

test("a short window gets dots, a long one gets bands", async ({ page }) => {
  await page.goto("/app/telemetry?tab=explore&signal=traces&range=1h");
  const dots = await page.getByTestId("latency-scatter").count();
  const bands = await page.getByTestId("latency-bands").count();
  // One or the other, never both, and never neither when there are traces.
  if (await page.getByTestId("trace-row").count()) {
    expect(dots + bands).toBe(1);
    expect(dots).toBe(1);
  }

  await page.goto("/app/telemetry?tab=explore&signal=traces&range=7d");
  if (await page.getByTestId("trace-row").count()) {
    await expect(page.getByTestId("latency-bands")).toBeVisible();
    await expect(page.getByTestId("latency-scatter")).toHaveCount(0);
  }
});

test("the log histogram counts by severity and zooms into a bar", async ({ page }) => {
  await page.goto("/app/telemetry?tab=explore&signal=logs&range=24h");
  const histogram = page.getByTestId("log-histogram");
  test.skip((await histogram.count()) === 0, "no logs in this workspace to draw");

  // The severity chips are filters, and clicking one lands in the filter box.
  await page.getByTestId("log-band-error").click();
  await page.waitForURL(/q=/);
  expect(decodeURIComponent(new URL(page.url()).searchParams.get("q") ?? "")).toContain(
    "severity_number",
  );

  // A bar is a window: clicking one puts explicit bounds in the address.
  await page.goto("/app/telemetry?tab=explore&signal=logs&range=24h");
  // A bar, not a chip: both are links inside the histogram, and the chips
  // come first in the markup.
  await page.locator('[data-testid="log-histogram"] svg a').nth(30).click();
  await page.waitForURL(/from=\d+&?/);
  const url = new URL(page.url());
  expect(Number(url.searchParams.get("to"))).toBeGreaterThan(Number(url.searchParams.get("from")));
  // And the zoom says so, with the way out.
  await expect(page.getByTestId("telemetry-zoom")).toBeVisible();
});

test("a metric is one chart, split by a label of its own", async ({ page }) => {
  await page.goto("/app/telemetry?tab=explore&signal=metrics&range=24h");
  const first = page.getByTestId("metric-row").first();
  test.skip((await first.count()) === 0, "no metrics in this workspace");

  await first.click();
  await page.waitForURL(/metric=/);
  await expect(page.getByTestId("metric-lines")).toBeVisible();

  // The split control is built from the metric's own label keys, so there is
  // no fixed one to click: take whichever the chart offers.
  const split = page.locator('[data-testid^="metric-group-"]').nth(1);
  if (await split.count()) {
    await split.click();
    await page.waitForURL(/group=/);
    await expect(page.getByTestId("metric-lines")).toBeVisible();
  }
  await expect(page.locator("text=Application error")).toHaveCount(0);
});
