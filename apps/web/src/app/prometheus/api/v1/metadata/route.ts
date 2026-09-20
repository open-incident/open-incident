/** Prometheus `/api/v1/metadata` — type and unit, so Grafana picks the right hints. */
import { metricMetadata, telemetryInstalled } from "@openincident/telemetry";
import { apiAuth } from "@/lib/api";
import { promNotInstalled, promSuccess } from "@/lib/prometheus";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  if (!telemetryInstalled()) return promNotInstalled();
  return promSuccess(await metricMetadata(auth.ctx.tenant.id));
}
