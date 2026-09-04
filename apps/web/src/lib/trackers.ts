import { and, eq, inArray } from "drizzle-orm";
import { integrationInstalls, type Tx } from "@openincident/db";
import { TRACKER_KINDS, trackerLabel, type TrackerKind } from "@openincident/trackers";

export type ConnectedTracker = { kind: TrackerKind; label: string };

/** The trackers a follow-up can be exported to — kinds and labels only, nothing secret. */
export async function connectedTrackers(tx: Tx, tenantId: string): Promise<ConnectedTracker[]> {
  const rows = await tx
    .select({ kind: integrationInstalls.kind })
    .from(integrationInstalls)
    .where(
      and(
        eq(integrationInstalls.tenantId, tenantId),
        eq(integrationInstalls.status, "active"),
        inArray(integrationInstalls.kind, TRACKER_KINDS),
      ),
    );
  return rows
    .map((r) => r.kind)
    .filter((k): k is TrackerKind => (TRACKER_KINDS as string[]).includes(k))
    .map((kind) => ({ kind, label: trackerLabel(kind) }));
}
