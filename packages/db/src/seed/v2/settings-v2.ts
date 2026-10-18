/**
 * Demo rows the V2 design shows for settings-v2 — idempotent: running it twice
 * leaves the same rows. Called by the demo seed and by `run.ts --part settings-v2`.
 * Owner: settings-v2. One file per family of screens under ./settings-v2/.
 */
import type { SeedTx } from "./types";
import { seed as workspace } from "./settings-v2/workspace";
import { seed as people } from "./settings-v2/people";
import { seed as incidents } from "./settings-v2/incidents";
import { seed as alerts } from "./settings-v2/alerts";
import { seed as platform } from "./settings-v2/platform";

export async function seed(tx: SeedTx, tenantId: string): Promise<void> {
  await workspace(tx, tenantId);
  await people(tx, tenantId);
  await incidents(tx, tenantId);
  await alerts(tx, tenantId);
  await platform(tx, tenantId);
}
