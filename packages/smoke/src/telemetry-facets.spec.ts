import { expect, test } from "@playwright/test";
import { MEMBERS, signIn, telemetryInstalled } from "./helpers";

/**
 * The facet rail — what is in the window, before anybody knows what to filter
 * on.
 *
 * The one property worth a test is where a click lands: in the filter box. A
 * rail that kept its own selection would be a second description of what is on
 * screen, and the filter expression would stop being the thing you can read,
 * edit, save as a monitor and paste to a colleague.
 *
 * It needs rows to count, so it skips on a workspace with none rather than
 * asserting against an empty window — which is the honest state of a fresh
 * instance, not a failure.
 */
test("a facet click becomes a term in the filter box", async ({ page }) => {
  await signIn(page, MEMBERS.owner);
  test.skip(!(await telemetryInstalled(page)), "no telemetry module on this instance");

  await page.goto("/app/telemetry?tab=explore&signal=traces&range=7d");
  const rail = page.getByTestId("facet-rail");
  test.skip((await rail.count()) === 0, "no spans in this workspace to count");

  const first = page.getByTestId("facet-value").first();
  const value = (await first.innerText()).split("\n")[0]!.trim();
  await first.click();
  await page.waitForURL(/q=/);

  const filter = new URL(page.url()).searchParams.get("q") ?? "";
  expect(filter).toContain(value);
  // And the rail recounts against the narrowed window rather than going away.
  await expect(page.getByTestId("facet-rail")).toBeVisible();
  await expect(page.locator("text=Application error")).toHaveCount(0);
});
