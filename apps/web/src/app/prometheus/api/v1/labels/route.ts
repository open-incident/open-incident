/** Prometheus `/api/v1/labels` — what Grafana's label picker reads. */
import { labelNames, telemetryInstalled } from "@openincident/telemetry";
import { apiAuth } from "@/lib/api";
import { promNotInstalled, promSuccess } from "@/lib/prometheus";

export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  if (!telemetryInstalled()) return promNotInstalled();
  return promSuccess(await labelNames(auth.ctx.tenant.id));
}

export const GET = handle;
export const POST = handle;
