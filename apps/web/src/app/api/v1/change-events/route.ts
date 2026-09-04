import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { changeEvents, withTenant } from "@openincident/db";
import { apiAuth, apiError, apiJson, readJson } from "@/lib/api";
import { resolveService } from "@/lib/api-resolve";
import { indexChangeEvent } from "@/lib/ai-capabilities";

export const dynamic = "force-dynamic";

/** GET /api/v1/change-events?since=ISO — deploys, flags and config changes the knowledge layer reads. */
export async function GET(request: Request) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const since = new URL(request.url).searchParams.get("since");
  const sinceDate = since ? new Date(since) : new Date(Date.now() - 7 * 86_400_000);
  const rows = await withTenant(auth.ctx.tenant.id, (tx) =>
    tx
      .select()
      .from(changeEvents)
      .where(
        and(eq(changeEvents.tenantId, auth.ctx.tenant.id), gte(changeEvents.occurredAt, sinceDate)),
      )
      .orderBy(desc(changeEvents.occurredAt))
      .limit(200),
  );
  return apiJson({
    data: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      description: r.description,
      service_id: r.serviceEntryId,
      environment: r.environment,
      actor: r.actorName,
      external_ref: r.externalRef,
      occurred_at: r.occurredAt.toISOString(),
    })),
  });
}

const schema = z.object({
  kind: z.enum(["deploy", "flag", "config", "other"]).default("deploy"),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
  service: z.string().optional(),
  environment: z.string().trim().max(40).optional(),
  actor: z.string().trim().max(120).optional(),
  external_ref: z.string().trim().url().max(500).optional(),
  occurred_at: z.string().datetime().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

/** POST /api/v1/change-events (scope write) — from CI, a feature-flag tool, a hand. */
export async function POST(request: Request) {
  const auth = await apiAuth(request, "write");
  if (!auth.ok) return auth.response;
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.body);
  if (!parsed.success)
    return apiError(
      422,
      "invalid_body",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  const input = parsed.data;
  const tenantId = auth.ctx.tenant.id;
  const created = await withTenant(tenantId, async (tx) => {
    const service = await resolveService(tx, tenantId, input.service);
    if (input.service && !service)
      return {
        error: apiError(422, "unknown_service", `No service "${input.service}" in the catalog.`),
      };
    const [row] = await tx
      .insert(changeEvents)
      .values({
        tenantId,
        kind: input.kind,
        title: input.title,
        description: input.description ?? null,
        serviceEntryId: service?.id ?? null,
        environment: input.environment ?? null,
        actorName: input.actor ?? auth.ctx.key.name,
        externalRef: input.external_ref ?? null,
        payload: input.payload,
        occurredAt: input.occurred_at ? new Date(input.occurred_at) : new Date(),
      })
      .returning();
    return { row: row! };
  });
  if ("error" in created) return created.error;
  void indexChangeEvent(tenantId, created.row.id).catch(() => {});
  return apiJson(
    {
      id: created.row.id,
      kind: created.row.kind,
      title: created.row.title,
      occurred_at: created.row.occurredAt.toISOString(),
    },
    201,
  );
}
