import { eq, sql } from "drizzle-orm";
import { statusPages, withTenant } from "@openincident/db";

/** Feed readers are counted, not identified — the "RSS / Atom" number of the admin screen. Best effort. */
export async function countFeedHit(tenantId: string, pageId: string): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(statusPages)
      .set({ feedHits: sql`${statusPages.feedHits} + 1` })
      .where(eq(statusPages.id, pageId)),
  ).catch(() => {});
}
