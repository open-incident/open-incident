/**
 * Keeping the service map's edges up to date.
 *
 * The rollup itself lives in `@openincident/telemetry`, which knows ClickHouse
 * and nothing of Postgres. What is here is the part that needs both: which
 * workspaces to roll up, how long each of them keeps its traces, and how to
 * make a restart resume rather than start again.
 *
 * Resuming matters more than it sounds. A worker that was stopped for an hour
 * comes back to a map with an hour-shaped hole in it, and a hole in a
 * dependency map is not a gap somebody notices — it reads as "these two
 * services stopped talking". So the sweep asks which minutes are missing and
 * fills them, oldest first, rather than rolling up the minute in front of it.
 */
import { eq } from "drizzle-orm";
import { telemetrySettings, withTenant } from "@openincident/db";
import {
  ROLLUP_BACKFILL_MINUTES,
  ROLLUP_LAG_MINUTES,
  pendingMinutes,
  rollupServiceEdges,
  telemetryInstalled,
  tenantsWithData,
} from "@openincident/telemetry";

const DEFAULT_RETENTION_DAYS = 15;

/**
 * A ceiling per workspace per tick, so one workspace's backlog cannot starve
 * the others. At one minute of wall clock per tick this still catches up on
 * two hours of downtime in about a minute of work.
 */
const MAX_MINUTES_PER_TICK = 120;

export type EdgeSweepResult = {
  minutes: number;
  edges: number;
  failed: number;
  /** Workspaces with no traces in the window, which cost nothing this tick. */
  skipped: number;
};

export async function sweepServiceEdges(
  tenantIds: string[],
  now = new Date(),
): Promise<EdgeSweepResult> {
  const out: EdgeSweepResult = { minutes: 0, edges: 0, failed: 0, skipped: 0 };
  if (!telemetryInstalled()) return out;

  /*
   * Who has anything to roll up, asked once for everybody.
   *
   * Without this the sweep did a Postgres transaction, a ClickHouse query and
   * up to `ROLLUP_BACKFILL_MINUTES` × 3 statements **per workspace per
   * minute** — including for workspaces that have never sent a span, which
   * paid the full bill for ever to produce nothing. One query over the raw
   * table's ordering key replaces twenty-six probes.
   */
  const window = new Date(now.getTime() - (ROLLUP_BACKFILL_MINUTES + ROLLUP_LAG_MINUTES) * 60_000);
  let active: Set<string>;
  try {
    active = await tenantsWithData("spans", window);
  } catch (err) {
    // The gate failing must not stop the rollup: fall back to sweeping
    // everybody, which is the old behaviour and merely slow.
    console.error(
      "[service-map] gate failed, sweeping all:",
      err instanceof Error ? err.message : err,
    );
    active = new Set(tenantIds);
  }
  const working = tenantIds.filter((id) => active.has(id));
  out.skipped = tenantIds.length - working.length;
  if (working.length === 0) return out;

  for (const tenantId of working) {
    try {
      const retention = await retentionFor(tenantId);
      const minutes = (await pendingMinutes(tenantId, now)).slice(0, MAX_MINUTES_PER_TICK);
      for (const minute of minutes) {
        out.edges += await rollupServiceEdges(tenantId, minute, retention);
        out.minutes++;
      }
    } catch (err) {
      out.failed++;
      console.error(`[service-map] ${tenantId}:`, err instanceof Error ? err.message : String(err));
    }
  }
  return out;
}

/**
 * When this workspace's edges may be dropped.
 *
 * The same horizon as its traces, because an edge is a statement about traces:
 * keeping it after the spans it was computed from are gone would leave a map
 * nobody can drill into.
 *
 * Still one transaction per workspace, and deliberately so: `withTenant` is
 * the only door into `app`, and reading these in one cross-tenant query would
 * mean reaching past row-level security to save a few milliseconds. It is now
 * called only for the workspaces that actually have traces, which is where the
 * cost went — not here.
 */
async function retentionFor(tenantId: string): Promise<string> {
  const days = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ days: telemetrySettings.retentionTracesDays })
      .from(telemetrySettings)
      .where(eq(telemetrySettings.tenantId, tenantId));
    return row?.days ?? DEFAULT_RETENTION_DAYS;
  });
  const until = new Date(Date.now() + days * 86_400_000);
  return until.toISOString().replace("T", " ").slice(0, 19);
}
