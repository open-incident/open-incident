import { and, eq } from "drizzle-orm";
import { incidents, investigations, withTenant } from "@openincident/db";
import { apiAuth, apiError, apiJson } from "@/lib/api";
import { investigationAccess, requestAssessment } from "@/lib/investigations";

export const dynamic = "force-dynamic";

function parseNumber(raw: string): number | null {
  const n = Number(raw.replace(/^INC-/i, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** camelCase rows become the API's snake_case, all the way down. */
function snake(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snake);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
        snake(v),
      ]),
    );
  return value;
}

/** GET /api/v1/incidents/{number}/investigation — the root cause analysis (RCA). */
export async function GET(request: Request, { params }: { params: Promise<{ number: string }> }) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const number = parseNumber((await params).number);
  if (!number) return apiError(404, "not_found", "No such incident.");
  const tenantId = auth.ctx.tenant.id;
  const row = await withTenant(tenantId, async (tx) => {
    const [inc] = await tx
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.number, number)));
    if (!inc) return null;
    const [inv] = await tx
      .select()
      .from(investigations)
      .where(eq(investigations.incidentId, inc.id));
    return inv ?? "none";
  });
  if (!row) return apiError(404, "not_found", "No such incident.");
  if (row === "none")
    return apiError(404, "no_analysis", "No root cause analysis for this incident yet.");
  // Internal ids and the chat message reference stay inside; the rest is the analysis.
  const hidden = new Set(["id", "tenantId", "incidentId", "chatRef", "gradedByMemberId"]);
  const rest = Object.fromEntries(Object.entries(row).filter(([k]) => !hidden.has(k)));
  return apiJson({ incident: `INC-${number}`, ...(snake(rest) as Record<string, unknown>) });
}

/** POST /api/v1/incidents/{number}/investigation — ask for a new assessment (scope write). */
export async function POST(request: Request, { params }: { params: Promise<{ number: string }> }) {
  const auth = await apiAuth(request, "write");
  if (!auth.ok) return auth.response;
  const number = parseNumber((await params).number);
  if (!number) return apiError(404, "not_found", "No such incident.");
  const tenantId = auth.ctx.tenant.id;
  const [inc] = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.number, number))),
  );
  if (!inc) return apiError(404, "not_found", "No such incident.");
  const access = await investigationAccess(auth.ctx.tenant);
  if (!access.ok)
    return apiError(
      409,
      "unavailable",
      access.reason === "edition"
        ? "Root cause analysis is part of the enterprise edition and is not enabled here."
        : `Root cause analysis is not available: ${access.reason}.`,
    );
  const r = await requestAssessment(auth.ctx.tenant, inc.id, "api", {
    kind: "api",
    memberId: null,
    name: auth.ctx.key.name,
  });
  if (!r.ok)
    return apiError(409, "unavailable", `Root cause analysis is not available: ${r.reason}.`);
  return apiJson({ status: r.outcome === "coalesced" ? "running" : "queued" }, 202);
}
