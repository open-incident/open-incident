/**
 * Demo rows the V2 design shows for incidents-v2 — idempotent: running it twice
 * leaves the same rows. Called by the demo seed and by `run.ts --part incidents-v2`.
 * Owner: incidents-v2.
 */
import type { SeedTx } from "./types";

export async function seed(_tx: SeedTx, _tenantId: string): Promise<void> {}
