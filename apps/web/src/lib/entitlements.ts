/**
 * Workspace entitlements — resolved from the directory row.
 *
 * Standalone, the install has the full core with no ceiling. Driven by a
 * control plane, the workspace carries its entitlements in a denormalised
 * column: the product reads them, never computes them, and falls back to the
 * core when they are missing — a control plane outage must not close the
 * product down.
 */
import { CORE_ENTITLEMENTS, isSelfHosted, type Entitlements } from "@openincident/config";
import type { Tenant } from "@openincident/db";

export type { Entitlements };

/**
 * Standalone, the enterprise capabilities are switched on by the operator:
 * OI_ENTITLEMENTS lists them (`sso,customRoles,auditLogAdvanced`). Development
 * and testing are free under ee/LICENSE; production needs the agreement.
 */
function selfHostedEntitlements(): Entitlements {
  const listed = (process.env.OI_ENTITLEMENTS ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (listed.length === 0) return CORE_ENTITLEMENTS;
  const out: Entitlements = { ...CORE_ENTITLEMENTS };
  for (const key of listed)
    if (key in out && typeof out[key as keyof Entitlements] === "boolean")
      (out as unknown as Record<string, boolean>)[key] = true;
  return out;
}

export function entitlementsFor(tenant: Pick<Tenant, "entitlements">): Entitlements {
  if (isSelfHosted()) return selfHostedEntitlements();
  const resolved = tenant.entitlements as Partial<Entitlements> | null;
  // Tolerant merge: an entitlement added to the type after resolution keeps its
  // default instead of vanishing.
  return resolved ? { ...CORE_ENTITLEMENTS, ...resolved } : CORE_ENTITLEMENTS;
}
