/**
 * QA runs in the database: created from the screen, advanced by the worker.
 * Every write is under the workspace's context — the run belongs to the
 * workspace that launched it, and only its owner sees it.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { qaRuns, withTenant, type QaStatus, type QaSuite, type QaSummary } from "@openincident/db";

export type QaRun = typeof qaRuns.$inferSelect;

export const LOG_CAP = 1_500_000;

export async function createQaRun(
  tenantId: string,
  suite: QaSuite,
  actor: { memberId: string | null; name: string },
): Promise<QaRun> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .insert(qaRuns)
      .values({
        tenantId,
        suite,
        triggeredByMemberId: actor.memberId,
        triggeredByName: actor.name,
      })
      .returning();
    return row!;
  });
}

export async function listQaRuns(tenantId: string, limit = 30): Promise<QaRun[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(qaRuns)
      .where(eq(qaRuns.tenantId, tenantId))
      .orderBy(desc(qaRuns.queuedAt))
      .limit(limit),
  );
}

export async function getQaRun(tenantId: string, id: string): Promise<QaRun | null> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(qaRuns)
      .where(and(eq(qaRuns.tenantId, tenantId), eq(qaRuns.id, id)));
    return row ?? null;
  });
}

/** A suite already queued or running: one at a time, the mocks bind fixed ports. */
export async function activeQaRuns(tenantId: string): Promise<QaRun[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(qaRuns)
      .where(and(eq(qaRuns.tenantId, tenantId), inArray(qaRuns.status, ["queued", "running"])))
      .orderBy(desc(qaRuns.queuedAt)),
  );
}

export async function requestQaCancel(tenantId: string, id: string): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(qaRuns)
      .set({ cancelRequested: true })
      .where(
        and(
          eq(qaRuns.tenantId, tenantId),
          eq(qaRuns.id, id),
          inArray(qaRuns.status, ["queued", "running"]),
        ),
      ),
  );
}

export async function markQaRunning(tenantId: string, id: string, command: string): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(qaRuns)
      .set({ status: "running", startedAt: new Date(), command })
      .where(and(eq(qaRuns.tenantId, tenantId), eq(qaRuns.id, id))),
  );
}

/** Replaces the stored log with the buffer's tail; says so when it was cut. */
export async function writeQaLog(tenantId: string, id: string, log: string): Promise<boolean> {
  const truncated = log.length > LOG_CAP;
  const kept = truncated
    ? `… (${log.length - LOG_CAP} characters cut)\n${log.slice(-LOG_CAP)}`
    : log;
  await withTenant(tenantId, (tx) =>
    tx
      .update(qaRuns)
      .set({ log: kept, logTruncated: truncated })
      .where(and(eq(qaRuns.tenantId, tenantId), eq(qaRuns.id, id))),
  );
  return truncated;
}

export async function isQaCancelRequested(tenantId: string, id: string): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ c: qaRuns.cancelRequested })
      .from(qaRuns)
      .where(and(eq(qaRuns.tenantId, tenantId), eq(qaRuns.id, id)));
    return row?.c ?? false;
  });
}

export async function finishQaRun(
  tenantId: string,
  id: string,
  outcome: { status: QaStatus; exitCode: number | null; summary: QaSummary },
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(qaRuns)
      .set({
        status: outcome.status,
        exitCode: outcome.exitCode,
        summary: outcome.summary,
        finishedAt: new Date(),
      })
      .where(and(eq(qaRuns.tenantId, tenantId), eq(qaRuns.id, id))),
  );
}

/** Housekeeping: keep the last 200 runs of a workspace. */
export async function pruneQaRuns(tenantId: string, keep = 200): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.execute(sql`delete from app.qa_runs where tenant_id = ${tenantId} and id not in (
      select id from app.qa_runs where tenant_id = ${tenantId} order by created_at desc limit ${keep})`),
  );
}
