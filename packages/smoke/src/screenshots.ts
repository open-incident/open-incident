/**
 * Captures the README screenshots from the demo workspace — real screens,
 * real data (Skylark, INC-217), no mock-up. Run against a started instance:
 *
 *   pnpm --filter @openincident/smoke screenshots   (SMOKE_TENANT=skylark is set by the script)
 */
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { BASE_URL, STATUS_BASE_URL } from "../playwright.config";
import { MEMBERS, signIn } from "./helpers";

const OUT = new URL("../../../docs/screenshots/", import.meta.url).pathname;
const SHOTS: Array<{ file: string; path: string; ready?: string }> = [
  { file: "incidents.png", path: "/app/incidents" },
  { file: "incident.png", path: "/app/incidents/217", ready: "[data-testid=ai-summary]" },
  { file: "post-mortem.png", path: "/app/incidents/217?tab=post-incident" },
  { file: "on-call.png", path: "/app/on-call" },
  { file: "alerts.png", path: "/app/alerts" },
  { file: "insights.png", path: "/app/insights?tab=incidents&days=90" },
  { file: "status-page-admin.png", path: "/app/status-pages" },
  { file: "ai-governance.png", path: "/app/settings/ai" },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "en-GB",
  });
  const page = await context.newPage();
  await signIn(page, MEMBERS.owner);
  // The README is English: the captures follow, then the member's setting goes back to the workspace's.
  const setLocale = async (value: string) => {
    await page.goto(`${BASE_URL}/app/account`);
    await page.locator('select[name="locale"]').selectOption(value);
    await page.locator("form button[type=submit]").first().click();
    await page.waitForURL(/saved=1/);
  };
  await setLocale("en");
  for (const shot of SHOTS) {
    await page.goto(`${BASE_URL}${shot.path}`, { waitUntil: "networkidle" });
    if (shot.ready)
      await page
        .locator(shot.ready)
        .first()
        .waitFor({ timeout: 15_000 })
        .catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}${shot.file}` });
    console.log(`  ${shot.file}`);
  }
  await page.goto(STATUS_BASE_URL, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${OUT}status-page.png`, fullPage: false });
  console.log("  status-page.png");
  await setLocale("");
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
