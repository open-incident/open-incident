import Link from "next/link";
import { getT } from "@/i18n/server";
import { listDashboards } from "@/lib/dashboards";
import { importDashboard, newDashboard } from "../dashboards/actions";

/**
 * The dashboards a workspace keeps, as a tab of Telemetry.
 *
 * They used to be a section of the main navigation, which put them beside
 * Incidents and On-call — one rail entry for "a grid of PromQL panels", next
 * to nine entries about people being woken up. A dashboard is a saved reading
 * of the telemetry: its place is beside the telemetry, and the rail is shorter
 * by one.
 *
 * The detail screen keeps its own route: it is full width, it has a wall-
 * display mode, and a dashboard's URL is the thing people paste to each other.
 */
export async function DashboardsTab({
  tenantId,
  admin,
  error,
}: {
  tenantId: string;
  admin: boolean;
  error?: string;
}) {
  const t = await getT();
  const list = await listDashboards(tenantId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="dashboards-tab">
      {error && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--dang)" }}>
          {t("dash.importFailed", { reason: error })}
        </p>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {list.length === 0 && (
          <p style={{ fontSize: 13.5, color: "var(--ink-3)" }}>{t("dash.empty")}</p>
        )}
        {list.map((d) => (
          <Link
            key={d.id}
            href={`/app/dashboards/${d.slug}`}
            data-testid="dashboard-row"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-card)",
              padding: "12px 16px",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{d.title}</span>
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {t("dash.panels", { n: d.layout.panels.length })}
                {d.importedFrom?.startsWith("pack:")
                  ? ` · ${t("dash.fromPack")}`
                  : d.importedFrom
                    ? ` · ${t("dash.fromGrafana")}`
                    : ""}
                {d.isPublic ? ` · ${t("dash.shared")}` : ""}
              </span>
            </span>
          </Link>
        ))}
      </div>

      {admin && (
        <div style={{ marginTop: 14, display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
          <form
            action={newDashboard}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-card)",
              padding: "14px 16px",
            }}
          >
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>{t("dash.new")}</div>
            <input
              name="title"
              placeholder={t("dash.newTitle")}
              className="oi-field"
              style={{ width: "100%", fontSize: 13 }}
            />
            <button type="submit" style={CTA}>
              {t("dash.create")}
            </button>
          </form>

          <form
            action={importDashboard}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-card)",
              padding: "14px 16px",
            }}
          >
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>
              {t("dash.import")}
            </div>
            <p style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5, margin: "0 0 8px" }}>
              {t("dash.importBody")}
            </p>
            <textarea
              name="json"
              rows={3}
              placeholder='{ "title": …, "panels": [ … ] }'
              className="oi-field"
              style={{ width: "100%", fontFamily: "var(--mono)", fontSize: 11.5 }}
            />
            <button type="submit" style={CTA}>
              {t("dash.importAction")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

const CTA: React.CSSProperties = {
  marginTop: 10,
  background: "var(--brand)",
  color: "#fff",
  border: 0,
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
};
