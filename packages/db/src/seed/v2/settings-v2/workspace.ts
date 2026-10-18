/**
 * settings-v2 demo rows — Workspace screens. Idempotent: running it twice
 * leaves the same rows. Called by ../settings-v2.ts inside the seed's
 * transaction, the tenant context already set.
 *
 * The design's Working hours screen shows three sets, one of which no policy
 * reads; the demo has the two that policies read. The third is added here,
 * found again by its name on the next run.
 */
import { and, eq } from "drizzle-orm";
import { workingHoursSets } from "../../../schema/app";
import type { SeedTx } from "../types";

export async function seed(tx: SeedTx, tenantId: string): Promise<void> {
  const name = "Weekend support";
  const [existing] = await tx
    .select({ id: workingHoursSets.id })
    .from(workingHoursSets)
    .where(and(eq(workingHoursSets.tenantId, tenantId), eq(workingHoursSets.name, name)));
  if (existing) return;
  await tx.insert(workingHoursSets).values({
    tenantId,
    name,
    timezone: "Europe/Paris",
    days: [6, 7],
    startTime: "10:00",
    endTime: "16:00",
  });
}
