/**
 * Captures the user guide's illustrations from the demo workspace — real
 * screens over real rows, no mock-up. Run against a started instance with the
 * enterprise entitlements on (OI_ENTITLEMENTS=sso,customRoles):
 *
 *   pnpm --filter @openincident/smoke guide-shots   (SMOKE_TENANT=skylark)
 *
 * Enterprise screens are captured with sample objects created for the shot
 * and removed afterwards; the demo workspace is left as it was found.
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import { BASE_URL, STATUS_BASE_URL } from "../playwright.config";
import { MEMBERS, signIn, signOut } from "./helpers";
import { startOidcMock } from "./oidc-mock";

const OUT = new URL("../../../docs/guide/img/", import.meta.url).pathname;

type Shot = {
  file: string;
  path?: string;
  ready?: string;
  /** Interactions before the capture (open a dialog…). */
  act?: (page: Page) => Promise<void>;
  fullPage?: boolean;
};

/** SHOTS_ONLY=guide.png,login.png recaptures a few files without the whole run. */
const ONLY = process.env.SHOTS_ONLY?.split(",")
  .map((f) => f.trim())
  .filter(Boolean);
const wants = (file: string) => !ONLY || ONLY.includes(file);

async function shoot(page: Page, shot: Shot) {
  if (!wants(shot.file)) return;
  if (shot.path) await page.goto(`${BASE_URL}${shot.path}`, { waitUntil: "networkidle" });
  if (shot.ready)
    await page
      .locator(shot.ready)
      .first()
      .waitFor({ timeout: 15_000 })
      .catch(() => {});
  if (shot.act) await shot.act(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}${shot.file}`, fullPage: shot.fullPage ?? false });
  console.log(`  ${shot.file}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const idp = await startOidcMock();
  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "en-GB",
  });
  const page = await context.newPage();

  // The sign-in page before any session.
  await shoot(page, { file: "login.png", path: "/login" });

  await signIn(page, MEMBERS.owner);
  const setLocale = async (value: string) => {
    await page.goto(`${BASE_URL}/app/account`);
    await page.locator('select[name="locale"]').selectOption(value);
    await page.locator("form button[type=submit]").first().click();
    await page.waitForURL(/saved=1/);
  };
  await setLocale("en");

  const shots: Shot[] = [
    { file: "shell-incidents.png", path: "/app/incidents" },
    { file: "incidents-triage.png", path: "/app/incidents?view=triage" },
    { file: "incidents-declare.png", path: "/app/incidents/new" },
    { file: "incident-detail.png", path: "/app/incidents/217", ready: "[data-testid=ai-summary]" },
    {
      file: "incident-update-dialog.png",
      path: "/app/incidents/217",
      act: async (p) => {
        await p
          .getByRole("button", { name: /Share an update/ })
          .first()
          .click();
        await p.getByRole("dialog").waitFor();
      },
    },
    {
      file: "incident-escalate-dialog.png",
      path: "/app/incidents/217",
      act: async (p) => {
        await p
          .getByRole("button", { name: /^Escalate$/ })
          .first()
          .click();
        await p.getByRole("dialog").waitFor();
      },
    },
    { file: "incident-followups.png", path: "/app/incidents/217?tab=follow-ups" },
    { file: "incident-post-incident.png", path: "/app/incidents/217?tab=post-incident" },
    {
      file: "command-palette.png",
      path: "/app/incidents",
      act: async (p) => {
        await p.keyboard.press("Meta+k");
        await p.waitForTimeout(300);
      },
    },
    { file: "alerts-list.png", path: "/app/alerts" },
    {
      file: "alert-detail.png",
      path: "/app/alerts",
      act: async (p) => {
        await p.locator("a[href^='/app/alerts/']").first().click();
        await p.waitForURL(/\/app\/alerts\/[0-9a-f-]+/);
        await p.waitForLoadState("networkidle");
      },
    },
    { file: "oncall-schedule.png", path: "/app/on-call" },
    { file: "oncall-paths.png", path: "/app/on-call/paths" },
    { file: "oncall-notifications.png", path: "/app/on-call/notifications" },
    { file: "catalog.png", path: "/app/catalog?type=service&entry=checkout-api" },
    {
      file: "catalog-entry-dialog.png",
      path: "/app/catalog?type=service",
      act: async (p) => {
        await p.getByTestId("entry-open").click();
        await p.getByTestId("entry-form").waitFor();
      },
    },
    {
      file: "catalog-type-dialog.png",
      path: "/app/catalog",
      act: async (p) => {
        await p.getByTestId("type-open").click();
        await p.getByTestId("type-form").waitFor();
        await p.getByTestId("type-form").locator('input[name="name"]').fill("Squads");
        await p.getByTestId("attr-add").click();
        await p.getByTestId("attr-row").first().locator("input").first().fill("Lead");
      },
    },
    {
      file: "catalog-import-dialog.png",
      path: "/app/catalog?type=service",
      act: async (p) => {
        await p.getByTestId("import-open").click();
        await p.getByTestId("import-form").waitFor();
      },
    },
    { file: "status-pages-admin.png", path: "/app/status-pages" },
    { file: "insights-incidents.png", path: "/app/insights?tab=incidents&days=90" },
    { file: "insights-alerts.png", path: "/app/insights?tab=alerts&days=90" },
    { file: "insights-pager.png", path: "/app/insights?tab=pager&days=90" },
    { file: "insights-followups.png", path: "/app/insights?tab=followups&days=90" },
    { file: "insights-pay.png", path: "/app/insights?tab=pay" },
    { file: "account.png", path: "/app/account" },
    { file: "settings-general.png", path: "/app/settings/general" },
    { file: "settings-members.png", path: "/app/settings/members" },
    { file: "settings-working-hours.png", path: "/app/settings/working-hours" },
    { file: "settings-types.png", path: "/app/settings/types" },
    { file: "settings-fields.png", path: "/app/settings/fields" },
    { file: "settings-announcements.png", path: "/app/settings/announcements" },
    { file: "settings-post-incident.png", path: "/app/settings/post-incident" },
    { file: "settings-alert-sources.png", path: "/app/settings/alert-sources" },
    { file: "settings-routes.png", path: "/app/settings/alert-routes" },
    { file: "settings-priorities.png", path: "/app/settings/alert-priorities" },
    { file: "settings-heartbeats.png", path: "/app/settings/heartbeats" },
    { file: "settings-integrations.png", path: "/app/settings/integrations" },
    { file: "settings-api.png", path: "/app/settings/api" },
    { file: "settings-ai.png", path: "/app/settings/ai" },
    { file: "settings-audit.png", path: "/app/settings/audit" },
    { file: "settings-qa.png", path: "/app/settings/qa" },
  ];
  for (const shot of shots) {
    try {
      await shoot(page, shot);
    } catch (err) {
      console.error(`  ! ${shot.file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Enterprise screens: sample objects created for the capture, then removed
  // (the SCIM endpoint, which has no removal, is left disabled).
  if (wants("settings-sso.png")) {
    await page.goto(`${BASE_URL}/app/settings/sso`);
    await page.getByTestId("sso-add").click();
    const form = page.getByTestId("sso-form");
    await form.locator('input[name="label"]').fill("Okta");
    await form.locator('input[name="domains"]').fill("acme.example");
    await form.locator('input[name="issuer"]').fill(idp.issuer);
    await form.locator('input[name="clientId"]').fill("0oa1b2c3d4e5f6g7h8i9");
    await form.locator('input[name="clientSecret"]').fill("secret-for-the-screenshot");
    await page.getByTestId("sso-save").click();
    await page.waitForURL(/saved=1/);
    await shoot(page, { file: "settings-sso.png", path: "/app/settings/sso" });
    await page.getByTestId("sso-remove").first().click();
    await page.waitForURL(/removed=1/);
  }

  if (wants("settings-scim.png")) {
    await page.goto(`${BASE_URL}/app/settings/scim`);
    const hadScim = (await page.getByTestId("scim-toggle").count()) > 0;
    if (!hadScim) {
      await page.getByTestId("scim-issue").click();
      await page.getByTestId("scim-token").waitFor();
    }
    await shoot(page, { file: "settings-scim.png" });
    if (!hadScim) {
      await page.getByTestId("scim-toggle").click();
      await page
        .getByTestId("scim-state")
        .filter({ hasText: /Disabled/ })
        .waitFor();
    }

    await page.goto(`${BASE_URL}/app/settings/roles`);
    await page.getByTestId("role-add").click();
    const roleForm = page.getByTestId("role-form");
    await roleForm.locator('input[name="name"]').fill("Alerting admin");
    await roleForm
      .locator('input[name="description"]')
      .fill("Tunes routes and sources; runs incidents.");
    await roleForm.locator('input[value="incidents.respond"]').check();
    await roleForm.locator('input[value="catalog.entries"]').check();
    await roleForm.locator('input[value="settings.alerting"]').check();
    await page.getByTestId("role-save").click();
    await page.waitForURL(/saved=1/);
    await shoot(page, { file: "settings-roles.png", path: "/app/settings/roles" });
    await page
      .getByTestId("role-row")
      .filter({ hasText: "Alerting admin" })
      .getByTestId("role-remove")
      .click();
    await page.waitForURL(/removed=1/);
  }

  // The guide itself, and the public status page.
  await shoot(page, { file: "guide.png", path: "/app/docs/incidents" });
  if (wants("status-page-public.png")) {
    await page.goto(STATUS_BASE_URL, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${OUT}status-page-public.png` });
    console.log("  status-page-public.png");
  }

  await setLocale("");
  await signOut(page);
  idp.server.close();
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
