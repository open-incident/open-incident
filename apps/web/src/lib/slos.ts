import "server-only";

/**
 * Reading and writing service level objectives.
 *
 * The evaluation lives in the worker; this is what the screens need — the list
 * with its last reading, one SLO in full, and the shape a new one is created
 * in. A creation compiles both expressions before the row exists: an SLO whose
 * query does not run is an SLO that shows a dash for ever while somebody
 * believes it is watching.
 */
import { and, asc, eq } from "drizzle-orm";
import { services, slos, withTenant, type Tx } from "@openincident/db";
import { PromqlError, parsePromql } from "@openincident/telemetry";

export async function listSlos(tx: Tx, tenantId: string) {
  return tx
    .select({
      id: slos.id,
      name: slos.name,
      objective: slos.objective,
      windowKind: slos.windowKind,
      windowDays: slos.windowDays,
      paused: slos.paused,
      burnState: slos.burnState,
      burnSince: slos.burnSince,
      lastSli: slos.lastSli,
      lastBudgetLeft: slos.lastBudgetLeft,
      lastFastBurn: slos.lastFastBurn,
      lastSlowBurn: slos.lastSlowBurn,
      lastDetail: slos.lastDetail,
      lastEvaluatedAt: slos.lastEvaluatedAt,
      serviceKey: services.key,
    })
    .from(slos)
    .leftJoin(services, eq(services.id, slos.serviceId))
    .where(eq(slos.tenantId, tenantId))
    .orderBy(asc(slos.name));
}

export type SloRow = Awaited<ReturnType<typeof listSlos>>[number];

export async function getSlo(tx: Tx, tenantId: string, id: string) {
  const [row] = await tx
    .select({
      slo: slos,
      serviceKey: services.key,
    })
    .from(slos)
    .leftJoin(services, eq(services.id, slos.serviceId))
    .where(and(eq(slos.tenantId, tenantId), eq(slos.id, id)));
  return row ?? null;
}

/**
 * Whether both expressions would run, and whether they could form a ratio.
 *
 * The second check is the one worth having: two expressions that each compile
 * but count different things produce an SLI above 100 % or below 0, and the
 * reader would have to notice that themselves. The evaluation refuses it too,
 * but by then the SLO exists and has been quietly wrong for a day.
 */
export function sloQueryError(goodQuery: string, totalQuery: string): string | null {
  for (const [label, query] of [
    ["good", goodQuery],
    ["total", totalQuery],
  ] as const) {
    try {
      parsePromql(query);
    } catch (err) {
      if (err instanceof PromqlError) return `${label}: ${err.message}`;
      throw err;
    }
  }
  if (goodQuery.trim() === totalQuery.trim()) {
    return "the two expressions are identical, so the indicator would always read 100 %";
  }
  return null;
}

export { withTenant };
