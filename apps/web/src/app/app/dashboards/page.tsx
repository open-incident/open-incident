import Link from "next/link";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { requireTenant } from "@/lib/tenant";
import { listDashboards } from "@/lib/dashboards";
import { telemetryInstalled } from "@/lib/telemetry";
import { importDashboard, newDashboard } from "./actions";

/**
 * The dashboards a workspace keeps.
 *
 * Without the telemetry module this screen says so rather than offering a
 * "new dashboard" button that would produce a grid of panels nothing can fill.
 */
export default async function DashboardsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { member } = await requireMember();
  const tenant = await requireTenant();
  const t = await getT();
  const sp = await searchParams;
  const admin = isManager(member);

  if (!telemetryInstalled()) {
    return (
      <div style={{ maxWidth: 720, margin: "60px auto 0", padding: "0 28px", textAlign: "center" }}>
        <h1 style={{ fontFamily: "var(--title)", fontSize: 22, fontWeight: 600 }}>
          {t("dash.title")}
        </h1>
        <p style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.6 }}>
          {t("telemetry.notInstalledBody")}
        </p>
      </div>
    );
  }

  const list = await listDashboards(tenant.id);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "22px 28px 60px" }}>
      <h1 style={{ margin: 0, fontFamily: "var(--title)", fontSize: 22, fontWeight: 600 }}>
        {t("dash.title")}
      </h1>

      {sp.error && (
        <p style={{ marginTop: 10, fontSize: 13, color: "var(--dang)" }}>
          {t("dash.importFailed", { reason: sp.error })}
        </p>
      )}

      <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
        {list.length === 0 && (
          <p style={{ fontSize: 13.5, color: "var(--ink-3)" }}>{t("dash.empty")}</p>
        )}
        {list.map((d) => (
          <Link
            key={d.id}
            href={`/app/dashboards/${d.slug}`}
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
                {d.importedFrom ? ` · ${t("dash.fromGrafana")}` : ""}
                {d.isPublic ? ` · ${t("dash.shared")}` : ""}
              </span>
            </span>
          </Link>
        ))}
      </div>

      {admin && (
        <div style={{ marginTop: 26, display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
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
