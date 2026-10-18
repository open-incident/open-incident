/**
 * The V2 design pass's demo rows, one part per module. Each part is
 * idempotent and runs inside the demo seed's transaction, tenant context set.
 */
import type { SeedTx } from "./types";
import { seed as shellHome } from "./shell-home";
import { seed as incidentsV2 } from "./incidents-v2";
import { seed as alertsStatus } from "./alerts-status";
import { seed as telemetryMonitors } from "./telemetry-monitors";
import { seed as oncallV2 } from "./oncall-v2";
import { seed as servicesInsights } from "./services-insights";
import { seed as settingsV2 } from "./settings-v2";
import { seed as chatV2 } from "./chat-v2";
import { seed as migrate } from "./migrate";
import { seed as atlasCore } from "./atlas-core";
import { seed as atlasUi } from "./atlas-ui";

export const V2_PARTS: Record<string, (tx: SeedTx, tenantId: string) => Promise<void>> = {
  "shell-home": shellHome,
  "incidents-v2": incidentsV2,
  "alerts-status": alertsStatus,
  "telemetry-monitors": telemetryMonitors,
  "oncall-v2": oncallV2,
  "services-insights": servicesInsights,
  "settings-v2": settingsV2,
  "chat-v2": chatV2,
  migrate: migrate,
  "atlas-core": atlasCore,
  "atlas-ui": atlasUi,
};

export async function seedV2(tx: SeedTx, tenantId: string, only?: string): Promise<void> {
  for (const [name, part] of Object.entries(V2_PARTS)) {
    if (only && only !== name) continue;
    await part(tx, tenantId);
  }
}
