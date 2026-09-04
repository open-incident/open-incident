import { defineConfig } from "@playwright/test";

/**
 * Open Incident end-to-end smoke test.
 *
 * It does not test functions: it replays the product's journeys against an
 * instance that really runs, with its database, its SMTP and its sessions.
 *
 * THREE THINGS MUST BE TRUE BEFORE RUNNING:
 *  1. docker compose -f docker/docker-compose.yml up -d   (Postgres, Redis, Mailpit)
 *  2. the database is migrated, under RLS, and the demo accounts exist
 *     (pnpm db:migrate && pnpm db:rls && pnpm db:seed && pnpm db:seed:auth);
 *     the suite then seeds its own throwaway workspace and purges it after
 *  3. the server runs with a BASE_DOMAIN that MATCHES its port:
 *       BASE_DOMAIN=localhost:3106 pnpm --filter @openincident/web exec next start --port 3106
 *     Without that match, the middleware resolves no workspace and everything
 *     answers 404 — the first pitfall of the local environment.
 *
 * The browser is the Chrome installed on the machine (`channel: "chrome"`).
 */

const PORT = process.env.SMOKE_PORT ?? "3106";
export const HOST = process.env.SMOKE_HOST ?? `localhost:${PORT}`;
/**
 * The workspace under test. By default a throwaway one, named once here and
 * pinned in the environment so every worker process agrees, seeded by
 * global-setup and purged by global-teardown. SMOKE_TENANT=skylark (or any
 * existing slug) runs against that workspace and leaves it in place.
 */
export const THROWAWAY = !process.env.SMOKE_TENANT;
process.env.SMOKE_TENANT ??= `smoke-${Date.now().toString(36)}`;
export const TENANT = process.env.SMOKE_TENANT;

/** The app is served by subdomain: the workspace is part of the address. */
export const BASE_URL = process.env.SMOKE_BASE_URL ?? `http://${TENANT}.${HOST}`;
/** The public status page of the demo workspace, served by apps/status (port 3107). */
export const STATUS_BASE_URL =
  process.env.SMOKE_STATUS_BASE_URL ??
  `http://${TENANT}.status.localhost:${process.env.SMOKE_STATUS_PORT ?? "3107"}`;
/** Mailpit's web interface — this is where the reset and invitation links arrive. */
export const MAILPIT_URL = process.env.SMOKE_MAILPIT_URL ?? "http://localhost:8027";

export default defineConfig({
  testDir: "./src",
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  // Sign-in is rate-limited per IP and replayed with back-off (helpers.signIn):
  // a test that lands on the 429 needs more than the default half-minute.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    channel: "chrome",
    headless: !process.env.SMOKE_HEADED,
    locale: "fr-FR",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
});
