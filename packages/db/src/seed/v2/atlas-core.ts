/**
 * Demo rows the V2 design shows for atlas-core — idempotent: running it twice
 * leaves the same rows. Called by the demo seed and by `run.ts --part atlas-core`.
 * Owner: atlas-core.
 */
import type { SeedTx } from "./types";

export async function seed(_tx: SeedTx, _tenantId: string): Promise<void> {}
