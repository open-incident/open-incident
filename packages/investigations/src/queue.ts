/**
 * The queue between the product and the worker. One job id per incident, so
 * signals that land in a burst become one assessment; a process without a
 * reachable Redis runs the assessment itself, detached, rather than dropping it.
 */
import {
  INVESTIGATION_QUEUE,
  ensureInvestigationRow,
  runInvestigation,
  type InvestigationJob,
} from "./run";

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("redis timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });

export async function enqueueInvestigation(
  job: InvestigationJob,
  opts: { delayMs?: number } = {},
): Promise<boolean> {
  // The same default as the worker's own connection (see @openincident/qa).
  const url = process.env.REDIS_URL ?? "redis://localhost:6381";
  try {
    const [{ Queue }, { default: IORedis }] = await Promise.all([
      import("bullmq"),
      import("ioredis"),
    ]);
    const connection = new IORedis(url, { maxRetriesPerRequest: null });
    const queue = new Queue(INVESTIGATION_QUEUE, { connection });
    try {
      await withTimeout(
        queue.add("assess", job, {
          jobId: `inv-${job.incidentId}`,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
          ...(opts.delayMs ? { delay: opts.delayMs } : {}),
        }),
        5000,
      );
    } finally {
      await queue.close().catch(() => {});
      connection.disconnect();
    }
    return true;
  } catch (err) {
    console.error("[investigation] could not enqueue:", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Asks for an assessment: the row is queued, the job enqueued — or run here,
 * detached, when no queue answers. A running assessment is not interrupted;
 * the trigger waits on the row for it to finish.
 */
export async function startInvestigation(
  job: InvestigationJob,
  opts: { delayMs?: number } = {},
): Promise<"queued" | "coalesced" | "inline"> {
  const row = await ensureInvestigationRow(job.tenantId, job.incidentId, job.trigger);
  if (row.status === "running") return "coalesced";
  if (await enqueueInvestigation(job, opts)) return "queued";
  void runInvestigation(job).catch((err) =>
    console.error("[investigation] inline assessment failed:", err),
  );
  return "inline";
}
