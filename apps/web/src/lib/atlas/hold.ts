/**
 * "✦ Atlas tries first" (spec delta §8.2, §15.1): at level 4 nobody is paged
 * unless Atlas gets stuck, hits a guardrail or is stopped. The alert pipeline
 * asks here how long to hold the first page of an escalation that comes with
 * an incident; Atlas releases the hold early the moment it needs a person
 * (host op "page"), and resolving the incident cancels the escalation. If
 * Atlas never gets there — no worker, a failure — the hold simply runs out
 * and the page goes, late by at most this long: never lost.
 *
 * Owner: atlas-core. Caller: lib/alert-ingest.ts (startOne).
 */
import "server-only";
import { aiConfigured } from "@openincident/ai";
import { getTenantById, withTenant } from "@openincident/db";
import { atlas } from "@openincident/investigations";
import { investigationAccess } from "@/lib/investigations";

/** How long Atlas has, at level 4, before the policy pages as written. */
export const ATLAS_HOLD_MINUTES = 10;

export async function atlasPagingHoldMinutes(
  tenantId: string,
  incidentId: string | null,
): Promise<number> {
  if (!incidentId || !aiConfigured()) return 0;
  try {
    const tenant = await getTenantById(tenantId);
    if (!tenant || !(await investigationAccess(tenant)).ok) return 0;
    return await withTenant(tenantId, async (tx) => {
      const facts = await atlas.incidentFactsTx(tx, tenantId, incidentId);
      if (!facts?.serviceId || facts.mode !== "live") return 0;
      const settings = await atlas.readSettingsTx(tx, tenantId);
      if (settings.killSwitch) return 0;
      if ((await atlas.budgetStateTx(tx, tenantId, settings)).exhausted) return 0;
      const a = await atlas.autonomyOfTx(tx, tenantId, facts.serviceId);
      if (atlas.effectiveLevel(a.level, a.cap) < 4) return 0;
      if ((await atlas.directiveOfTx(tx, tenantId, incidentId)) === "never") return 0;
      // The guardrails that would stop it acting alone stop the hold too.
      const g = settings.guardrails;
      if (g.sev1 && facts.severityRank === 0) return 0;
      if (g.securityAndPrivate && (facts.privateType || facts.visibility === "private")) return 0;
      return ATLAS_HOLD_MINUTES;
    });
  } catch (err) {
    console.error("[atlas] hold check failed:", err);
    return 0;
  }
}
