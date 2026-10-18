/**
 * Demo rows the V2 design shows for atlas-ui — idempotent: running it twice
 * leaves the same rows. Called by the demo seed and by `run.ts --part atlas-ui`.
 * Owner: atlas-ui.
 */
import type { SeedTx } from "./types";

export async function seed(_tx: SeedTx, _tenantId: string): Promise<void> {}
