import Link from "next/link";
import { withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { alertCounts, listAlerts } from "@/lib/alerts";
import { priorityTone } from "@/lib/tones";

/**
 * Alerts — the design's list: views (firing / resolved / all) and sources in
 * the 232 px rail, one card per alert with its dot, service, grouping, source,
 * priority and incident. Deduplicated by key, grouped in a five-minute window.
 */
export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; source?: string }>;
}) {
  const { tenant } = await requireMember();
  const t = await getT();
  const params = await searchParams;
  const view = params.view === "resolved" ? "resolved" : params.view === "all" ? "all" : "firing";
  const sourceId = params.source ?? null;
  const data = await withTenant(tenant.id, async (tx) => ({
    rows: await listAlerts(tx, tenant.id, view, sourceId),
    counts: await alertCounts(tx, tenant.id),
  }));
  const views = [
    { id: "firing", label: t("alerts.view.firing"), count: data.counts.firing },
    { id: "resolved", label: t("alerts.view.resolved"), count: data.counts.resolved },
    { id: "all", label: t("alerts.view.all"), count: data.counts.firing + data.counts.resolved },
  ] as const;
  const dotFor: Record<string, string> = {
    datadog: "var(--brand)",
    prometheus: "var(--viol)",
    grafana: "var(--wait)",
    sentry: "var(--open)",
    uptime_kuma: "var(--ok)",
    http: "var(--ink-3)",
    cloudwatch: "var(--wait)",
    email: "var(--ink-3)",
  };
  const title = views.find((v) => v.id === view)!.label;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <nav
        aria-label={t("alerts.viewsLabel")}
        style={{
          width: 232,
          flex: "none",
          background: "var(--panel)",
          borderRight: "1px solid var(--line)",
          padding: "16px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          overflow: "auto",
        }}
      >
        <div className="oi-eyebrow" style={{ padding: "0 10px 8px" }}>
          {t("incidents.views")}
        </div>
        {views.map((v) => {
          const on = v.id === view && !sourceId;
          return (
            <Link
              key={v.id}
              href={`/app/alerts?view=${v.id}`}
              className={on ? undefined : "oi-hover"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "8px 10px",
                borderRadius: 9,
                background: on ? "var(--brand-t)" : "transparent",
                color: on ? "var(--brand)" : "var(--ink-2)",
                fontWeight: on ? 600 : 450,
                fontSize: 13.5,
                textDecoration: "none",
              }}
            >
              <span style={{ flex: 1 }}>{v.label}</span>
              <span
                style={{
                  fontSize: 11.5,
                  color: "var(--ink-3)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {v.count}
              </span>
            </Link>
          );
        })}
        <div className="oi-eyebrow" style={{ padding: "14px 10px 8px" }}>
          {t("alerts.sources")}
        </div>
        {data.counts.bySource.map((s) => {
          const on = sourceId === s.id;
          return (
            <Link
              key={s.id}
              href={`/app/alerts?view=${view}&source=${s.id}`}
              className={on ? undefined : "oi-hover"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "7px 10px",
                borderRadius: 9,
                background: on ? "var(--brand-t)" : "transparent",
                color: on ? "var(--brand)" : "var(--ink-2)",
                fontSize: 13,
                textDecoration: "none",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: dotFor[s.kind] ?? "var(--ink-3)",
                  flex: "none",
                }}
              />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {s.name}
              </span>
              <span
                style={{
                  fontSize: 11.5,
                  color: "var(--ink-3)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {s.count}
              </span>
            </Link>
          );
        })}
        <Link
          href="/app/settings/alert-sources"
          className="oi-hover"
          style={{
            marginTop: 6,
            padding: "8px 10px",
            border: "1.5px dashed var(--line)",
            borderRadius: 9,
            fontSize: 12.5,
            color: "var(--ink-3)",
            display: "block",
            textDecoration: "none",
          }}
        >
          {t("alerts.manageSources")}
        </Link>
      </nav>

      <section style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 20px",
            flex: "none",
          }}
        >
          <h1 className="oi-title" style={{ margin: 0 }}>
            {title}
          </h1>
          <span
            style={{
              padding: "2px 9px",
              borderRadius: 999,
              background: "var(--brand-t)",
              color: "var(--brand)",
              fontSize: 12,
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {data.rows.length}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("alerts.dedupNote")}</span>
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: "0 20px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {data.rows.map((a) => {
            const pr = priorityTone(a.priorityRank);
            return (
              <Link
                key={a.id}
                href={`/app/alerts/${a.id}`}
                data-testid="alert-card"
                className="oi-hover-edge"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "13px 16px",
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  borderRadius: 13,
                  color: "inherit",
                  textDecoration: "none",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 9,
                    height: 9,
                    flex: "none",
                    borderRadius: "50%",
                    background: a.status === "firing" ? "var(--dang)" : "var(--ok)",
                    animation:
                      a.status === "firing" && !a.acked ? "oi-pulse 2s infinite" : undefined,
                  }}
                />
                <span
                  style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}
                >
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {a.title}
                    {a.testMode && (
                      <span
                        style={{
                          marginLeft: 8,
                          padding: "1px 7px",
                          borderRadius: 6,
                          background: "var(--wait-t)",
                          color: "var(--wait)",
                          fontSize: 10.5,
                          fontWeight: 700,
                        }}
                      >
                        {t("alerts.testMode")}
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>
                      {a.service ?? "—"}
                    </span>{" "}
                    · {t("alerts.grouped", { count: a.groupCount })} ·{" "}
                    {t("alerts.lastEvent", { when: t.fmt.relative(a.lastAt) })}
                    {a.acked && a.status === "firing" ? ` · ${t("alerts.acked")}` : ""}
                  </span>
                </span>
                <span
                  style={{
                    padding: "2px 9px",
                    borderRadius: 999,
                    background: "var(--sunk)",
                    color: "var(--ink-2)",
                    fontSize: 11.5,
                    fontWeight: 600,
                    flex: "none",
                  }}
                >
                  {a.sourceName}
                </span>
                {a.priority && (
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: pr.bg,
                      color: pr.ink,
                      fontSize: 11,
                      fontWeight: 700,
                      flex: "none",
                    }}
                  >
                    {a.priority}
                  </span>
                )}
                <span
                  style={{
                    width: 80,
                    flex: "none",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11.5,
                    color: a.incidentNumber ? "var(--brand-2)" : "var(--ink-3)",
                    textAlign: "right",
                  }}
                >
                  {a.incidentNumber ? `INC-${a.incidentNumber}` : "—"}
                </span>
              </Link>
            );
          })}
          {data.rows.length === 0 && (
            <div
              style={{
                padding: 28,
                border: "1.5px dashed var(--line)",
                borderRadius: 14,
                color: "var(--ink-3)",
                fontSize: 13,
                textAlign: "center",
              }}
            >
              {t("alerts.empty")}
            </div>
          )}
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", padding: "6px 4px" }}>
            {t("alerts.footnote")}
          </div>
        </div>
      </section>
    </div>
  );
}
