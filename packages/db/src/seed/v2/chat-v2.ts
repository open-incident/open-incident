/**
 * Demo rows the V2 design shows for chat-v2 — idempotent: running it twice
 * leaves the same rows. Called by the demo seed and by `run.ts --part chat-v2`.
 * Owner: chat-v2.
 */
import type { SeedTx } from "./types";

export async function seed(_tx: SeedTx, _tenantId: string): Promise<void> {}
