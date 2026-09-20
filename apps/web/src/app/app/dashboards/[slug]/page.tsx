import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { requireTenant } from "@/lib/tenant";
import { getDashboard, panelData } from "@/lib/dashboards";
import { Chart, Legend } from "../chart";
import { removeDashboard, toggleShare } from "../actions";

/**
 * One dashboard.
 *
 * Every panel is fetched in parallel and each keeps its own failure: a bad
 * query blanks its own tile and names the reason, never the eleven beside it.
 * That is also why the import report lives on this page — a dashboard that
 * arrived from Grafana with four panels skipped should say so where somebody
 * reads the panels, not in a log nobody opens.
 */
const WINDOWS = [1, 6, 24, 72] as const;

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ h?: string; tv?: string }>;
}) {
  const { member } = await requireMember();
  const tenant = await requireTenant();
  const t = await getT();
  const { slug } = await params;
  const sp = await searchParams;
  const admin = isManager(member);

  const dash = await getDashboard(tenant.id, slug);
  if (!dash) notFound();

  const hours = WINDOWS.includes(Number(sp.h) as (typeof WINDOWS)[number]) ? Number(sp.h) : 6;
  const tv = sp.tv === "1";

  const data = await Promise.all(
    dash.layout.panels.map((p) => panelData(tenant.id, p, dash.variables, hours)),
  );

  return (
    <div
      style={{
        maxWidth: tv ? 1600 : 1200,
        margin: "0 auto",
        padding: tv ? "12px 16px" : "22px 28px 60px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1
          style={{ margin: 0, fontFamily: "var(--title)", fontSize: tv ? 26 : 22, fontWeight: 600 }}
        >
          {dash.title}
        </h1>
        <span style={{ flex: 1 }} />
        <div
          style={{
            display: "flex",
            gap: 2,
            background: "var(--sunk)",
            borderRadius: 9,
            padding: 3,
          }}
        >
          {WINDOWS.map((h) => (
            <Link
              key={h}
              href={`/app/dashboards/${slug}?h=${h}${tv ? "&tv=1" : ""}`}
              style={{
                height: 26,
                padding: "0 10px",
                borderRadius: 7,
                display: "flex",
                alignItems: "center",
                fontSize: 12,
                fontWeight: 600,
                textDecoration: "none",
                background: hours === h ? "var(--panel)" : "transparent",
                color: hours === h ? "var(--ink)" : "var(--ink-3)",
              }}
            >
              {h}h
            </Link>
          ))}
        </div>
        <Link
          href={`/app/dashboards/${slug}?h=${hours}&tv=${tv ? "0" : "1"}`}
          style={{ fontSize: 12, color: "var(--ink-3)", textDecoration: "none" }}
        >
          {tv ? t("dash.exitTv") : t("dash.tv")}
        </Link>
      </div>

      {dash.importReport && !tv && <ImportReportCard report={dash.importReport} />}

      <div
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: `repeat(${tv ? 3 : 2}, minmax(0, 1fr))`,
          gap: 12,
        }}
      >
        {dash.layout.panels.map((p, i) => {
          const d = data[i]!;
          return (
            <div
              key={p.id}
              style={{
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-card)",
                padding: "12px 14px",
                gridColumn: p.w >= 12 && !tv ? "span 2" : "span 1",
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 2 }}>{p.title}</div>
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  color: "var(--ink-3)",
                  marginBottom: 8,
                }}
              >
                {p.query}
              </div>
              {d.ok ? (
                <>
                  <Chart
                    series={d.series}
                    kind={p.type}
                    height={tv ? 160 : 120}
                    threshold={p.threshold}
                  />
                  <Legend series={d.series} />
                </>
              ) : (
                <div style={{ fontSize: 12, color: "var(--dang)", padding: "18px 0" }}>
                  {d.error}
                </div>
              )}
            </div>
          );
        })}
        {dash.layout.panels.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("dash.noPanels")}</p>
        )}
      </div>

      {admin && !tv && (
        <div style={{ marginTop: 22, display: "flex", gap: 10, alignItems: "center" }}>
          <form action={toggleShare}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="on" value={dash.isPublic ? "0" : "1"} />
            <button type="submit" style={GHOST}>
              {dash.isPublic ? t("dash.unshare") : t("dash.share")}
            </button>
          </form>
          {dash.isPublic && dash.publicToken && (
            <code style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--ink-2)" }}>
              /d/{dash.publicToken}
            </code>
          )}
          <span style={{ flex: 1 }} />
          <form action={removeDashboard}>
            <input type="hidden" name="slug" value={slug} />
            <button type="submit" style={{ ...GHOST, color: "var(--dang)" }}>
              {t("dash.delete")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

async function ImportReportCard({
  report,
}: {
  report: NonNullable<Awaited<ReturnType<typeof getDashboard>>>["importReport"];
}) {
  const t = await getT();
  if (!report) return null;
  return (
    <div
      style={{
        marginTop: 14,
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-card)",
        padding: "12px 14px",
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 600 }}>
        {t("dash.report", { translated: report.translated, panels: report.panels })}
      </div>
      {report.skipped.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--ok)", marginTop: 4 }}>
          {t("dash.reportClean")}
        </div>
      ) : (
        <ul
          style={{
            margin: "6px 0 0",
            paddingLeft: 18,
            fontSize: 12,
            color: "var(--ink-2)",
            lineHeight: 1.6,
          }}
        >
          {report.skipped.map((s, i) => (
            <li key={i}>
              <strong>{s.title}</strong> — {s.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const GHOST: React.CSSProperties = {
  border: "1px solid var(--line)",
  background: "var(--panel)",
  borderRadius: 8,
  padding: "5px 11px",
  fontSize: 12.5,
  cursor: "pointer",
};
