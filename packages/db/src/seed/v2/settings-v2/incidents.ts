/**
 * settings-v2 demo rows — incidents screens. Idempotent: running it twice leaves the
 * same rows. Called by ../settings-v2.ts inside the seed's transaction, the
 * tenant context already set.
 */
import type { SeedTx } from "../types";

export async function seed(_tx: SeedTx, _tenantId: string): Promise<void> {}
