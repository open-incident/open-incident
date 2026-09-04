import { cookies, headers } from "next/headers";
import { getStatusSnapshotForHost, type statusSnapshots } from "@openincident/db";
import { STATUS_ACCESS_COOKIE, verifyStatusAccess, type Snapshot } from "@openincident/statuspages";

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
  const proto =
    h.get("x-forwarded-proto") ?? (/localhost|127\.0\.0\.1/.test(host) ? "http" : "https");
  const snap = row.snapshot as unknown as Snapshot;
  if (snap.page.visibility === "internal" && !opts.skipAccess) {
    const jar = await cookies();
    if (!verifyStatusAccess(jar.get(STATUS_ACCESS_COOKIE)?.value, row.pageId)) return null;
  }
  return { row, snap, origin: `${proto}://${host}` };
}
