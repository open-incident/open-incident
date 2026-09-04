import { spawnSync } from "node:child_process";
import { TENANT, THROWAWAY } from "./playwright.config";

/**
 * The suite runs on a throwaway workspace, never on the demo one: a fresh
 * `smoke-<id>` workspace is provisioned and seeded with the demo data before
 * the first test (the sign-in accounts are shared across workspaces and
 * already exist). SMOKE_TENANT=<slug> targets an existing workspace instead.
 */
export default function globalSetup() {
  if (!THROWAWAY) return;
  const started = Date.now();
  const res = spawnSync("pnpm", ["--filter", "@openincident/db", "db:seed"], {
    stdio: "inherit",
    env: { ...process.env, SEED_SLUG: TENANT, COREPACK_ENABLE_STRICT: "0" },
  });
  if (res.status !== 0) throw new Error(`seeding the throwaway workspace "${TENANT}" failed`);
  console.log(
    `[smoke] workspace "${TENANT}" seeded in ${Math.round((Date.now() - started) / 100) / 10} s`,
  );
}
