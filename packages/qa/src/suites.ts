/**
 * The five suites, exactly as a developer runs them from the repository:
 * what to spawn, where, with which environment, and how to read the output.
 * Nothing is reimplemented here — the same Playwright, vitest, tsc, eslint
 * and prettier, the same configurations.
 */
import path from "node:path";
import type { QaSuite, QaSummary } from "@openincident/db";
import type { QaCapabilities } from "./capabilities";

export const QA_SUITES: readonly QaSuite[] = ["smoke", "unit", "typecheck", "lint", "format"];

export type SuiteDefinition = {
  id: QaSuite;
  /** Argument vector; the first item is the executable. */
  command: string[];
  /** Relative to the repository root. */
  cwd: string;
  timeoutMs: number;
  /** Which capability must be present. */
  requires: keyof Pick<QaCapabilities, "playwright" | "turbo" | "prettier" | "eslint">;
  env: (caps: QaCapabilities, runId: string) => Record<string, string>;
  parse: (log: string, exitCode: number | null, artifacts: { json?: unknown }) => QaSummary;
};

const portOf = (host: string) => host.split(":")[1] ?? (host.includes("localhost") ? "80" : "443");

/** Playwright's JSON report as the parser needs it. */
type PwReport = {
  stats?: { expected?: number; unexpected?: number; flaky?: number; skipped?: number };
  suites?: PwSuite[];
};
type PwSuite = { title: string; file?: string; suites?: PwSuite[]; specs?: PwSpec[] };
type PwSpec = {
  title: string;
  file?: string;
  line?: number;
  ok?: boolean;
  tests?: Array<{
    status?: string;
    results?: Array<{ status?: string; error?: { message?: string } }>;
  }>;
};

function playwrightFailures(report: PwReport): QaSummary["failures"] {
  const out: NonNullable<QaSummary["failures"]> = [];
  const walk = (suite: PwSuite, trail: string[]) => {
    for (const spec of suite.specs ?? []) {
      const failed = spec.tests?.some((t) => t.status === "unexpected" || t.status === "flaky");
      if (!failed) continue;
      const result = spec.tests?.flatMap((t) => t.results ?? []).find((r) => r.status !== "passed");
      out.push({
        title: [...trail, spec.title].filter(Boolean).join(" › "),
        location: spec.file ? `${spec.file}${spec.line ? `:${spec.line}` : ""}` : undefined,
        message: result?.error?.message?.split("\n").slice(0, 3).join(" ").slice(0, 400),
      });
    }
    for (const child of suite.suites ?? []) walk(child, [...trail, child.title]);
  };
  for (const s of report.suites ?? []) walk(s, [s.title]);
  return out;
}

function turboTasks(log: string): { done: number; total: number } | null {
  const m = log.match(/Tasks:\s+(\d+) successful,\s+(\d+) total/);
  return m ? { done: Number(m[1]), total: Number(m[2]) } : null;
}

