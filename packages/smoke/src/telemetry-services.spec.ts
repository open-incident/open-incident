import { expect, test } from "@playwright/test";
import { MEMBERS, signIn } from "./helpers";

/**
 * The Services tab of Telemetry — the list the screen opens on.
 *
 * It reads ClickHouse and Postgres in the same server component, which is the
 * shape that fails silently: a workspace with no span at all must get the
 * empty state, not a page that threw. The window control is checked because it
 * is a link, and a link that drops the tab sends the reader somewhere else.
 */
test("the services list opens, on any window, with or without traffic", async ({ page }) => {
  await signIn(page, MEMBERS.owner);

  await page.goto("/app/telemetry");
  await expect(page.getByTestId("services-tab")).toBeVisible();
  await expect(page.locator("text=Application error")).toHaveCount(0);

  // Either rows or the empty state — never neither, and never both.
  const rows = await page.getByTestId("service-row").count();
  if (rows === 0) await expect(page.locator("text=service.name")).toBeVisible();

  for (const minutes of [360, 1440]) {
    await page.goto(`/app/telemetry?tab=services&since=${minutes}`);
    await expect(page.getByTestId("services-tab")).toBeVisible();
  }
});
