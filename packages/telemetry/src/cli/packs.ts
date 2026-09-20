/**
 * Writes the collector packs' dashboards to disk, one JSON per pack.
 *
 * The product places these itself — from the Telemetry screen, or on the first
 * signal a pack sends. The files exist for the two cases that are not the
 * product: reading a diff of what a panel now asks, and carrying a dashboard
 * into an instance that has no internet. `packs.test.ts` fails if they drift
 * from the definitions, so a file on disk is never a second source of truth.
 *
 *   pnpm --filter @openincident/telemetry run packs:emit
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PACKS, packDocument } from "../packs";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "..", "..", "..", "docker", "collector", "dashboards");

mkdirSync(out, { recursive: true });
for (const pack of PACKS) {
  const file = join(out, `${pack.id}.json`);
  writeFileSync(file, `${JSON.stringify(packDocument(pack), null, 2)}\n`);
  console.log(`${pack.id}: ${pack.panels.length} panels → ${file}`);
}
