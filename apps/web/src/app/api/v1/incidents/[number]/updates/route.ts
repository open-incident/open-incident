import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { incidentStatuses, incidents, withTenant } from "@openincident/db";
import { incidentPayload, type WebhookEvent } from "@openincident/webhooks";
import { apiAuth, apiError, apiJson, readJson } from "@/lib/api";
import { resolveSeverity, workspaceTranslate } from "@/lib/api-resolve";
import { afterIncidentChange, postUpdateCore } from "@/lib/incident-writes";

export const dynamic = "force-dynamic";

const schema = z.object({
  /** A status name of the incident's type, or "resolved". Omitted: the status stays. */
  status: z.string().optional(),
  message: z.string().trim().min(1).max(4000),
  severity: z.string().optional(),
  next_update_in_minutes: z
    .number()
    .int()
    .positive()
    .max(24 * 60)
    .optional(),
});

/** POST /api/v1/incidents/{number}/updates — the status update, the same gesture as the web. */
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
      .select()
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.number, number)));
    if (!inc) return { error: apiError(404, "not_found", "No such incident.") };
    if (inc.phase === "closed")
      return { error: apiError(409, "incident_closed", "This incident is closed.") };
    if (inc.phase === "triage")
      return {
        error: apiError(
          409,
          "incident_in_triage",
          "Accept the incident from triage before updating it.",
        ),
      };
    let statusId: string;
    if (!input.status) {
      if (!inc.statusId)
        return {
          error: apiError(422, "status_required", "This incident has no status yet: name one."),
        };
      statusId = inc.statusId;
    } else if (/^resolved?$/i.test(input.status)) {
      statusId = "resolve";
    } else {
      const [st] = await tx
        .select()
        .from(incidentStatuses)
        .where(
          and(eq(incidentStatuses.typeId, inc.typeId), eq(incidentStatuses.name, input.status)),
        );
      if (!st)
        return {
          error: apiError(
            422,
            "unknown_status",
            `No status "${input.status}" for this incident's type.`,
          ),
        };
      statusId = st.id;
    }
    const sev = await resolveSeverity(tx, tenantId, input.severity);
    if (input.severity && !sev)
      return { error: apiError(422, "unknown_severity", `No severity "${input.severity}".`) };
    const t = await workspaceTranslate(tx, tenantId);
    const result = await postUpdateCore(
      tx,
      tenantId,
      { kind: "api", memberId: null, name: auth.ctx.key.name },
      inc.id,
      {
        statusId,
        message: input.message,
        severityId: sev?.id ?? null,
        nextUpdateMinutes: input.next_update_in_minutes ?? null,
        resolvedLabel: t("incident.update.resolved"),
      },
    );
    if (!result)
      return { error: apiError(409, "not_applicable", "The update could not be applied.") };
    return { id: inc.id, result, payload: await incidentPayload(tx, tenantId, inc.id) };
  });
  if ("error" in outcome) return outcome.error;
  const events: WebhookEvent[] = ["incident.update_published"];
  if (outcome.result.statusChanged || outcome.result.severityChanged)
    events.push("incident.updated");
  if (outcome.result.resolved) events.push("incident.resolved");
  await afterIncidentChange(tenantId, outcome.id, events, {
    message: input.message,
    by: auth.ctx.key.name,
  });
  return apiJson(outcome.payload, 201);
}
