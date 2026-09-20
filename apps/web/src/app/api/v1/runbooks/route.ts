import { asc, eq } from "drizzle-orm";
import { runbooks, services, withTenant } from "@openincident/db";
import { apiAuth, apiJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/runbooks — what somebody wrote down for the next person.
 *
 * The content is included: a runbook list without the runbooks is a list of
 * titles, and the caller most likely to ask for this is an assistant trying to
 * answer "what do we do about this", which needs the text.
 *
 * `fetch_error` is returned rather than hidden. A runbook whose source stopped
 * resolving still shows its last good copy, and the reader has to be able to
 * tell how old it is.
 */
export async function GET(request: Request) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const rows = await withTenant(auth.ctx.tenant.id, (tx) =>
    tx
      .select({
        id: runbooks.id,
        title: runbooks.title,
        sourceUrl: runbooks.sourceUrl,
        content: runbooks.content,
        fetchedAt: runbooks.fetchedAt,
        fetchError: runbooks.fetchError,
        serviceId: runbooks.serviceId,
        service: services.key,
        updatedAt: runbooks.updatedAt,
      })
      .from(runbooks)
      .leftJoin(services, eq(services.id, runbooks.serviceId))
      .where(eq(runbooks.tenantId, auth.ctx.tenant.id))
      .orderBy(asc(runbooks.title)),
  );
  return apiJson({
    data: rows.map((r) => ({
      id: r.id,
      title: r.title,
      source_url: r.sourceUrl,
      content: r.content,
      service_id: r.serviceId,
      service: r.service,
      fetched_at: r.fetchedAt?.toISOString() ?? null,
      fetch_error: r.fetchError,
      updated_at: r.updatedAt.toISOString(),
    })),
  });
}
