/**
 * How much of today the workspace has already spent.
 *
 * Kept apart from `settingsFor` because the two have different costs and
 * different freshness needs. The settings are one row by primary key and are
 * read on every request without anybody noticing; the day's volume is an
 * aggregate over `telemetry_usage`, and a collector posting ten times a second
 * must not buy a `sum()` each time.
 *
 * So it is cached, and the staleness is deliberate: a workspace can overshoot
 * its cap by up to `TTL` of traffic before the rate moves. On a soft cap that
 * is the correct trade — the alternative buys exactness with a query per
 * request, on the one path in the product that has to stay cheap.
 */
import { and, eq, sql } from "drizzle-orm";
import { telemetryUsage, withTenant } from "@openincident/db";
import { keepRate } from "./sampling";

const TTL_MS = 30_000;
const GB = 1024 ** 3;

const cache = new Map<string, { rate: number; at: number }>();

/**
 * The share of ordinary logs and traces this workspace keeps right now.
 *
 * Never throws. A failure to read the usage table is not a reason to start
 * throwing away somebody's telemetry — the cap is a billing guard, and
 * guessing "over" when the database is unwell would turn a database blip into
 * silent data loss during exactly the incident the data is for.
 */
export async function keepRateFor(tenantId: string, capGb: number | null): Promise<number> {
  if (!capGb || capGb <= 0) return 1;

  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rate;

  let rate = 1;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const used = await withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({ bytes: sql<string>`coalesce(sum(${telemetryUsage.bytes}), 0)` })
        .from(telemetryUsage)
        .where(and(eq(telemetryUsage.tenantId, tenantId), eq(telemetryUsage.day, day)));
      // `sum()` of a bigint comes back as a string from postgres.js, because
      // the total does not fit a double once a workspace is busy enough for
      // any of this to matter.
      return Number(row?.bytes ?? 0);
    });
    rate = keepRate(capGb * GB, used);
  } catch (err) {
    console.error("[telemetry] budget lookup failed, not sampling:", err);
    return 1;
  }

  cache.set(tenantId, { rate, at: Date.now() });
  return rate;
}
