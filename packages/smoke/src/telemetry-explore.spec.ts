import { expect, test } from "@playwright/test";
import { MEMBERS, signIn, telemetryInstalled } from "./helpers";

/**
 * Telemetry, as one row of views rather than eleven tabs.
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

test("one row of navigation carries every view, and the rail no longer carries dashboards", async ({
  page,
}) => {
  await page.goto("/app/telemetry");
  for (const tab of ["overview", "dashboards", "slos", "setup"]) {
    await expect(page.getByTestId(`telemetry-tab-${tab}`)).toBeVisible();
  }
  for (const signal of ["logs", "traces", "metrics", "exceptions", "profiles", "rum", "sql"]) {
    await expect(page.getByTestId(`telemetry-signal-${signal}`)).toBeVisible();
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

/*
 * The explorers read like Sumo Logic's: a log line opens in place and every
 * field in it narrows or excludes in one click; a trace list has its two
 * standing questions as toggles, and a trace opens on its own page with a way
 * back. Each gesture writes the filter, never a state of its own — the filter
 * stays the one description of what is on screen.
 */
test("a field of an opened log line becomes a term, kept or excluded", async ({ page }) => {
  await page.goto("/app/telemetry?tab=explore&signal=logs&range=24h");
  const row = page.getByTestId("log-row").first();
  test.skip((await row.count()) === 0, "no log lines in this workspace");
  await row.locator("summary").click();
  const service = row.getByTestId("field-row").filter({ hasText: "service_name" });
  await expect(service).toBeVisible();

  await service.getByTestId("field-exclude").click();
  await page.waitForURL(/q=/);
  expect(new URL(page.url()).searchParams.get("q")).toMatch(/^NOT service_name = '/);

  await page.goto("/app/telemetry?tab=explore&signal=logs&range=24h");
  await page.getByTestId("log-row").first().locator("summary").click();
  await page
    .getByTestId("log-row")
    .first()
    .getByTestId("field-row")
    .filter({ hasText: "service_name" })
    .getByTestId("field-keep")
    .click();
  await page.waitForURL(/q=/);
  const kept = new URL(page.url()).searchParams.get("q") ?? "";
  expect(kept).toMatch(/^service_name = '/);
  // Every line left is that service's.
  const value = kept.match(/'(.*)'/)![1]!;
  const services = await page.getByTestId("log-row").locator("summary").allInnerTexts();
  expect(services.length).toBeGreaterThan(0);
  for (const text of services) expect(text).toContain(value);
});

test("the trace list's quick filters, and a trace on its own page", async ({ page }) => {
  await page.goto("/app/telemetry?tab=explore&signal=traces&range=24h");
  test.skip((await page.getByTestId("trace-row").count()) === 0, "no traces in this workspace");

  const errors = page.getByTestId("traces-quick-errors");
  await expect(errors).toHaveAttribute("aria-pressed", "false");
  await errors.click();
  await page.waitForURL(/q=/);
  expect(new URL(page.url()).searchParams.get("q")).toBe("status_code = 'error'");
  await expect(page.getByTestId("traces-quick-errors")).toHaveAttribute("aria-pressed", "true");
  // A second click takes the term back out.
  await page.getByTestId("traces-quick-errors").click();
  await page.waitForURL((u) => !u.searchParams.has("q"));

  await page.getByTestId("trace-row").first().click();
  await page.waitForURL(/trace=/);
  await expect(page.getByTestId("trace-view")).toBeVisible();
  // The list steps aside for the waterfall, and comes back with the window intact.
  await expect(page.getByTestId("trace-row")).toHaveCount(0);
  await page.getByTestId("trace-back").click();
  await page.waitForURL((u) => !u.searchParams.has("trace"));
  expect(new URL(page.url()).searchParams.get("range")).toBe("24h");
  await expect(page.getByTestId("trace-row").first()).toBeVisible();
});

test("an empty window says where the data is, and goes there", async ({ page }) => {
  // A window a year back, where nothing was ever sent.
  const from = Date.now() - 400 * 86_400_000;
  await page.goto(`/app/telemetry?tab=explore&signal=logs&from=${from}&to=${from + 3_600_000}`);
  await expect(page.getByTestId("explorer-empty")).toBeVisible();
  const go = page.getByTestId("explorer-show-latest");
  test.skip((await go.count()) === 0, "no log line at all in this workspace");
  await go.click();
  await page.waitForURL((u) => Number(u.searchParams.get("from")) > from);
  await expect(page.getByTestId("log-row").first()).toBeVisible();
});
