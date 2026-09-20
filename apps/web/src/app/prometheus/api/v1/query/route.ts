/** Prometheus `/api/v1/query` — the instant query Grafana uses for single stats. */
import { apiAuth } from "@/lib/api";
import { promError, promParams, runQuery } from "@/lib/prometheus";

export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const p = await promParams(request);
  const query = p.get("query");
  if (!query) return promError("a query is required");
  const { parseTime } = await import("@/lib/prometheus");
  const at = parseTime(p.get("time"), Date.now());
  // One point, but the evaluator still needs a grid: an instant query is a
  // range of one step ending at `time`.
  return runQuery(auth.ctx.tenant.id, query, { start: at, end: at, stepMs: 60_000 }, "vector");
}

export const GET = handle;
export const POST = handle;
