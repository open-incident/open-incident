/**
 * Dashboards — a grid of PromQL panels, and the variables that fill them.
 *
 * Every panel is a query against the same subset the Prometheus API answers,
 * which is the point: a panel cannot show something PromQL cannot express, so
 * a dashboard never becomes a second, quieter query language with its own
 * rules. When a panel's query uses a construction outside the subset, the
 * panel says so by name instead of drawing nothing.
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  dashboards,
  forgetDashboardShare,
  registerDashboardShare,
  resolveDashboardShare,
  withTenant,
  type DashboardLayout,
  type DashboardPanel,
  type DashboardVariable,
  type ImportReport,
} from "@openincident/db";
import { evalPromql, PromqlError, telemetryInstalled, type Series } from "@openincident/telemetry";

export type { DashboardPanel, DashboardVariable, ImportReport };

export type Dashboard = {
  id: string;
  slug: string;
  title: string;
  description: string;
  layout: DashboardLayout;
  variables: DashboardVariable[];
  isPublic: boolean;
  publicToken: string | null;
  hasPassword: boolean;
  ipAllowlist: string[];
  importedFrom: string | null;
  importReport: ImportReport | null;
};

export async function listDashboards(tenantId: string): Promise<Dashboard[]> {
  return withTenant(tenantId, async (tx) =>
    tx
      .select({
        id: dashboards.id,
        slug: dashboards.slug,
        title: dashboards.title,
        description: dashboards.description,
        layout: dashboards.layout,
        variables: dashboards.variables,
        isPublic: dashboards.isPublic,
        publicToken: dashboards.publicToken,
        passwordHash: dashboards.passwordHash,
        ipAllowlist: dashboards.ipAllowlist,
        importedFrom: dashboards.importedFrom,
        importReport: dashboards.importReport,
      })
      .from(dashboards)
      .where(eq(dashboards.tenantId, tenantId))
      .orderBy(asc(dashboards.title))
      .then((rows) =>
        rows.map(({ passwordHash, ...r }) => ({ ...r, hasPassword: passwordHash !== null })),
      ),
  );
}

export async function getDashboard(tenantId: string, slug: string): Promise<Dashboard | null> {
  const all = await withTenant(tenantId, async (tx) =>
    tx
      .select()
      .from(dashboards)
      .where(and(eq(dashboards.tenantId, tenantId), eq(dashboards.slug, slug))),
  );
  const row = all[0];
  return row
    ? {
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        layout: row.layout,
        variables: row.variables,
        isPublic: row.isPublic,
        publicToken: row.publicToken,
        hasPassword: row.passwordHash !== null,
        ipAllowlist: row.ipAllowlist,
        importedFrom: row.importedFrom,
        importReport: row.importReport,
      }
    : null;
}

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "dashboard"
  );
}

export async function createDashboard(
  tenantId: string,
  memberId: string,
  input: { title: string; layout?: DashboardLayout; variables?: DashboardVariable[] } & {
    importedFrom?: string;
    importReport?: ImportReport;
  },
): Promise<string> {
  const base = slugify(input.title);
  return withTenant(tenantId, async (tx) => {
    // A slug collision is a rename, not an error: two people importing the
    // same Grafana folder should both end up with a dashboard.
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
      title: input.title.slice(0, 120),
      layout: input.layout ?? { panels: [] },
      variables: input.variables ?? [],
      createdByMemberId: memberId,
      importedFrom: input.importedFrom ?? null,
      importReport: input.importReport ?? null,
    });
    return slug;
  });
}

export async function saveLayout(
  tenantId: string,
  slug: string,
  layout: DashboardLayout,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx
      .update(dashboards)
      .set({ layout, updatedAt: new Date() })
      .where(and(eq(dashboards.tenantId, tenantId), eq(dashboards.slug, slug)));
  });
}

export async function deleteDashboard(tenantId: string, slug: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx
      .delete(dashboards)
      .where(and(eq(dashboards.tenantId, tenantId), eq(dashboards.slug, slug)));
  });
}

/**
 * Sharing is a token, not the slug.
 *
 * A wall display in an office needs a URL anybody in the room can load; that
 * is not a reason to let anyone who guesses "checkout" read the workspace's
 * metrics. Turning sharing off destroys the token rather than hiding it, so a
 * link that leaked stops working.
 */
