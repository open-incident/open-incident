/**
 * Root cause analysis (RCA), from the product's side: who may have it, and
 * how an assessment is asked for. The entitlement (enterprise edition) is read
 * here because the engine has no notion of editions; the capability's own
 * switch is the same governance every AI function obeys.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { incidents, withTenant, type InvestigationTrigger, type Tenant } from "@openincident/db";
import type { Actor } from "@openincident/ai";
import { startInvestigation } from "@openincident/investigations";
import { tenantOrigin } from "@openincident/oncall";
import { entitlementsFor } from "@/lib/entitlements";
import { aiAllowance, type AiRefusal } from "@/lib/ai-capabilities";

export type InvestigationAccess = { ok: true } | { ok: false; reason: "edition" | AiRefusal };

/** Edition first, then the workspace's AI governance — in that order, so the message names the real obstacle. */
export async function investigationAccess(tenant: Tenant): Promise<InvestigationAccess> {
  if (!entitlementsFor(tenant).aiInvestigations) return { ok: false, reason: "edition" };
  const a = await aiAllowance(tenant.id, "investigate");
  return a.ok ? { ok: true } : { ok: false, reason: a.reason };
}

export type AssessmentRequest =
  | { ok: true; outcome: "queued" | "coalesced" | "inline" }
  | { ok: false; reason: "edition" | AiRefusal };

/** Asks for an assessment of one incident, when the workspace may have one. */
export async function requestAssessment(
  tenant: Tenant,
  incidentId: string,
  trigger: InvestigationTrigger,
  actor?: Actor,
  opts: { delayMs?: number } = {},
): Promise<AssessmentRequest> {
  const access = await investigationAccess(tenant);
  if (!access.ok) return access;
  const outcome = await startInvestigation(
    {
      tenantId: tenant.id,
      incidentId,
      trigger,
      origin: tenantOrigin(tenant.slug, tenant.customDomain),
      ...(actor ? { actor } : {}),
    },
    opts,
  );
  return { ok: true, outcome };
}

/**
 * A new signal — a change recorded, an alert attached — re-assesses the open
 * incidents it may concern: those of the service, or every open one when the
 * signal names no service. Coalesced by the queue, so a burst is one run.
 */
export async function signalOpenIncidents(
  tenant: Tenant,
  serviceEntryId: string | null,
): Promise<void> {
  const access = await investigationAccess(tenant);
  if (!access.ok) return;
  const open = await withTenant(tenant.id, (tx) =>
    tx
      .select({ id: incidents.id })
      .from(incidents)
      .where(
        and(
          eq(incidents.tenantId, tenant.id),
          inArray(incidents.phase, ["triage", "active"]),
          eq(incidents.mode, "live"),
          serviceEntryId
            ? or(eq(incidents.serviceEntryId, serviceEntryId), isNull(incidents.serviceEntryId))
            : undefined,
        ),
      )
      .limit(10),
  );
  for (const inc of open)
    await requestAssessment(tenant, inc.id, "signal", undefined, { delayMs: 20_000 }).catch((err) =>
      console.error("[investigation] signal failed:", err),
    );
}
