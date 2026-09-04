/**
 * Where QA can run. The suites are the repository's own — Playwright in
 * packages/smoke, vitest per package, turbo for typecheck, eslint, prettier —
 * so they need the repository, its installed dependencies and a browser on
 * the machine that runs the worker. The web app and the worker share that
 * machine in the setups this is meant for (development, a source checkout);
 * a container built from the standalone image has none of it, and the screen
 * says so.
 */
import { existsSync } from "node:fs";
import path from "node:path";

export type QaCapabilities = {
  repoRoot: string | null;
  playwright: boolean;
  turbo: boolean;
  prettier: boolean;
  eslint: boolean;
  /** Where the smoke suite is told the product answers: host with port. */
  webHost: string;
  statusHost: string;
  mailpitUrl: string;
};

/** Walks up from `from` to the directory holding pnpm-workspace.yaml and packages/smoke. */
export function findRepoRoot(from: string = process.cwd()): string | null {
  let dir = path.resolve(from);
  for (let i = 0; i < 6; i++) {
    if (
      existsSync(path.join(dir, "pnpm-workspace.yaml")) &&
      existsSync(path.join(dir, "packages", "smoke", "package.json"))
    )
      return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function qaCapabilities(): QaCapabilities {
  const repoRoot = findRepoRoot();
  const bin = (rel: string) => (repoRoot ? existsSync(path.join(repoRoot, rel)) : false);
  return {
    repoRoot,
    playwright: bin("packages/smoke/node_modules/.bin/playwright"),
    turbo: bin("node_modules/.bin/turbo"),
    prettier: bin("node_modules/.bin/prettier"),
    eslint: bin("node_modules/.bin/eslint"),
    webHost: process.env.QA_WEB_HOST ?? process.env.BASE_DOMAIN ?? "localhost:3100",
    statusHost:
      process.env.QA_STATUS_HOST ?? process.env.STATUS_BASE_DOMAIN ?? "status.localhost:3107",
    mailpitUrl: process.env.QA_MAILPIT_URL ?? "http://localhost:8027",
  };
}

/** Live checks the screen shows: is the product answering where the suite will look, is Mailpit there. */
export async function probeQaTargets(
  caps: QaCapabilities,
): Promise<{ web: boolean; mailpit: boolean }> {
  const head = async (url: string) => {
    try {
      const res = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(2_000),
        redirect: "manual",
      });
      return res.status > 0 && res.status < 500;
    } catch {
      return false;
    }
  };
  const proto = /localhost|127\.0\.0\.1/.test(caps.webHost) ? "http" : "https";
  const [web, mailpit] = await Promise.all([
    head(`${proto}://${caps.webHost}/login`),
    head(`${caps.mailpitUrl.replace(/\/$/, "")}/api/v1/info`),
  ]);
  return { web, mailpit };
}
