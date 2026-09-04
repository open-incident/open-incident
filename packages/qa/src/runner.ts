/**
 * Runs one suite as a child process, streams its output into the run row,
 * honours a cancellation, and reads the result. Executed by the worker.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import type { QaStatus, QaSummary } from "@openincident/db";
import { qaCapabilities } from "./capabilities";
import { SUITE_DEFINITIONS } from "./suites";
import {
  finishQaRun,
  getQaRun,
  isQaCancelRequested,
  markQaRunning,
  pruneQaRuns,
  writeQaLog,
} from "./store";
import type { QaJob } from "./queue";

const FLUSH_MS = 2_000;

export async function runQaJob(job: QaJob): Promise<void> {
  const run = await getQaRun(job.tenantId, job.runId);
  if (!run || run.status !== "queued") return;
  if (run.cancelRequested) {
    await finishQaRun(job.tenantId, run.id, { status: "cancelled", exitCode: null, summary: {} });
    return;
  }
  const caps = qaCapabilities();
  const def = SUITE_DEFINITIONS[run.suite];
  if (!caps.repoRoot || !caps[def.requires]) {
    await finishQaRun(job.tenantId, run.id, {
      status: "error",
      exitCode: null,
      summary: {
        notes: [
          caps.repoRoot
            ? `The worker's repository at ${caps.repoRoot} lacks what "${run.suite}" needs (${def.requires}).`
            : "The worker does not run from a source checkout: QA needs the repository, its dependencies and a browser.",
        ],
      },
    });
    return;
  }

  const cwd = path.join(caps.repoRoot, def.cwd);
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...def.env(caps, run.id),
    FORCE_COLOR: "0",
    NO_COLOR: "1",
  };
  // A throwaway workspace, never the one the suite is told about by an operator's shell.
  delete env.SMOKE_TENANT;
  const command = `${def.command.join(" ")}  (in ${def.cwd})`;
  await markQaRunning(job.tenantId, run.id, command);

  let log = `$ ${command}\n`;
  let flushed = "";
  // Detached: the child leads its own process group, so a cancellation can
  // signal pnpm AND the tool it spawned, not pnpm alone.
  const child: ChildProcessByStdio<null, Readable, Readable> = spawn(
    def.command[0]!,
    def.command.slice(1),
    { cwd, env, stdio: ["ignore", "pipe", "pipe"] as const, detached: true },
  );
  child.stdout.on("data", (c: Buffer) => (log += c.toString("utf8")));
  child.stderr.on("data", (c: Buffer) => (log += c.toString("utf8")));

  let cancelled = false;
  let timedOut = false;
  const killTree = (signal: NodeJS.Signals) => {
    try {
      // pnpm spawns the real tool as a child: signal the whole group when we can.
      if (child.pid) process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  };
  const ticker = setInterval(async () => {
    if (log !== flushed) {
      flushed = log;
      await writeQaLog(job.tenantId, run.id, log).catch(() => undefined);
    }
    if (!cancelled && (await isQaCancelRequested(job.tenantId, run.id).catch(() => false))) {
      cancelled = true;
      log += "\n[qa] cancellation requested — stopping the process\n";
      killTree("SIGTERM");
      setTimeout(() => killTree("SIGKILL"), 10_000).unref();
    }
  }, FLUSH_MS);
  const timer = setTimeout(() => {
    timedOut = true;
    log += `\n[qa] time limit of ${Math.round(def.timeoutMs / 60_000)} minutes reached — stopping the process\n`;
    killTree("SIGTERM");
    setTimeout(() => killTree("SIGKILL"), 10_000).unref();
  }, def.timeoutMs);

  const exitCode: number | null = await new Promise((resolve) => {
    child.on("error", (err: Error) => {
      log += `\n[qa] could not start: ${err.message}\n`;
      resolve(null);
    });
    child.on("close", (code: number | null) => resolve(code));
  });
  clearInterval(ticker);
  clearTimeout(timer);

  const artifacts: { json?: unknown } = {};
  const jsonFile = env.PLAYWRIGHT_JSON_OUTPUT_FILE;
  if (jsonFile && existsSync(jsonFile)) {
    try {
      artifacts.json = JSON.parse(readFileSync(jsonFile, "utf8"));
    } catch {
      /* the log still tells the story */
    }
    rmSync(jsonFile, { force: true });
  } else if (def.id === "smoke") {
    // Older reporters print the report on stdout instead of a file.
    const start = log.indexOf('{"config"');
    const end = log.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        artifacts.json = JSON.parse(log.slice(start, end + 1));
        log = `${log.slice(0, start)}[qa] JSON report parsed (${end + 1 - start} characters not shown)\n`;
      } catch {
        /* not a report after all */
      }
    }
  }
  let summary: QaSummary;
  try {
    summary = def.parse(log, exitCode, artifacts);
  } catch (err) {
    summary = {
      notes: [
        `The result could not be parsed: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
  if (timedOut) summary.notes = [...(summary.notes ?? []), "Stopped at the time limit."];
  const status: QaStatus = cancelled
    ? "cancelled"
    : exitCode === null
      ? "error"
      : exitCode === 0
        ? "passed"
        : "failed";
  await writeQaLog(job.tenantId, run.id, log).catch(() => undefined);
  await finishQaRun(job.tenantId, run.id, { status, exitCode, summary });
  await pruneQaRuns(job.tenantId).catch(() => undefined);
}
