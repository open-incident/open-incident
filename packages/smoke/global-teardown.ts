import { spawnSync } from "node:child_process";
import { TENANT, THROWAWAY } from "./playwright.config";

/**
 * The throwaway workspace is purged after the run — the same command an
 * operator uses, with its proof: rows counted per table, objects listed. A
 * purge that leaves something behind fails the run.
 */
export default function globalTeardown() {
  if (!THROWAWAY || process.env.SMOKE_KEEP === "1") return;
  const res = spawnSync(
    "pnpm",
    ["--filter", "@openincident/db", "workspace:purge", "--", "--slug", TENANT, "--yes"],
    {
      stdio: "inherit",
      env: { ...process.env, COREPACK_ENABLE_STRICT: "0" },
    },
  );
  if (res.status !== 0)
    throw new Error(`purging the throwaway workspace "${TENANT}" left something behind`);
}