export async function setPublic(
  tenantId: string,
  slug: string,
  on: boolean,
  opts: { password?: string; ipAllowlist?: string[] } = {},
): Promise<string | null> {
  const token = on ? randomBytes(18).toString("base64url") : null;
  const id = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .update(dashboards)
      .set({
        isPublic: on,
        publicToken: token,
        // Both gates are cleared when sharing stops: a password left behind on
        // a private dashboard is a password nobody rotates.
        passwordHash: on && opts.password ? hashPassword(opts.password) : null,
        ipAllowlist: on ? (opts.ipAllowlist ?? []) : [],
        updatedAt: new Date(),
      })
      .where(and(eq(dashboards.tenantId, tenantId), eq(dashboards.slug, slug)))
      .returning({ id: dashboards.id });
    return row?.id ?? null;
  });
  if (!id) return null;
  if (token) await registerDashboardShare(token, tenantId, id);
  else await forgetDashboardShare(id);
  return token;
}

function hashPassword(value: string): string {
  return createHash("sha256").update(`oi-dashboard:${value}`).digest("hex");
}

/**
 * The three gates a public dashboard passes, in the order they can refuse.
 *
 * The token resolves the workspace outside row-level security — the dashboard
 * itself is then read normally, inside it. Order matters for what a refusal
 * reveals: an unknown token and a wrong password must not be distinguishable
 * by timing or by message beyond what the visitor needs.
 */
export async function openPublic(
  token: string,
  opts: { password?: string; ip?: string },
): Promise<
  | { ok: true; dashboard: Dashboard; tenantId: string }
  | { ok: false; reason: "unknown" | "password" | "ip" }
> {
  const share = await resolveDashboardShare(token);
  if (!share) return { ok: false, reason: "unknown" };
  const row = await withTenant(share.tenantId, async (tx) => {
    const [d] = await tx.select().from(dashboards).where(eq(dashboards.id, share.dashboardId));
    return d ?? null;
  });
  if (!row || !row.isPublic) return { ok: false, reason: "unknown" };
  if (row.ipAllowlist.length > 0 && !row.ipAllowlist.includes(opts.ip ?? ""))
    return { ok: false, reason: "ip" };
  if (row.passwordHash && row.passwordHash !== hashPassword(opts.password ?? ""))
    return { ok: false, reason: "password" };
  return {
    ok: true,
    tenantId: share.tenantId,
    dashboard: {
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      layout: row.layout,
      variables: row.variables,
      isPublic: row.isPublic,
      publicToken: row.publicToken,
      hasPassword: row.passwordHash !== null,
      ipAllowlist: row.ipAllowlist,
      importedFrom: row.importedFrom,
      importReport: row.importReport,
    },
  };
}

/** Substitutes `$name` and `${name}`, longest first so `$env` cannot eat `$environment`. */
export function applyVariables(query: string, variables: DashboardVariable[]): string {
  let out = query;
  for (const v of [...variables].sort((a, b) => b.name.length - a.name.length)) {
    out = out.split(`\${${v.name}}`).join(v.value).split(`$${v.name}`).join(v.value);
  }
  return out;
}

export type PanelData = { ok: true; series: Series[] } | { ok: false; error: string };

/**
 * One panel's data, over the dashboard's window.
 *
 * A failure is returned rather than thrown: one panel with a bad query must
 * not blank the eleven beside it, and the reader needs to know which one is
 * broken and why.
 */
export async function panelData(
  tenantId: string,
  panel: DashboardPanel,
  variables: DashboardVariable[],
  hours: number,
): Promise<PanelData> {
  if (!telemetryInstalled()) return { ok: false, error: "telemetry is not installed" };
  const end = Date.now();
  const start = end - hours * 3_600_000;
  // Roughly 120 points across the window, rounded to whole seconds: enough to
  // draw, few enough that twelve panels do not read a million rows each.
  const stepMs = Math.max(15_000, Math.round((end - start) / 120 / 1000) * 1000);
  try {
    const series = await evalPromql(tenantId, applyVariables(panel.query, variables), {
      start,
      end,
      stepMs,
    });
    return { ok: true, series };
  } catch (err) {
    if (err instanceof PromqlError) return { ok: false, error: err.message };
    console.error("[dashboard] panel failed:", err);
    return { ok: false, error: "this panel could not be evaluated" };
  }
}
