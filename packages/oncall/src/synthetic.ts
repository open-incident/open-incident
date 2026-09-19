/**
 * Synthetic monitors — the queue, and the key the runner keeps alive.
 *
 * Separate from `synthetic-steps.ts` because that file is read by a client
 * component: everything here touches Redis, and nothing here may be imported
 * from a browser bundle. The re-export below keeps the server side reading one
 * module.
 */

import { Queue } from "bullmq";
import IORedis from "ioredis";
import { SYNTHETIC_LIVE_KEY, type SyntheticLiveness, type SyntheticStep } from "./synthetic-steps";

export * from "./synthetic-steps";

export const SYNTHETIC_QUEUE = "synthetic-run";

/** One job: a monitor, its steps, its budget. Never its credentials. */
export type SyntheticJob = {
  tenantId: string;
  monitorId: string;
  monitorName: string;
  steps: SyntheticStep[];
  budgetMs: number;
  viewport: { width: number; height: number };
  /** Whose turn it was: the sweep's, or a person pressing "run now". */
  trigger: "sweep" | "manual";
};

/**
 * Two sockets, on purpose.
 *
 * BullMQ owns one and reconnects it itself. The liveness read owns the other,
 * opened lazily and AWAITED before its first command: with the offline queue
 * off — which it must be, or a page render would hang on a dead Redis — a GET
 * issued in the same tick as the connection is refused outright, and "no
 * runner on this instance" is exactly the wrong answer to give because a
 * socket had not finished opening. That mistake cost a whole verification run.
 */
let queueRedis: IORedis | null = null;
function queueConnection(): IORedis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!queueRedis) {
    queueRedis = new IORedis(url, { maxRetriesPerRequest: null });
    // BullMQ reconnects on its own; an unhandled error event would take the
    // process down for a blip the queue already survives.
    queueRedis.on("error", () => {});
  }
  return queueRedis;
}

let liveRedis: IORedis | null = null;
let liveReady: Promise<IORedis | null> | null = null;
async function liveConnection(): Promise<IORedis | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!liveRedis) {
    liveRedis = new IORedis(url, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 3_000,
    });
    liveRedis.on("error", () => {});
  }
  if (liveRedis.status === "ready") return liveRedis;
  liveReady ??= liveRedis
    .connect()
    .then(() => liveRedis)
    .catch(() => null);
  return liveReady;
}

let queue: Queue | null = null;
function getQueue(): Queue | null {
  const conn = queueConnection();
  if (!conn) return null;
  queue ??= new Queue(SYNTHETIC_QUEUE, {
    connection: conn,
    defaultJobOptions: {
      // A browser run is not retried: the next interval is the retry, and a
      // journey replayed three times on a failure is three times the cost for
      // the same answer.
      attempts: 1,
      // Removed on both outcomes, because the job id is the monitor's: a
      // completed job kept in Redis under that id would make the next run a
      // duplicate BullMQ silently drops. The check row is the history.
      removeOnComplete: true,
      removeOnFail: true,
    },
  });
  return queue;
}

/** Bounds a promise, so a screen never waits on Redis longer than it should. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/**
 * True when a runner has announced itself within the last minute.
 *
 * This is what makes the type available on the creation screen. It is read on
 * every enqueue too: without a runner the job would sit in Redis until one
 * appears, and a queue nobody drains is a monitor that lies by omission.
 */
export async function syntheticRunnerLive(): Promise<SyntheticLiveness | null> {
  const read = async (): Promise<SyntheticLiveness | null> => {
    const conn = await liveConnection();
    if (!conn) return null;
    const raw = await conn.get(SYNTHETIC_LIVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SyntheticLiveness;
  };
  return withTimeout(read(), 3_000, null);
}

export async function enqueueSyntheticRun(job: SyntheticJob): Promise<boolean> {
  const q = getQueue();
  if (!q) return false;
  try {
    // One job in flight per monitor: a sweep that fires while the previous run
    // is still in the browser must not queue a second Chromium for the same
    // journey. The id is dropped as soon as the job completes.
    return await withTimeout(
      q.add("run", job, { jobId: `syn-${job.monitorId}` }).then(() => true),
      5_000,
      false,
    );
  } catch (err) {
    console.error("[synthetic] could not enqueue:", err instanceof Error ? err.message : err);
    return false;
  }
}
