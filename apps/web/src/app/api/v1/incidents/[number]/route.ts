import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { incidentEvents, incidents, withTenant } from "@openincident/db";
import { incidentPayload } from "@openincident/webhooks";
import { apiAuth, apiError, apiJson, readJson } from "@/lib/api";
import { afterIncidentChange, coerceCustomFields } from "@/lib/incident-writes";

export const dynamic = "force-dynamic";

function parseNumber(raw: string): number | null {
  const n = Number(raw.replace(/^INC-/i, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** GET /api/v1/incidents/{number} — `217` or `INC-217`. */
export async function GET(request: Request, { params }: { params: Promise<{ number: string }> }) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const number = parseNumber((await params).number);
  if (!number) return apiError(404, "not_found", "No such incident.");
  const tenantId = auth.ctx.tenant.id;
  const payload = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.number, number)));
    return row ? incidentPayload(tx, tenantId, row.id) : null;
  });
  if (!payload) return apiError(404, "not_found", "No such incident.");
  return apiJson(payload);
}

const patchSchema = z.object({
  name: z.string().trim().min(3).max(200).optional(),
  summary: z.string().trim().max(4000).nullable().optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});

/** PATCH /api/v1/incidents/{number} — name, summary, custom fields. Status goes through /updates. */
export async function PATCH(request: Request, { params }: { params: Promise<{ number: string }> }) {
  const auth = await apiAuth(request, "write");
  if (!auth.ok) return auth.response;
  const number = parseNumber((await params).number);
  if (!number) return apiError(404, "not_found", "No such incident.");
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = patchSchema.safeParse(body.body);
  if (!parsed.success)
    return apiError(
      422,
      "invalid_body",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  const input = parsed.data;
  const tenantId = auth.ctx.tenant.id;
  const actor = { kind: "api" as const, memberId: null, name: auth.ctx.key.name };

  const result = await withTenant(tenantId, async (tx) => {
    const [inc] = await tx
      .select()
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.number, number)));
    if (!inc) return null;
    const now = new Date();
    const patch: Partial<typeof incidents.$inferInsert> = { updatedAt: now, lastActivityAt: now };
    if (input.name && input.name !== inc.name) {
      patch.name = input.name;
      await tx.insert(incidentEvents).values({
        tenantId,
        incidentId: inc.id,
        kind: "renamed",
        actorKind: "api",
        actorName: actor.name,
        payload: { from: inc.name, to: input.name },
        occurredAt: now,
      });
    }
    if (input.summary !== undefined) patch.summary = input.summary;
    if (input.custom_fields) {
      const next = {
        ...inc.customFields,
        ...(await coerceCustomFields(tx, tenantId, input.custom_fields)),
      };
      for (const [key, value] of Object.entries(next)) {
        if (inc.customFields[key] !== value) {
          await tx.insert(incidentEvents).values({
            tenantId,
            incidentId: inc.id,
            kind: "custom_field_changed",
            actorKind: "api",
            actorName: actor.name,
            payload: { field: key, from: inc.customFields[key] ?? null, to: value },
            occurredAt: now,
          });
        }
      }
      patch.customFields = next;
    }
    await tx.update(incidents).set(patch).where(eq(incidents.id, inc.id));
    return { id: inc.id, payload: await incidentPayload(tx, tenantId, inc.id) };
  });
  if (!result) return apiError(404, "not_found", "No such incident.");
  await afterIncidentChange(tenantId, result.id, ["incident.updated"]);
  return apiJson(result.payload);
}
