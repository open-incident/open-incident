import { and, eq, or } from "drizzle-orm";
import { services, teams, withTenant } from "@openincident/db";
import { apiAuth, apiError, apiJson } from "@/lib/api";
import { serialiseService } from "@/lib/api-serialise";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/services/{key} — one service, by its key or its id.
 *
 * Both accepted on the same path because both are what a caller has. A CI job
 * knows the key it puts in its traces; a webhook payload carries the id. Making
 * them two endpoints would mean the caller has to know which kind of string it
 * is holding, which it often does not.
 */
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const { key } = await params;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);

  const [row] = await withTenant(auth.ctx.tenant.id, (tx) =>
    tx
      .select({
        id: services.id,
        key: services.key,
        name: services.name,
        confirmed: services.confirmed,
        seenIn: services.seenIn,
        labels: services.labels,
        techStack: services.techStack,
        firstSeenAt: services.firstSeenAt,
        lastSeenAt: services.lastSeenAt,
        telemetryLastSeenAt: services.telemetryLastSeenAt,
        ownerTeamId: services.ownerTeamId,
        ownerTeam: teams.name,
      })
      .from(services)
      .leftJoin(teams, eq(teams.id, services.ownerTeamId))
      .where(
        and(
          eq(services.tenantId, auth.ctx.tenant.id),
          isUuid ? or(eq(services.id, key), eq(services.key, key)) : eq(services.key, key),
        ),
      )
      .limit(1),
  );
  if (!row) return apiError(404, "not_found", `No service "${key}" in this workspace.`);
  return apiJson(serialiseService(row));
}
