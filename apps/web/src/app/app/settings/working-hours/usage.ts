import { eq } from "drizzle-orm";
import { escalationPathVersions, escalationPaths, withTenant } from "@openincident/db";

/**
 * Which policies read which set of working hours: a set id → the names of
 * the escalation paths whose graph (the draft being edited, else the
 * published version) branches on it or waits for it.
 */
export async function setsUsage(tenantId: string): Promise<Map<string, string[]>> {
  return withTenant(tenantId, async (tx) => {
    const paths = await tx
      .select({
        name: escalationPaths.name,
        currentVersionId: escalationPaths.currentVersionId,
        draft: escalationPaths.draftGraph,
      })
      .from(escalationPaths)
      .where(eq(escalationPaths.tenantId, tenantId));
    const versions = await tx
      .select({ id: escalationPathVersions.id, graph: escalationPathVersions.graph })
      .from(escalationPathVersions)
      .where(eq(escalationPathVersions.tenantId, tenantId));
    const usage = new Map<string, string[]>();
    for (const p of paths) {
      const published = versions.find((v) => v.id === p.currentVersionId)?.graph;
      const ids = new Set<string>();
      for (const g of [p.draft, published]) {
        for (const n of g?.nodes ?? []) {
          if (n.kind === "condition" && n.test.type === "working_hours") ids.add(n.test.setId);
          if (n.kind === "delay" && n.untilWorkingHoursSetId) ids.add(n.untilWorkingHoursSetId);
        }
      }
      for (const id of ids) usage.set(id, [...(usage.get(id) ?? []), p.name]);
    }
    return usage;
  });
}
