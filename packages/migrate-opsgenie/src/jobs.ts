/**
 * The background work of a run — reading the inventory, archiving the
 * history — advanced in bounded slices under a lease.
 *
 * Two callers advance a run: the screen, right after a button starts the
 * work (Next's `after()`), and the worker's sweep, which picks up any run
 * whose lease has lapsed. The lease keeps them from working the same run at
 * once; the cursor stored after every page is what lets either of them
 * resume where the other stopped — closing the page stops nothing.
 */
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { migrationRuns, withTenant, type Tx } from "@openincident/db";
import { OpsgenieError, type ClientOptions } from "./client";
import {
  advanceCursor,
  ensureHistorySource,
  fetchPage,
  planArchive,
  storeAlerts,
  type ArchiveCursor,
} from "./archive";
import { readInventory } from "./inventory";
import { clientFor, loadSnapshot, peopleIndex, peopleOf, storeInventory, type Run } from "./run";

const LEASE_MS = 90_000;

async function takeLease(tenantId: string, runId: string): Promise<Run | null> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .update(migrationRuns)
      .set({ leaseUntil: new Date(Date.now() + LEASE_MS) })
      .where(
        and(
          eq(migrationRuns.id, runId),
          or(isNull(migrationRuns.leaseUntil), lt(migrationRuns.leaseUntil, new Date())),
        ),
      )
      .returning();
    return row ?? null;
  });
}

const renew = (tx: Tx, runId: string) =>
  tx
    .update(migrationRuns)
    .set({ leaseUntil: new Date(Date.now() + LEASE_MS) })
    .where(eq(migrationRuns.id, runId));

async function release(tenantId: string, runId: string, patch: Partial<Run> = {}) {
  await withTenant(tenantId, (tx) =>
    tx
      .update(migrationRuns)
      .set({ leaseUntil: null, updatedAt: new Date(), ...patch })
      .where(eq(migrationRuns.id, runId)),
  );
}

export type AdvanceOptions = {
  /** Stop starting new pages after this long; the next caller resumes. */
  budgetMs?: number;
  /** For the tests and the demo seed: the Opsgenie to talk to. */
  client?: Partial<ClientOptions>;
};

/** What a failure says on screen: Opsgenie's own message, or why it could not be asked. */
function failure(e: unknown): string {
  if (e instanceof OpsgenieError) return `${e.code}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

/**
 * Advances whatever the run has running. Returns false when another process
 * holds the lease (it will carry on).
 */
export async function advanceRun(
  tenantId: string,
  runId: string,
  opts: AdvanceOptions = {},
): Promise<boolean> {
  const run = await takeLease(tenantId, runId);
  if (!run) return false;
  const deadline = Date.now() + (opts.budgetMs ?? 55_000);
  const client = clientFor(run, opts.client);
  if (!client) {
    await release(tenantId, runId, {
      error: "key: the stored key can no longer be read — connect again.",
    });
    return true;
  }
  try {
    if (run.steps.inventory === "running") {
      const snap = await readInventory(client, new Date(), async (pct, label) => {
        await withTenant(tenantId, async (tx) => {
          await tx
            .update(migrationRuns)
            .set({ progress: Math.min(99, pct), progressLabel: label })
            .where(eq(migrationRuns.id, runId));
          await renew(tx, runId);
        });
      });
      await withTenant(tenantId, (tx) => storeInventory(tx, tenantId, runId, snap));
      await release(tenantId, runId);
      return true;
    }
    if (run.steps.archive === "running") {
      let cursor = run.archiveCursor as unknown as ArchiveCursor | null;
      if (!cursor?.windows) {
        const oldest = (run.meta?.oldestAlertAt as string | null) ?? null;
        cursor = await planArchive(
          client,
          oldest ? new Date(oldest) : new Date(Date.now() - 365 * 86_400_000),
          new Date(),
        );
        await withTenant(tenantId, (tx) =>
          tx
            .update(migrationRuns)
            .set({ archiveCursor: cursor as unknown as Record<string, unknown> })
            .where(eq(migrationRuns.id, runId)),
        );
      }
      const ctx = await withTenant(tenantId, async (tx) => {
        const sourceId = await ensureHistorySource(tx, tenantId);
        const snap = await loadSnapshot(tx, run);
        const people = peopleIndex(await peopleOf(tx, runId));
        return {
          sourceId,
          people,
          usersByUsername: new Map(snap.users.map((u) => [u.username.toLowerCase(), u.id])),
          teamNames: new Map(snap.teams.map((t) => [t.id, t.name])),
        };
      });
      while (Date.now() < deadline) {
        const page = await fetchPage(client, cursor!);
        if (!page) break;
        const current: ArchiveCursor = cursor!;
        cursor = await withTenant(tenantId, async (tx) => {
          const stored = await storeAlerts(tx, tenantId, ctx.sourceId, page.alerts, ctx);
          const next = advanceCursor(current, page.index, page.listed, stored);
          await tx
            .update(migrationRuns)
            .set({ archiveCursor: next as unknown as Record<string, unknown>, error: null })
            .where(eq(migrationRuns.id, runId));
          await renew(tx, runId);
          return next;
        });
        if (cursor.finishedAt) break;
      }
      const finished = Boolean(cursor?.finishedAt) || cursor!.windows.every((w) => w.done);
      await release(
        tenantId,
        runId,
        finished
          ? {
              steps: { ...run.steps, archive: "done" },
              archiveCursor: {
                ...cursor!,
                finishedAt: cursor!.finishedAt ?? new Date().toISOString(),
              } as unknown as Record<string, unknown>,
            }
          : {},
      );
      return true;
    }
    await release(tenantId, runId);
    return true;
  } catch (e) {
    const steps = { ...run.steps };
    if (steps.inventory === "running") steps.inventory = "blocked";
    // An archive keeps running and is retried — after a pause, not in a loop.
    const pause = steps.archive === "running" ? new Date(Date.now() + 5 * 60_000) : null;
    await release(tenantId, runId, { error: failure(e), steps, leaseUntil: pause });
    return true;
  }
}

/** Runs whose work is waiting and whose lease has lapsed. */
export async function pendingRuns(tenantId: string): Promise<string[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({ id: migrationRuns.id })
      .from(migrationRuns)
      .where(
        and(
          eq(migrationRuns.tenantId, tenantId),
          isNull(migrationRuns.completedAt),
          or(
            sql`${migrationRuns.steps} ->> 'inventory' = 'running'`,
            sql`${migrationRuns.steps} ->> 'archive' = 'running'`,
          ),
          or(isNull(migrationRuns.leaseUntil), lt(migrationRuns.leaseUntil, new Date())),
        ),
      );
    return rows.map((r) => r.id);
  });
}

/** The worker's sweep: every workspace, every run that waits. */
export async function sweepMigrations(tenantIds: string[], budgetMs = 50_000): Promise<number> {
  let advanced = 0;
  for (const tenantId of tenantIds)
    for (const runId of await pendingRuns(tenantId)) {
      if (await advanceRun(tenantId, runId, { budgetMs })) advanced++;
    }
  return advanced;
}
