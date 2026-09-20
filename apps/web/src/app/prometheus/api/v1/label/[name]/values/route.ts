/** Prometheus `/api/v1/label/{name}/values` — the second half of the picker. */
import { labelValues, telemetryInstalled } from "@openincident/telemetry";
import { apiAuth } from "@/lib/api";
import { promNotInstalled, promSuccess } from "@/lib/prometheus";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  if (!telemetryInstalled()) return promNotInstalled();
  const { name } = await params;
  return promSuccess(await labelValues(auth.ctx.tenant.id, name));
}
