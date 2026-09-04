import { withTenant } from "@openincident/db";
import { apiAuth, apiJson } from "@/lib/api";
import { listFollowUps } from "@/lib/incidents";

export const dynamic = "force-dynamic";

/** GET /api/v1/follow-ups?status=open — across incidents. */
export async function GET(request: Request) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const status = new URL(request.url).searchParams.get("status");
  const rows = await withTenant(auth.ctx.tenant.id, (tx) => listFollowUps(tx, auth.ctx.tenant.id));
  const data = rows
    .filter((r) => !status || r.status === status)
    .map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      priority: r.priorityName,
      incident_number: r.incidentNumber,
      assignee: r.assigneeName,
      due_at: r.dueAt?.toISOString() ?? null,
      completed_at: r.completedAt?.toISOString() ?? null,
      overdue: r.overdue,
      external_ref: r.externalRef,
    }));
  return apiJson({ data });
}
