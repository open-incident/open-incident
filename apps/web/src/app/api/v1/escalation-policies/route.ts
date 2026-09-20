import { asc, eq } from "drizzle-orm";
import { escalationPathVersions, escalationPaths, withTenant } from "@openincident/db";
import { apiAuth, apiJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/escalation-policies — the paths an alert can take.
 *
 * The published version is returned, never the draft. A workspace can be
 * halfway through rewriting a path when this is called, and answering with the
 * draft would describe behaviour nothing is using.
 */
export async function GET(request: Request) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const rows = await withTenant(auth.ctx.tenant.id, (tx) =>
    tx
      .select({
        id: escalationPaths.id,
        name: escalationPaths.name,
        description: escalationPaths.description,
        versionId: escalationPaths.currentVersionId,
        graph: escalationPathVersions.graph,
        version: escalationPathVersions.version,
        publishedAt: escalationPathVersions.publishedAt,
      })
      .from(escalationPaths)
      .leftJoin(
        escalationPathVersions,
        eq(escalationPathVersions.id, escalationPaths.currentVersionId),
      )
      .where(eq(escalationPaths.tenantId, auth.ctx.tenant.id))
      .orderBy(asc(escalationPaths.name)),
  );
  return apiJson({
    data: rows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      version_id: p.versionId,
      version: p.version,
      published_at: p.publishedAt?.toISOString() ?? null,
      // Null when a path has been created and never published — which is a
      // path that routes nothing, and worth seeing as null rather than as {}.
      graph: p.graph ?? null,
    })),
  });
}
