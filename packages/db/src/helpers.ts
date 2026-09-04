import { eq, sql } from "drizzle-orm";
import type { Tx } from "./client";
import { incidents } from "./schema/app";

/**
 * Per-workspace sequential number — the unique index (tenant_id, number)
 * guards against races: on a collision, the caller retries.
 */
export async function nextIncidentNumber(tx: Tx, tenantId: string): Promise<number> {
  const [row] = await tx
    .select({ max: sql<number>`coalesce(max(${incidents.number}), 0)` })
    .from(incidents)
    .where(eq(incidents.tenantId, tenantId));
  return Number(row?.max ?? 0) + 1;
}

/** Two letters from a name, the rule every avatar in the product follows. */
export function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const letters = parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return letters || "?";
}
