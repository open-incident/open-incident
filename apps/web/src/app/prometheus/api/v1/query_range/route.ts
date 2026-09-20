/** Prometheus `/api/v1/query_range` — every graph panel in Grafana lands here. */
import { apiAuth } from "@/lib/api";
import { parseStep, parseTime, promError, promParams, runQuery } from "@/lib/prometheus";

export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const p = await promParams(request);
  const query = p.get("query");
  if (!query) return promError("a query is required");
  const end = parseTime(p.get("end"), Date.now());
  const start = parseTime(p.get("start"), end - 3_600_000);
  if (start > end) return promError("start is after end");
  const stepMs = parseStep(p.get("step"), 60_000);
  return runQuery(auth.ctx.tenant.id, query, { start, end, stepMs }, "matrix");
}

export const GET = handle;
export const POST = handle;
