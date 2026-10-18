import { cookies, headers } from "next/headers";
import { getStatusSnapshotForHost, type statusSnapshots } from "@openincident/db";
import { STATUS_ACCESS_COOKIE, verifyStatusAccess, type Snapshot } from "@openincident/statuspages";
import { schemeOf } from "@openincident/config";

export type SnapshotRow = typeof statusSnapshots.$inferSelect;

/**
 * The page behind the request's host — an unknown host is a 404, never a page.
 * An internal page without the member's access cookie is a 404 as well: to the
 * outside, it does not exist. `skipAccess` is for the door itself.
 */
export async function currentSnapshot(opts: { skipAccess?: boolean } = {}): Promise<{
  row: SnapshotRow;
  snap: Snapshot;
  origin: string;
} | null> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0]!.trim();
  const base = process.env.STATUS_BASE_DOMAIN ?? "status.localhost:3107";
  const row = await getStatusSnapshotForHost(
    host,
    base,
    process.env.STATUS_DEFAULT_PAGE || undefined,
  ).catch(() => null);
  if (!row) return null;
  const proto = schemeOf(host, h.get("x-forwarded-proto"));
  const snap = normalize(row.snapshot as unknown as Snapshot);
  if (snap.page.visibility === "internal" && !opts.skipAccess) {
    const jar = await cookies();
    if (!verifyStatusAccess(jar.get(STATUS_ACCESS_COOKIE)?.value, row.pageId)) return null;
  }
  return { row, snap, origin: `${proto}://${host}` };
}

/**
 * A snapshot as this page reads it, whatever version wrote it. Fields came in
 * over time; a page published before one existed still has to render — the
 * public page is the one screen that must never answer 500.
 */
function normalize(snap: Snapshot): Snapshot {
  return {
    ...snap,
    incidents: snap.incidents ?? [],
    maintenances: snap.maintenances ?? [],
    components: (snap.components ?? []).map((c) => ({
      ...c,
      description: c.description ?? null,
      groupName: c.groupName ?? null,
      ticks: c.ticks ?? [],
      uptime90: c.uptime90 ?? null,
      uptime30: c.uptime30 ?? null,
      source: c.source ?? (c.monitorId ? "monitor" : "manual"),
      monitorId: c.monitorId ?? null,
      monitorName: c.monitorName ?? null,
      responseMs: c.responseMs ?? null,
      lastIncidentAt: c.lastIncidentAt ?? null,
    })),
  };
}
