import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { auditEvents, withTenant } from "@openincident/db";
import { AREAS, areaOf, type Area } from "./sentence";

/**
 * What the audit screen and its CSV export read: the count of lines per
 * area, and the lines of one area, newest first.
 *
 * The area of a line is derived from its action (and, for an action the
 * product does not name, its category). The counts are read grouped by
 * action, so the filter becomes a list of actions the database matches —
 * no line is loaded to be counted.
 */

export type AuditRow = typeof auditEvents.$inferSelect;

export function parseArea(raw: string | undefined): Area | null {
  return AREAS.includes(raw as Area) ? (raw as Area) : null;
}

export async function auditCounts(
  tenantId: string,
): Promise<{ total: number; byArea: Record<Area, number>; keysOf: Record<Area, string[]> }> {
  const groups = await withTenant(tenantId, (tx) =>
    tx
      .select({
        action: auditEvents.action,
        category: auditEvents.category,
        n: sql<number>`count(*)::int`,
      })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, tenantId))
      .groupBy(auditEvents.action, auditEvents.category),
  );
  const byArea = Object.fromEntries(AREAS.map((a) => [a, 0])) as Record<Area, number>;
  const keysOf = Object.fromEntries(AREAS.map((a) => [a, [] as string[]])) as Record<
    Area,
    string[]
  >;
  let total = 0;
  for (const g of groups) {
    const area = areaOf(g.action, g.category);
    byArea[area] += Number(g.n);
    keysOf[area].push(`${g.action}|${g.category}`);
    total += Number(g.n);
  }
  return { total, byArea, keysOf };
}

/** The lines of one area (all areas when null), newest first. */
export async function auditLines(
  tenantId: string,
  keys: string[] | null,
  offset: number,
  limit: number,
): Promise<AuditRow[]> {
  if (keys && keys.length === 0) return [];
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, tenantId),
          keys
            ? inArray(sql<string>`${auditEvents.action} || '|' || ${auditEvents.category}`, keys)
            : undefined,
        ),
      )
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
      .offset(offset)
      .limit(limit),
  );
}
