/**
 * POST /api/ingest/alerts/{sourceId} — the dedicated endpoint of one alert source.
 *
 * The secret travels as `?secret=` or `x-oi-secret` (Alertmanager, Grafana and
 * friends can set either) and is compared in constant time against its hash.
 * The payload is stored as received; parsing follows.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { alertSources, getTenantIdForApiKeyHash, withTenant } from "@openincident/db";
import { apiError, apiJson } from "@/lib/api";
import { ingestPayload } from "@/lib/alert-ingest";
import { getTenantFromHeaders } from "@/lib/tenant";

export const dynamic = "force-dynamic";

function hashSourceSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  const { sourceId } = await params;
  const url = new URL(request.url);
  const secret = request.headers.get("x-oi-secret") ?? url.searchParams.get("secret") ?? "";
  if (!secret)
    return apiError(
      401,
      "missing_secret",
      "Provide the source secret as `x-oi-secret` or `?secret=`.",
    );
  // The source id is unique across the instance; the tenant comes from the host,
  // or from the directory lookup registered at creation (a monitoring tool posts to the bare host).
  const tenant = await getTenantFromHeaders().catch(() => null);
  const tenantId = tenant?.id ?? (await getTenantIdForApiKeyHash(`src:${sourceId}`));
  if (!tenantId) return apiError(404, "unknown_source", "No such alert source.");
  const source = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(alertSources)
      .where(and(eq(alertSources.tenantId, tenantId), eq(alertSources.id, sourceId)));
    return row ?? null;
  });
  if (!source) return apiError(404, "unknown_source", "No such alert source.");
  const given = Buffer.from(hashSourceSecret(secret));
  const stored = Buffer.from(source.secretHash);
  if (given.length !== stored.length || !timingSafeEqual(given, stored))
    return apiError(401, "bad_secret", "The secret does not match this source.");
  if (!source.active) return apiError(409, "source_inactive", "This source is switched off.");

  let payload: unknown;
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json") || type === "") payload = await request.json();
    else if (type.includes("form"))
      payload = Object.fromEntries((await request.formData()).entries());
    else payload = { title: (await request.text()).slice(0, 500) };
  } catch {
    return apiError(400, "invalid_payload", "The body could not be read.");
  }
  const outcomes = await ingestPayload(tenantId, source, payload);
  return apiJson(
    {
      data: outcomes.map((o) => ({
        alert_id: o.alertId || null,
        action: o.action,
        incident_number: o.incidentNumber ?? null,
      })),
    },
    202,
  );
}
