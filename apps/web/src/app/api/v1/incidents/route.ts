import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { incidents, withTenant } from "@openincident/db";
import { incidentPayload } from "@openincident/webhooks";
import {
  apiAuth,
  apiError,
  apiJson,
  decodeCursor,
  encodeCursor,
  pageLimit,
  readJson,
} from "@/lib/api";
import { resolveService, resolveSeverity, resolveType } from "@/lib/api-resolve";
import {
  afterIncidentChange,
  coerceCustomFields,
  declareIncidentCore,
} from "@/lib/incident-writes";

export const dynamic = "force-dynamic";

/** GET /api/v1/incidents?phase=active&cursor=…&limit=100 — newest activity first. */
export async function GET(request: Request) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const limit = pageLimit(url);
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const phase = url.searchParams.get("phase");
  if (phase && !["triage", "active", "post_incident", "closed"].includes(phase)) {
    return apiError(
      400,
      "invalid_parameter",
      "`phase` must be triage, active, post_incident or closed.",
    );
  }
  const tenantId = auth.ctx.tenant.id;
  const result = await withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({ id: incidents.id, lastActivityAt: incidents.lastActivityAt })
      .from(incidents)
      .where(
        and(
          eq(incidents.tenantId, tenantId),
          isNull(incidents.mergedIntoId),
          phase ? eq(incidents.phase, phase as "active") : undefined,
          cursor
            ? or(
                lt(incidents.lastActivityAt, cursor.at),
                and(eq(incidents.lastActivityAt, cursor.at), lt(incidents.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(incidents.lastActivityAt), desc(incidents.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const data = [];
    for (const r of page) {
      const p = await incidentPayload(tx, tenantId, r.id);
      if (p) data.push(p);
    }
    const last = page[page.length - 1];
    return {
      data,
      next_cursor: rows.length > limit && last ? encodeCursor(last.lastActivityAt, last.id) : null,
    };
  });
  return apiJson(result);
}

const createSchema = z.object({
  name: z.string().trim().min(3).max(200),
  summary: z.string().trim().max(4000).optional(),
  type: z.string().optional(),
  severity: z.string().optional(),
  service: z.string().optional(),
  mode: z.enum(["live", "retrospective", "test"]).default("live"),
  declared_at: z.string().datetime().optional(),
  custom_fields: z.record(z.string(), z.unknown()).default({}),
});

/** POST /api/v1/incidents — the same write path as the web form. */
export async function POST(request: Request) {
  const auth = await apiAuth(request, "incident:create");
  if (!auth.ok) return auth.response;
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = createSchema.safeParse(body.body);
  if (!parsed.success)
    return apiError(
      422,
      "invalid_body",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  const input = parsed.data;
  const tenantId = auth.ctx.tenant.id;

  const outcome = await withTenant(tenantId, async (tx) => {
    const type = await resolveType(tx, tenantId, input.type);
    if (!type) return { error: apiError(422, "unknown_type", `No incident type "${input.type}".`) };
    if (type.restrictedToTeamIds && type.restrictedToTeamIds.length > 0)
      return {
        error: apiError(403, "type_restricted", "This type can only be declared by its team."),
      };
    const sev = await resolveSeverity(tx, tenantId, input.severity);
    if (input.severity && !sev)
      return { error: apiError(422, "unknown_severity", `No severity "${input.severity}".`) };
    const service = await resolveService(tx, tenantId, input.service);
    if (input.service && !service)
      return {
        error: apiError(422, "unknown_service", `No service "${input.service}" in the catalog.`),
      };
    const requiredMissing = type.declareForm.filter(
      (f) =>
        f.required &&
        ((f.key === "severity" && !sev) ||
          (f.key === "service" && !service) ||
          (!["title", "severity", "service", "summary"].includes(f.key) &&
            (input.custom_fields[f.key] === undefined || input.custom_fields[f.key] === ""))),
    );
    if (requiredMissing.length > 0)
      return {
        error: apiError(
          422,
          "missing_field",
          `Required by the type "${type.name}": ${requiredMissing.map((f) => f.key).join(", ")}.`,
        ),
      };
    const created = await declareIncidentCore(
      tx,
      tenantId,
      { kind: "api", memberId: null, name: auth.ctx.key.name },
      {
        name: input.name,
        summary: input.summary,
        mode: input.mode,
        typeId: type.id,
        severityId: sev?.id ?? null,
        serviceEntryId: service?.id ?? null,
        customFields: await coerceCustomFields(tx, tenantId, input.custom_fields),
        declaredAt: input.declared_at ? new Date(input.declared_at) : undefined,
        source: "api",
      },
    );
    const payload = await incidentPayload(tx, tenantId, created.id);
    return { created, payload };
  });
  if ("error" in outcome) return outcome.error;
  await afterIncidentChange(tenantId, outcome.created.id, ["incident.created"]);
  return apiJson(outcome.payload, 201, { location: `/api/v1/incidents/${outcome.created.number}` });
}
