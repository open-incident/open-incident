import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { followUps, incidents, members, withTenant } from "@openincident/db";
import { apiAuth, apiError, apiJson, readJson } from "@/lib/api";
import { addFollowUpCore, afterIncidentChange } from "@/lib/incident-writes";

export const dynamic = "force-dynamic";

const schema = z.object({
  title: z.string().trim().min(1).max(300),
  priority: z.string().optional(),
  assignee_email: z.string().email().optional(),
});

/** POST /api/v1/incidents/{number}/follow-ups */
export async function POST(request: Request, { params }: { params: Promise<{ number: string }> }) {
  const auth = await apiAuth(request, "write");
  if (!auth.ok) return auth.response;
  const number = Number((await params).number.replace(/^INC-/i, ""));
  if (!Number.isInteger(number) || number <= 0)
    return apiError(404, "not_found", "No such incident.");
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
  const outcome = await withTenant(tenantId, async (tx) => {
    const [inc] = await tx
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.number, number)));
    if (!inc) return { error: apiError(404, "not_found", "No such incident.") };
    const [assignee] = input.assignee_email
      ? await tx
          .select({ id: members.id })
          .from(members)
          .where(
            and(
              eq(members.tenantId, tenantId),
              eq(members.email, input.assignee_email.toLowerCase()),
            ),
          )
      : [];
    if (input.assignee_email && !assignee)
      return { error: apiError(422, "unknown_member", `No member ${input.assignee_email}.`) };
    const created = await addFollowUpCore(
      tx,
      tenantId,
      { kind: "api", memberId: null, name: auth.ctx.key.name },
      inc.id,
      {
        title: input.title,
        priorityName: input.priority ?? null,
        assigneeMemberId: assignee?.id ?? null,
      },
    );
    if (!created) return { error: apiError(404, "not_found", "No such incident.") };
    const [row] = await tx.select().from(followUps).where(eq(followUps.id, created.id));
    return { incidentId: inc.id, row: row! };
  });
  if ("error" in outcome) return outcome.error;
  await afterIncidentChange(tenantId, outcome.incidentId, ["follow_up.created"], {
    follow_up: {
      id: outcome.row.id,
      title: outcome.row.title,
      status: outcome.row.status,
      due_at: outcome.row.dueAt?.toISOString() ?? null,
    },
  });
  return apiJson(
    {
      id: outcome.row.id,
      title: outcome.row.title,
      status: outcome.row.status,
      due_at: outcome.row.dueAt?.toISOString() ?? null,
      incident_number: number,
    },
    201,
  );
}
