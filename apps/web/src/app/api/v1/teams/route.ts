import { asc, eq } from "drizzle-orm";
import { escalationPaths, members, teamMembers, teams, withTenant } from "@openincident/db";
import { apiAuth, apiJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/teams — teams, their people and the path they escalate on.
 *
 * The membership is included rather than being a second call. A team with no
 * members is the commonest misconfiguration in this product — it routes an
 * alert to nobody and looks configured — and a list that hides it behind
 * another request is a list that lets it stay hidden.
 */
export async function GET(request: Request) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const tenantId = auth.ctx.tenant.id;

  const { rows, people } = await withTenant(tenantId, async (tx) => ({
    rows: await tx
      .select({
        id: teams.id,
        name: teams.name,
        policyPathId: teams.policyPathId,
        policyName: escalationPaths.name,
        chatChannel: teams.chatChannel,
      })
      .from(teams)
      .leftJoin(escalationPaths, eq(escalationPaths.id, teams.policyPathId))
      .where(eq(teams.tenantId, tenantId))
      .orderBy(asc(teams.name)),
    people: await tx
      .select({
        teamId: teamMembers.teamId,
        memberId: members.id,
        name: members.name,
        email: members.email,
      })
      .from(teamMembers)
      .innerJoin(members, eq(members.id, teamMembers.memberId))
      .where(eq(teamMembers.tenantId, tenantId)),
  }));

  return apiJson({
    data: rows.map((t) => ({
      id: t.id,
      name: t.name,
      chat_channel: t.chatChannel,
      escalation_policy_id: t.policyPathId,
      escalation_policy: t.policyName,
      members: people
        .filter((p) => p.teamId === t.id)
        .map((p) => ({ id: p.memberId, name: p.name, email: p.email })),
    })),
  });
}
