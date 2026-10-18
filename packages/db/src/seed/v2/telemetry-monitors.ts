/**
 * Demo rows the V2 design shows for telemetry-monitors — idempotent: running it twice
 * leaves the same rows. Called by the demo seed and by `run.ts --part telemetry-monitors`.
 * Owner: telemetry-monitors.
 */
import type { SeedTx } from "./types";

export async function seed(_tx: SeedTx, _tenantId: string): Promise<void> {}
