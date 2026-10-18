/**
 * "Invite the person on call for the service" (Settings › Slack & Teams):
 * who that is, for the chat adapter.
 *
 * The incident's service → the team that owns it → the team's policy → the
 * first level of its published version → the people its targets resolve to
 * right now (schedules read their rotations and overrides). The same road the
 * pager takes, through the same engine function; nobody when a link is
 * missing.
 *
 * The chat package cannot import the on-call engine (the engine imports the
 * chat package to send pages as direct messages), so this resolver is handed
 * to it at server start (instrumentation.ts) — and again by the modules of
 * the chat surface when they load, which costs nothing and covers a server
 * that started before the hook existed.
 */
import { and, eq } from "drizzle-orm";
import {
  escalationPathVersions,
  escalationPaths,
  incidents,
  services,
  teams,
  type EscalationNode,
} from "@openincident/db";
import { onCallResolverRegistered, registerOnCallResolver } from "@openincident/chat";
import { resolveTargets } from "@openincident/oncall";

export function registerChatResolvers(): void {
  if (onCallResolverRegistered()) return;
  registerOnCallResolver(async (tx, tenantId, incidentId) => {
    const [row] = await tx
      .select({ pathId: teams.policyPathId })
      .from(incidents)
      .innerJoin(services, eq(services.id, incidents.serviceId))
      .innerJoin(teams, eq(teams.id, services.ownerTeamId))
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, incidentId)));
    if (!row?.pathId) return [];
    const [path] = await tx
      .select({ versionId: escalationPaths.currentVersionId })
      .from(escalationPaths)
      .where(and(eq(escalationPaths.tenantId, tenantId), eq(escalationPaths.id, row.pathId)));
    if (!path?.versionId) return [];
    const [version] = await tx
      .select({ graph: escalationPathVersions.graph })
      .from(escalationPathVersions)
      .where(eq(escalationPathVersions.id, path.versionId));
    const nodes = version?.graph.nodes ?? [];
    // The first level reached from the start. A delay is walked through; a
    // condition is read on its first branch (whatever it tests is decided by
    // the pager at paging time — here it only picks who joins a channel).
    let id = version?.graph.start ?? null;
    let level: Extract<EscalationNode, { kind: "level" }> | null = null;
    for (let hops = 0; id && hops < 20 && !level; hops++) {
      const node = nodes.find((n) => n.id === id);
      if (!node) break;
      if (node.kind === "level") level = node;
      else if (node.kind === "condition") id = node.whenTrue ?? node.whenFalse;
      else if (node.kind === "reassign") break;
      else id = node.next;
    }
    if (!level) return [];
    return resolveTargets(tx, tenantId, level.targets, new Date());
  });
}

registerChatResolvers();
