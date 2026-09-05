import { and, eq, ne } from "drizzle-orm";
import { members, withTenant } from "@openincident/db";

/**
 * Occupied seats — the definition the entitlements name (maxMembers): owners,
 * admins and responders who are not disabled. Viewers are free.
 */
export async function occupiedSeats(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          eq(members.tenantId, tenantId),
          ne(members.status, "disabled"),
          ne(members.role, "viewer"),
        ),
      );
    return rows.length;
  });
}
