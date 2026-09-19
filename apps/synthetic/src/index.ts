/**
 * The browser runner — a service of its own, on purpose.
 *
 * Chromium is 400 MB of image and several hundred megabytes of memory per run.
 * Putting it in the worker would make every installation pay for a feature not
 * every installation uses, so it lives here, behind the `synthetic` compose
 * profile, and takes its work from the `synthetic-run` queue.
 *
 * Two things it does besides running journeys:
 *
 *  - it announces itself in Redis, once at start and every twenty seconds
 *    after. That key is the whole of "can this instance do synthetic?" — no
 *    key, and the creation screen greys the type out and says how to start it;
 *  - it writes its results through `applyCheckResult`, the same function the
 *    in-process sweep uses. A synthetic failure becomes a check row, seconds in
 *    the day rollup and, on a state change, an alert posted to the workspace's
 *    own ingest endpoint. One road, whatever the signal.
 */

import { Worker } from "bullmq";
import IORedis from "ioredis";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { and, eq } from "drizzle-orm";
import { chromium, type Browser } from "playwright";
import { monitorSecrets, withTenant } from "@openincident/db";
import { decryptSecret } from "@openincident/crypto";
import { assertStorageConfig, putObject, storageConfigured } from "@openincident/storage";
import {
  SYNTHETIC_DEFAULT_CONCURRENCY,
  SYNTHETIC_HEARTBEAT_MS,
  SYNTHETIC_LIVE_KEY,
  SYNTHETIC_LIVE_TTL_SECONDS,
  SYNTHETIC_MAX_CONCURRENCY,
  SYNTHETIC_QUEUE,
  applyCheckResult,
  type CheckSample,
  type SyntheticJob,
  type SyntheticLiveness,
} from "@openincident/oncall";
import { playJourney } from "./journey";

// A partial S3_* set is a mistake to stop on, not to discover at the first
// failed journey — which is exactly the moment nobody wants a second failure.
assertStorageConfig();

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6381";

/**
 * How many journeys play at once. A browser is expensive: two contexts is the
 * default because two is what a one-CPU container survives, and eight is the
 * ceiling because past it the runs slow each other down and every monitor
 * starts reporting a latency that is the queue's, not the site's.
 */
const CONCURRENCY = Math.min(
  SYNTHETIC_MAX_CONCURRENCY,
  Math.max(1, Number(process.env.SYNTHETIC_CONCURRENCY ?? SYNTHETIC_DEFAULT_CONCURRENCY)),
);

const RUNNER_ID = process.env.SYNTHETIC_RUNNER_ID ?? `${process.env.HOSTNAME ?? "local"}`;

const connection = new IORedis(REDIS_URL, {
  // Required by BullMQ: commands must not be dropped during a reconnection.
  maxRetriesPerRequest: null,
});

/* ---------- One browser, many contexts ---------- */

let browser: Browser | null = null;

/**
 * Chromium is launched once and kept: starting it costs about a second, and a
 * monitor's latency should measure the site, not our start-up. Each journey
 * still gets its own context, so no cookie and no storage crosses from one run
 * to the next.
 */
async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({
    args: [
      // A container has a small /dev/shm; Chromium writes its shared memory to
      // /tmp instead rather than crashing halfway through a page.
      "--disable-dev-shm-usage",
    ],
  });
  return browser;
}

/* ---------- Credentials ---------- */

/**
 * The monitor's credentials, decrypted here and nowhere else.
 *
 * They are read at run time rather than carried on the job: a BullMQ payload
 * sits in Redis in clear, and a password in a queue is a password in a backup.
 */
