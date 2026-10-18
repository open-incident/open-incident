/**
 * Demo rows the V2 design shows for oncall-v2 — idempotent: running it twice
 * leaves the same rows. Called by the demo seed and by `run.ts --part oncall-v2`.
 * Owner: oncall-v2.
 *
 * The design draws Platform primary as two rotations named "Day · EU" and
 * "Night"; the demo seed wrote them in French. Only the names change: the
 * people, the hours and the turns are the demo's own.
 */
import { and, eq } from "drizzle-orm";
import { rotations } from "../../schema/app";
import type { SeedTx } from "./types";

const RENAMES: Array<[from: string, to: string]> = [
  ["Jour EU", "Day · EU"],
  ["Nuit US", "Night"],
];

export async function seed(tx: SeedTx, tenantId: string): Promise<void> {
  for (const [from, to] of RENAMES)
    await tx
      .update(rotations)
      .set({ name: to })
      .where(and(eq(rotations.tenantId, tenantId), eq(rotations.name, from)));
}
