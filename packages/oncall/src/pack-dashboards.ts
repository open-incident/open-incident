/**
 * A collector pack's dashboard, placed the first time that pack reports.
 *
 * Running a pack takes two minutes and then a workspace has several hundred
 * series and no screen that reads them. The dashboards exist
 * (packages/telemetry/src/packs.ts); the missing step was somebody knowing to
 * go and ask for one. So the first signal from a receiver we ship a pack for
 * places its dashboard, once.
 *
 * Once, and recorded as such. `packsPlaced` on the workspace's telemetry
 * settings is what makes this not happen again — not "does the dashboard still
 * exist", because deleting it is an answer and re-creating it at the next
 * sweep would be the product arguing. Renaming it, rewriting its panels and
 * deleting half of them are all allowed for the same reason: after the first
 * placement, the dashboard belongs to the workspace.
 */
import { and, eq } from "drizzle-orm";
import { dashboards, telemetrySettings, withTenant } from "@openincident/db";
import {
  PACKS,
  packById,
  telemetryInstalled,
  tenantsReportingPacks,
} from "@openincident/telemetry";
import type { PackId } from "@openincident/telemetry";

export type PackPlacement = { tenantId: string; pack: PackId; slug: string };
export type PackSweepResult = {
  /** Workspaces that had at least one pack reporting. */
  checked: number;
  placed: PackPlacement[];
  failed: number;
};

/**
 * Places the dashboard for a pack, unless this workspace has already had it.
 *
 * Returns the slug of the dashboard it created, or null when the pack had
 * already been placed — the caller can then look the existing one up rather
 * than making a second.
 */
export async function placePack(
  tenantId: string,
  packId: PackId,
  createdByMemberId: string | null = null,
): Promise<string | null> {
  const pack = packById(packId);
  if (!pack) throw new Error(`unknown pack "${packId}"`);

  return withTenant(tenantId, async (tx) => {
    const [settings] = await tx
      .select({ placed: telemetrySettings.packsPlaced })
      .from(telemetrySettings)
      .where(eq(telemetrySettings.tenantId, tenantId));
    const already = settings?.placed ?? [];
    if (already.includes(packId)) return null;

    // A slug collision is a rename, not a failure: a workspace may already
    // have a dashboard called "hosts" of its own making.
    const base = `${packId}-pack`;
    let slug = base;
    for (let n = 2; n < 50; n++) {
      const [taken] = await tx
        .select({ id: dashboards.id })
        .from(dashboards)
        .where(and(eq(dashboards.tenantId, tenantId), eq(dashboards.slug, slug)));
      if (!taken) break;
      slug = `${base}-${n}`;
    }

    await tx.insert(dashboards).values({
      tenantId,
      slug,
      title: pack.title,
      description: pack.description,
      layout: { panels: pack.panels },
      variables: [],
      createdByMemberId,
      importedFrom: `pack:${packId}`,
    });

    // The settings row may not exist yet on a workspace that never opened the
    // telemetry screen; the pack still reported, so it is created here.
    await tx
      .insert(telemetrySettings)
      .values({ tenantId, packsPlaced: [...already, packId] })
      .onConflictDoUpdate({
        target: telemetrySettings.tenantId,
        set: { packsPlaced: [...already, packId], updatedAt: new Date() },
      });

    return slug;
  });
}

/** The dashboard a pack was placed as, if it is still there. */
export async function packDashboardSlug(tenantId: string, packId: PackId): Promise<string | null> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ slug: dashboards.slug })
      .from(dashboards)
      .where(and(eq(dashboards.tenantId, tenantId), eq(dashboards.importedFrom, `pack:${packId}`)));
    return row?.slug ?? null;
  });
}

/** The same, for every pack at once — what a screen listing them needs. */
export async function packDashboardSlugs(
  tenantId: string,
): Promise<Partial<Record<PackId, string>>> {
  const rows = await withTenant(tenantId, async (tx) =>
    tx
      .select({ slug: dashboards.slug, from: dashboards.importedFrom })
      .from(dashboards)
      .where(eq(dashboards.tenantId, tenantId)),
  );
  const out: Partial<Record<PackId, string>> = {};
  for (const row of rows) {
    const id = row.from?.startsWith("pack:") ? (row.from.slice(5) as PackId) : null;
    if (id && packById(id)) out[id] = row.slug;
  }
  return out;
}

/**
 * Places what the last day's signals call for, across every live workspace.
 *
 * One ClickHouse query for all of them, then Postgres only for the workspaces
 * that actually reported something — the sweep does nothing at all, and costs
 * one query, on an instance where nobody runs a pack.
 */
export async function sweepPackDashboards(
  tenantIds: string[],
  createdByMemberId: string | null = null,
): Promise<PackSweepResult> {
  const out: PackSweepResult = { checked: 0, placed: [], failed: 0 };
  if (!telemetryInstalled() || tenantIds.length === 0) return out;

  let reporting: Map<string, PackId[]>;
  try {
    reporting = await tenantsReportingPacks();
  } catch (err) {
    console.error(
      "[pack-dashboards] could not read which packs report:",
      err instanceof Error ? err.message : err,
    );
    return { ...out, failed: 1 };
  }

  const live = new Set(tenantIds);
  for (const [tenantId, packs] of reporting) {
    if (!live.has(tenantId)) continue;
    out.checked++;
    for (const pack of packs) {
      try {
        const slug = await placePack(tenantId, pack, createdByMemberId);
        if (slug) out.placed.push({ tenantId, pack, slug });
      } catch (err) {
        out.failed++;
        console.error(
          `[pack-dashboards] ${tenantId}/${pack}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }
  return out;
}

/** Every pack, for a screen that lists them whether or not they report. */
export { PACKS };