async function secretsFor(tenantId: string, monitorId: string): Promise<Record<string, string>> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ name: monitorSecrets.name, value: monitorSecrets.encryptedValue })
      .from(monitorSecrets)
      .where(and(eq(monitorSecrets.tenantId, tenantId), eq(monitorSecrets.monitorId, monitorId))),
  );
  const out: Record<string, string> = {};
  for (const row of rows) {
    const value = decryptSecret(row.value);
    // An unreadable credential (the key changed) is left out on purpose: the
    // step then fails with "this monitor does not carry NAME", which is the
    // truth, instead of typing an empty string and failing on the next page.
    if (value !== null) out[row.name] = value;
  }
  return out;
}

/* ---------- Running one job ---------- */

async function runOne(job: SyntheticJob): Promise<void> {
  const secrets = await secretsFor(job.tenantId, job.monitorId);
  const { result, screenshot } = await playJourney(await getBrowser(), job, secrets);
  result.runner = RUNNER_ID;

  // A screenshot that was not taken is not linked, and one that could not be
  // stored is not claimed: the key is written only once the object is there.
  if (screenshot && storageConfigured()) {
    const key = `tenants/${job.tenantId}/monitors/${job.monitorId}/${randomUUID()}.png`;
    try {
      await putObject(key, screenshot, "image/png", "private, max-age=0");
      result.screenshotKey = key;
    } catch (err) {
      console.error(
        `[synthetic] screenshot not stored for ${job.monitorId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const done = result.steps.filter((s) => s.outcome === "passed").length;
  const sample: CheckSample = {
    reachable: result.ok,
    latencyMs: result.totalMs,
    detail: result.ok
      ? `${done}/${result.steps.length} steps · ${result.totalMs} ms`
      : `step ${(result.failedStep?.index ?? 0) + 1} — ${result.failedStep?.label}: ${result.failedStep?.error}`,
  };

  const outcome = await applyCheckResult(job.tenantId, job.monitorId, sample, { result });
  if (!outcome) {
    console.warn(`[synthetic] ${job.monitorId} disappeared while its journey was running`);
    return;
  }
  console.log(
    `[synthetic] ${job.monitorName}: ${outcome.state} · ${done}/${result.steps.length} steps · ${result.totalMs} ms${
      outcome.published ? " · alert published" : ""
    }`,
  );
}

const worker = new Worker(
  SYNTHETIC_QUEUE,
  async (job) => runOne(job.data as SyntheticJob),
  // A journey may legitimately take minutes; the lock has to outlive the
  // budget or BullMQ would hand the same job to a second runner mid-run.
  { connection, concurrency: CONCURRENCY, lockDuration: 360_000 },
);

worker.on("failed", (job, err) => {
  console.error(`[synthetic] job ${job?.id} failed:`, err.message);
});

/* ---------- Announcing itself ---------- */

// The runner's Playwright version, read from the package rather than written
// down here: a diagnostics screen that reports the wrong version is worse than
// one that reports none.
const playwrightVersion = (
  createRequire(import.meta.url)("playwright/package.json") as { version: string }
).version;

const liveness: SyntheticLiveness = {
  version: `playwright ${playwrightVersion}`,
  concurrency: CONCURRENCY,
  startedAt: new Date().toISOString(),
};

async function announce(): Promise<void> {
  try {
    await connection.set(
      SYNTHETIC_LIVE_KEY,
      JSON.stringify(liveness),
      "EX",
      SYNTHETIC_LIVE_TTL_SECONDS,
    );
  } catch (err) {
    console.error("[synthetic] could not announce:", err instanceof Error ? err.message : err);
  }
}

await announce();
const beat = setInterval(announce, SYNTHETIC_HEARTBEAT_MS);

console.log(
  `Open Incident synthetic runner started — queue ${SYNTHETIC_QUEUE}, ${CONCURRENCY} journey(s) at once`,
);

async function shutdown() {
  console.log("Stopping the synthetic runner…");
  clearInterval(beat);
  // The key goes with the process: the creation screen says "not on this
  // instance" a second later rather than a minute later.
  await connection.del(SYNTHETIC_LIVE_KEY).catch(() => {});
  await worker.close();
  await browser?.close().catch(() => {});
  await connection.quit();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