export const SUITE_DEFINITIONS: Record<QaSuite, SuiteDefinition> = {
  smoke: {
    id: "smoke",
    command: ["pnpm", "exec", "playwright", "test", "--reporter=json"],
    cwd: "packages/smoke",
    timeoutMs: 45 * 60_000,
    requires: "playwright",
    env: (caps, runId) => {
      const file = path.join(
        caps.repoRoot ?? ".",
        "packages/smoke/test-results",
        `qa-${runId}.json`,
      );
      return {
        SMOKE_HOST: caps.webHost,
        SMOKE_PORT: portOf(caps.webHost),
        SMOKE_STATUS_PORT: portOf(caps.statusHost),
        SMOKE_MAILPIT_URL: caps.mailpitUrl,
        // Both names: the older and the newer Playwright spell it differently.
        PLAYWRIGHT_JSON_OUTPUT_NAME: file,
        PLAYWRIGHT_JSON_OUTPUT_FILE: file,
      };
    },
    parse: (log, exitCode, artifacts) => {
      const report = (artifacts.json ?? null) as PwReport | null;
      if (report?.stats) {
        const { expected = 0, unexpected = 0, flaky = 0, skipped = 0 } = report.stats;
        return {
          total: expected + unexpected + flaky + skipped,
          passed: expected,
          failed: unexpected,
          flaky,
          skipped,
          failures: playwrightFailures(report),
        };
      }
      const m = log.match(/(\d+) passed/);
      const f = log.match(/(\d+) failed/);
      return {
        passed: m ? Number(m[1]) : undefined,
        failed: f ? Number(f[1]) : exitCode === 0 ? 0 : undefined,
        notes: report ? [] : ["No JSON report was produced; counts read from the log."],
      };
    },
  },
  unit: {
    id: "unit",
    command: ["pnpm", "test"],
    cwd: ".",
    timeoutMs: 20 * 60_000,
    requires: "turbo",
    env: () => ({ CI: "1", COREPACK_ENABLE_STRICT: "0" }),
    parse: (log, exitCode) => {
      let passed = 0;
      let failed = 0;
      const notes: string[] = [];
      for (const m of log.matchAll(
        /^(@openincident\/[\w-]+):test:\s+Tests\s+(?:(\d+) failed \| )?(\d+) passed/gm,
      )) {
        failed += Number(m[2] ?? 0);
        passed += Number(m[3]);
        notes.push(`${m[1]}: ${m[3]} passed${m[2] ? `, ${m[2]} failed` : ""}`);
      }
      const failures = [
        ...log.matchAll(/^(@openincident\/[\w-]+):test:\s+(?:FAIL|×)\s+(.*)$/gm),
      ].map((m) => ({
        title: m[2]!.trim().slice(0, 200),
        location: m[1],
      }));
      const tasks = turboTasks(log);
      if (tasks) notes.unshift(`${tasks.done} of ${tasks.total} package tasks succeeded`);
      return {
        total: passed + failed,
        passed,
        failed: failed || (exitCode === 0 ? 0 : failures.length || undefined),
        failures,
        notes,
      };
    },
  },
  typecheck: {
    id: "typecheck",
    command: ["pnpm", "typecheck"],
    cwd: ".",
    timeoutMs: 20 * 60_000,
    requires: "turbo",
    env: () => ({ COREPACK_ENABLE_STRICT: "0" }),
    parse: (log, exitCode) => {
      const errors = [
        ...log.matchAll(
          /^(?:@openincident\/[\w-]+:typecheck:\s+)?(.+\.tsx?)\((\d+),(\d+)\): error (TS\d+): (.*)$/gm,
        ),
      ].map((m) => ({ title: `${m[4]} ${m[5]!.slice(0, 200)}`, location: `${m[1]}:${m[2]}` }));
      const tasks = turboTasks(log);
      return {
        total: tasks?.total,
        passed: tasks?.done,
        failed: tasks ? tasks.total - tasks.done : exitCode === 0 ? 0 : undefined,
        failures: errors,
        notes: tasks ? [`${tasks.done} of ${tasks.total} package tasks succeeded`] : [],
      };
    },
  },
  lint: {
    id: "lint",
    command: ["pnpm", "lint"],
    cwd: ".",
    timeoutMs: 15 * 60_000,
    requires: "eslint",
    env: () => ({ COREPACK_ENABLE_STRICT: "0" }),
    parse: (log, exitCode) => {
      const failures: NonNullable<QaSummary["failures"]> = [];
      let file = "";
      for (const line of log.split("\n")) {
        if (/^\/.+\.(ts|tsx|mjs|js)$/.test(line.trim())) file = line.trim();
        const m = line.match(/^\s+(\d+):(\d+)\s+(error|warning)\s+(.*?)\s{2,}(\S+)$/);
        if (m && m[3] === "error")
          failures.push({ title: `${m[5]}: ${m[4]}`, location: `${file}:${m[1]}` });
      }
      const problems = log.match(/✖ (\d+) problems? \((\d+) errors?, (\d+) warnings?\)/);
      return {
        failed: problems ? Number(problems[2]) : exitCode === 0 ? 0 : failures.length || undefined,
        failures,
        notes: problems
          ? [`${problems[3]} warning(s)`]
          : exitCode === 0
            ? ["No lint problem."]
            : [],
      };
    },
  },
  format: {
    id: "format",
    command: ["pnpm", "exec", "prettier", "--check", "."],
    cwd: ".",
    timeoutMs: 10 * 60_000,
    requires: "prettier",
    env: () => ({}),
    parse: (log, exitCode) => {
      const failures = [...log.matchAll(/^\[warn\] (?!Code style issues)(\S.*)$/gm)].map((m) => ({
        title: "Not formatted",
        location: m[1]!.trim(),
      }));
      return {
        failed: exitCode === 0 ? 0 : failures.length || undefined,
        failures,
        notes: exitCode === 0 ? ["Every file is formatted."] : [],
      };
    },
  },
};
