/**
 * What the refusals and the volume become, once a batch is answered.
 *
 * Its own module rather than a function in the HTTP entrypoint, because the
 * syslog listener needs it too and importing the entrypoint from a module the
 * entrypoint starts is a cycle. That is the mechanical reason; the real one is
 * that syslog was not counting its volume at all, which was invisible until a
 * daily cap started dividing that number into a budget — at which point
 * "send it over syslog instead" would have been a way around the cap.
 */
import { eq, sql } from "drizzle-orm";
import {
  telemetryIngestionKeys,
  telemetryRejections,
  telemetryUsage,
  withTenant,
} from "@openincident/db";
import type { Caller } from "./auth";
import type { Outcome } from "./ingest";

export type Signal = "logs" | "traces" | "metrics" | "profiles" | "rum";

/**
 * What the refusals and the volume become, once the request is answered.
 *
 * Both are written after the response on purpose: a collector waiting on its
 * 200 should not also wait on our bookkeeping. Neither may throw into the
 * request path — a full rejections table is not a reason to lose a span.
 */
export async function record(caller: Caller, signal: Signal, outcome: Outcome, bytes: number) {
  try {
    await withTenant(caller.tenantId, async (tx) => {
      if (outcome.rejected.length) {
        await tx.insert(telemetryRejections).values(
          outcome.rejected.slice(0, 20).map((r) => ({
            tenantId: caller.tenantId,
            keyId: caller.keyId,
            signal,
            reason: r.reason,
            excerpt: r.excerpt,
          })),
        );
      }
      const dropped = outcome.dropped ?? 0;
      // `accepted > 0` was the old condition and it had to go: once sampling
      // exists, a batch can be entirely drawn out, and not counting its bytes
      // would stop the measured volume climbing — which is the one input the
      // sampler divides into the cap. The rate would freeze and the cap would
      // hold at whatever it reached.
      if (outcome.accepted > 0 || dropped > 0) {
        const day = new Date().toISOString().slice(0, 10);
        await tx
          .insert(telemetryUsage)
          .values({
            tenantId: caller.tenantId,
            day,
            signal,
            rows: outcome.accepted,
            bytes,
            dropped,
          })
          .onConflictDoUpdate({
            target: [telemetryUsage.tenantId, telemetryUsage.day, telemetryUsage.signal],
            set: {
              rows: sql`${telemetryUsage.rows} + ${outcome.accepted}`,
              bytes: sql`${telemetryUsage.bytes} + ${bytes}`,
              dropped: sql`${telemetryUsage.dropped} + ${dropped}`,
              updatedAt: new Date(),
            },
          });
      }
      await tx
        .update(telemetryIngestionKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(telemetryIngestionKeys.id, caller.keyId));
    });
  } catch (err) {
    console.error("[telemetry] bookkeeping failed:", err);
  }
}
