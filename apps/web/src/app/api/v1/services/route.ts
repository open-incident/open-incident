import { asc, eq } from "drizzle-orm";
import { services, teams, withTenant } from "@openincident/db";
import { apiAuth, apiJson } from "@/lib/api";
import { serialiseService } from "@/lib/api-serialise";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/services — the estate, as the product learned it.
 *
 * Worth knowing before integrating against it: most of these rows were never
 * created by anybody. A service appears the first time a trace, a log or an
 * alert names it (D18), which is why `confirmed` and `seen_in` are here — they
 * are the difference between "a human said this exists" and "something called
 * itself this once at 3 a.m.".
 */
export async function GET(request: Request) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const rows = await withTenant(auth.ctx.tenant.id, (tx) =>
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
      .where(eq(services.tenantId, auth.ctx.tenant.id))
      .orderBy(asc(services.key)),
  );
  return apiJson({ data: rows.map(serialiseService) });
}
