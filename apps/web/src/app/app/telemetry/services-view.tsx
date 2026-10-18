import Link from "next/link";
import { getT } from "@/i18n/server";
import { atlasNote, servicesBoard, type RangeKey } from "@/lib/telemetry-board";
import { AtlasBanner } from "./atlas-banner";

/**
 * Telemetry — Services (design: "Telemetry — Services").
 *
 * One row per service that sent a span in the window, busiest first: its
 * traffic, the share that failed, its p99, thirty bars of latency over the
 * window, and the incident that concerns it. A row opens the service's
 * Metrics. A service nobody owns says so — that is what the service catalogue
 * is for.
 */
const GRID = "minmax(180px,1fr) 110px 110px 110px 200px 110px";

function ms(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)} s`;
  return `${Math.round(v)} ms`;
}

function rps(v: number): string {
  if (v >= 100) return String(Math.round(v));
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export async function ServicesView({
  tenantId,
  from,
  to,
  range,
}: {
  tenantId: string;
  from: Date;
  to: Date;
  range: RangeKey;
}) {
  const t = await getT();
  const [rows, note] = await Promise.all([servicesBoard(tenantId, from, to), atlasNote(tenantId)]);
  return (
    <div
      data-screen-label="Telemetry — Services"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        animation: "oi-rise .16s ease backwards",
      }}
    >
      {note && <AtlasBanner note={note} tinted />}
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-card)",
          overflowX: "auto",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID,
            gap: 12,
            minWidth: 860,
            padding: "8px 16px",
            borderBottom: "1px solid var(--line)",
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
          }}
        >
          <span>{t("telemetry.servicesService")}</span>
          <span>{t("telemetry.servicesRps")}</span>
          <span>{t("telemetry.servicesErrors")}</span>
          <span>p99</span>
          <span>
            {t("tel2.latencyCol", { window: t(`tel2.short.${range}` as "tel2.short.1h") })}
          </span>
          <span>{t("telemetry.servicesIncidents")}</span>
        </div>
        {rows.length === 0 && (
          <div
            style={{ padding: "16px", fontSize: 13, color: "var(--ink-2)" }}
            data-testid="telemetry-services-empty"
          >
            {t("telemetry.servicesEmpty")}
          </div>
        )}
        {rows.map((s) => {
          const err = s.errorRate * 100;
          const dot = err > 5 ? "var(--dang)" : err > 1 ? "var(--wait)" : "var(--ok)";
          const errInk = err > 5 ? "var(--dang)" : err > 1 ? "var(--wait)" : "var(--ink)";
          const top = Math.max(1, ...s.buckets.map((b) => b?.p95 ?? 0));
          return (
            <Link
              key={s.service}
              href={`/app/telemetry?tab=metrics&service=${encodeURIComponent(s.service)}`}
              className="oi-hover"
              data-testid="telemetry-service-row"
              style={{
                display: "grid",
                gridTemplateColumns: GRID,
                gap: 12,
                minWidth: 860,
                alignItems: "center",
                padding: "10px 16px",
                borderBottom: "1px solid var(--line-2)",
                cursor: "pointer",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: dot,
                    flex: "none",
                  }}
                />
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 13,
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.service}
                </span>
                {!s.owned && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--wait)",
                      background: "var(--wait-t)",
                      borderRadius: 5,
                      padding: "1px 6px",
                      flex: "none",
                    }}
                  >
                    {t("telemetry.servicesNoOwner")}
                  </span>
                )}
              </span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}>{rps(s.rps)}</span>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: errInk,
                }}
              >
                {err.toFixed(1)} %
              </span>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 12.5,
                  color: s.p99 >= 1000 ? "var(--dang)" : "var(--ink)",
                }}
              >
                {ms(s.p99)}
              </span>
              <span style={{ display: "flex", alignItems: "flex-end", gap: 1.5, height: 22 }}>
                {s.buckets.map((b, i) => (
                  <span
                    key={i}
                    style={{
                      flex: 1,
                      borderRadius: 1,
                      background: !b
                        ? "var(--line-2)"
                        : b.failed >= 0.05
                          ? "var(--dang)"
                          : "var(--brand-b)",
                      height: b ? `${Math.max(12, Math.round((b.p95 / top) * 100))}%` : "12%",
                    }}
                  />
                ))}
              </span>
              <span style={{ fontSize: 12, color: "var(--ink-2)" }}>
                {s.incident
                  ? s.incident.upstream
                    ? t("tel2.upstream", { ref: s.incident.label })
                    : s.incident.label
                  : "—"}
              </span>
            </Link>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
        {t.parts("tel2.servicesFoot", "field", {}).map((part, i) =>
          i === 0 ? (
            <span key={i}>
              {part}
              <span style={{ fontFamily: "var(--mono)" }}>service.name</span>
            </span>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </div>
    </div>
  );
}
