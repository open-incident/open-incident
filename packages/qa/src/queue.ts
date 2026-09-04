/** The queue between the screen and the worker: one job per run, one run at a time. */
export const QA_QUEUE = "qa-run";

export type QaJob = { tenantId: string; runId: string };

export async function enqueueQaRun(job: QaJob): Promise<boolean> {
  const url = process.env.REDIS_URL;
  if (!url) return false;
  try {
    const [{ Queue }, { default: IORedis }] = await Promise.all([
      import("bullmq"),
      import("ioredis"),
    ]);
    const connection = new IORedis(url, { maxRetriesPerRequest: null });
    const queue = new Queue(QA_QUEUE, { connection });
    await queue.add("run", job, {
      jobId: job.runId,
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 100,
    });
    await queue.close();
    await connection.quit();
    return true;
  } catch (err) {
    console.error("[qa] could not enqueue:", err);
    return false;
  }
}
