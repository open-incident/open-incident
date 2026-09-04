/** Maintenance windows on the clock: scheduled → in progress → completed, components in "maintenance" meanwhile. */
import { and, eq, inArray, lte } from "drizzle-orm";
import {
  statusPageMaintenanceUpdates,
  statusPageMaintenances,
  statusPages,
  withTenant,
} from "@openincident/db";
import { setComponentState } from "./publish";
import { refreshStatusSnapshot } from "./snapshot";

export async function sweepMaintenances(tenantIds: string[], now = new Date()): Promise<number> {
  let changed = 0;
  for (const tenantId of tenantIds) {
    const touchedPages = new Set<string>();
    await withTenant(tenantId, async (tx) => {
      const starting = await tx
        .select()
        .from(statusPageMaintenances)
        .where(
          and(
            eq(statusPageMaintenances.tenantId, tenantId),
            eq(statusPageMaintenances.status, "scheduled"),
            eq(statusPageMaintenances.autoTransitions, true),
            lte(statusPageMaintenances.startAt, now),
          ),
        );
      for (const m of starting) {
        await tx
          .update(statusPageMaintenances)
          .set({ status: "in_progress", updatedAt: now })
          .where(eq(statusPageMaintenances.id, m.id));
        await tx.insert(statusPageMaintenanceUpdates).values({
          tenantId,
          maintenanceId: m.id,
          status: "in_progress",
          body: "Maintenance in progress.",
          publishedAt: now,
        });
        for (const cid of m.componentIds)
          await setComponentState(tx, tenantId, cid, "maintenance", now, { maintenanceId: m.id });
        touchedPages.add(m.pageId);
        changed++;
      }
      const ending = await tx
        .select()
        .from(statusPageMaintenances)
        .where(
          and(
            eq(statusPageMaintenances.tenantId, tenantId),
            inArray(statusPageMaintenances.status, ["in_progress", "scheduled"]),
            eq(statusPageMaintenances.autoTransitions, true),
            lte(statusPageMaintenances.endAt, now),
          ),
        );
      for (const m of ending) {
        await tx
          .update(statusPageMaintenances)
          .set({ status: "completed", updatedAt: now })
          .where(eq(statusPageMaintenances.id, m.id));
        await tx.insert(statusPageMaintenanceUpdates).values({
          tenantId,
          maintenanceId: m.id,
          status: "completed",
          body: "Maintenance completed as planned.",
          publishedAt: now,
        });
        for (const cid of m.componentIds)
          await setComponentState(tx, tenantId, cid, "operational", now, { maintenanceId: m.id });
        touchedPages.add(m.pageId);
        changed++;
      }
      // Pages whose bars must roll over: refresh daily, cheaply, by touching every page once a day at the sweep.
      if (now.getUTCHours() === 0 && now.getUTCMinutes() < 2) {
        const pages = await tx
          .select({ id: statusPages.id })
          .from(statusPages)
          .where(eq(statusPages.tenantId, tenantId));
        for (const p of pages) touchedPages.add(p.id);
      }
    });
    for (const pageId of touchedPages) await refreshStatusSnapshot(tenantId, pageId);
  }
  return changed;
}
