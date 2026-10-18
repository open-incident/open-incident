/**
 * The worker's minute: fixes waiting for verification, incidents reopened
 * after Atlas resolved them, the 09:00 summaries, and — every quarter of an
 * hour — the promotions a closing undo window may have earned.
 */
import { and, eq, gte } from "drizzle-orm";
import { investigations, serviceAutonomy, withTenant } from "@openincident/db";
import { verifyPending } from "./engine";
import type { AtlasHost } from "./host";
import { maybePromoteTx, setLevelTx } from "./ladder";
import { levelAfter } from "./rules";
import { dueSummaries, markSummarySent, reopenedAfterAtlasTx } from "./summary";

export const ATLAS_SWEEP_QUEUE = "atlas-sweep";

export async function atlasSweep(
  tenantIds: string[],
  host: AtlasHost,
  now = new Date(),
): Promise<{ verified: number; reopened: number; summaries: number; promoted: number }> {
  const out = { verified: 0, reopened: 0, summaries: 0, promoted: 0 };
  for (const tenantId of tenantIds) {
    try {
      out.verified += await verifyPending(tenantId, host, now);
      out.reopened += await withTenant(tenantId, async (tx) => {
        const rows = await reopenedAfterAtlasTx(tx, tenantId);
        for (const r of rows) {
          await tx
            .update(investigations)
            .set({ reviewState: "reopened", updatedAt: now })
            .where(eq(investigations.id, r.inv));
          if (!r.serviceId) continue;
          const [cur] = await tx
            .select({ level: serviceAutonomy.level })
            .from(serviceAutonomy)
            .where(eq(serviceAutonomy.serviceId, r.serviceId));
          await setLevelTx(
            tx,
            tenantId,
            r.serviceId,
            levelAfter(cur?.level ?? 0, "reopen"),
            "reopen",
            null,
            { investigationId: r.inv, note: "reopened after Atlas resolved it" },
          );
        }
        return rows.length;
      });
      for (const s of await dueSummaries(tenantId, now)) {
        const r = await host.run({ op: "summary", tenantId, memberId: s.memberId });
        if (r.ok) {
          await markSummarySent(tenantId, s.memberId, now);
          out.summaries++;
        }
      }
      if (now.getUTCMinutes() % 15 === 0)
        out.promoted += await withTenant(tenantId, async (tx) => {
          const rows = await tx
            .select({ id: serviceAutonomy.serviceId })
            .from(serviceAutonomy)
            .where(and(eq(serviceAutonomy.tenantId, tenantId), gte(serviceAutonomy.level, 0)));
          let n = 0;
          for (const r of rows) if (await maybePromoteTx(tx, tenantId, r.id)) n++;
          return n;
        });
    } catch (err) {
      console.error(`[atlas-sweep] ${tenantId}:`, err instanceof Error ? err.message : err);
    }
  }
  return out;
}
