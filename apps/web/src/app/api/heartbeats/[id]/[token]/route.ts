/**
 * GET|POST|HEAD /api/heartbeats/{id}/{token} — the ping. Any method, no body
 * needed: `curl -fsS https://acme.example/api/heartbeats/…` at the end of a
 * cron is the whole integration. Unknown id or token: 404, nothing recorded.
 */
import { recordHeartbeatPing } from "@openincident/oncall";
import { getTenantFromHeaders } from "@/lib/tenant";

export const dynamic = "force-dynamic";

async function ping(params: Promise<{ id: string; token: string }>): Promise<Response> {
  const { id, token } = await params;
  const tenant = await getTenantFromHeaders().catch(() => null);
  if (!tenant || !/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f]{16,64}$/i.test(token))
    return new Response("Not found", { status: 404 });
  const ok = await recordHeartbeatPing(tenant.id, id, token);
  return ok
    ? new Response("OK", { status: 200, headers: { "cache-control": "no-store" } })
    : new Response("Not found", { status: 404 });
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string; token: string }> },
) {
  return ping(ctx.params);
}
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string; token: string }> },
) {
  return ping(ctx.params);
}
export async function HEAD(
  _request: Request,
  ctx: { params: Promise<{ id: string; token: string }> },
) {
  const res = await ping(ctx.params);
  return new Response(null, { status: res.status, headers: res.headers });
}
