import Link from "next/link";
import { eq } from "drizzle-orm";
import { telemetrySettings, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { listKeys } from "@/lib/telemetry";
import { traceCount, type TelemetrySearch } from "@/lib/telemetry-board";
import { RotateToken } from "./rotate-token";
import { ago } from "../monitors/format";

/**
 * Telemetry — Setup (design: "Telemetry — Setup").
 *
 * Where to send OTLP, the workspace token, the collectors seen (one per
 * ingestion key, with when it last sent something), and how long each signal
 * is kept. The long version — labelled keys, rejections, packs — stays at
 * `?tab=connect`.
 */
const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};

export async function SetupView({
  tenantId,
  admin,
  endpoints,
}: {
  tenantId: string;
  admin: boolean;
  endpoints: { grpc: string; http: string };
  sp: TelemetrySearch;
}) {
  const t = await getT();
  const now = new Date();
  const [keys, settings, sampling] = await Promise.all([
    listKeys(tenantId),
    withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(telemetrySettings)
        .where(eq(telemetrySettings.tenantId, tenantId));
      return row ?? null;
    }),
    traceCount(tenantId, { from: new Date(now.getTime() - 86_400_000), to: now }),
  ]);
  const active = keys.filter((k) => !k.revokedAt);
  const days = (n: number) => t("tel2.days", { count: n });
  const sampled =
    sampling.traces > 0 && sampling.sampled < 0.999
      ? ` · ${Math.round(sampling.sampled * 100)} %`
      : "";

  return (
    <div
      data-screen-label="Telemetry — Setup"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 14,
        alignItems: "flex-start",
        animation: "oi-rise .16s ease backwards",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          flex: "10 1 480px",
          minWidth: 0,
        }}
      >
        <div
          style={{
            ...CARD,
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("tel2.otlpEndpoint")}</div>
          <div style={{ display: "flex", gap: 6 }}>
            <code
              data-testid="otlp-endpoint"
              style={{
                flex: 1,
                fontFamily: "var(--mono)",
                fontSize: 12,
                background: "var(--sunk)",
                borderRadius: 8,
                padding: "9px 11px",
              }}
            >
              {endpoints.grpc} <span style={{ color: "var(--ink-3)" }}>(gRPC)</span> ·{" "}
              {endpoints.http} <span style={{ color: "var(--ink-3)" }}>(HTTP)</span>
            </code>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
            {t("tel2.tokenOnce")} <RotateToken allowed={admin} />
          </div>
        </div>

        <div style={{ ...CARD, overflow: "hidden" }} data-testid="collectors">
          <div
            style={{
              padding: "12px 18px",
              borderBottom: "1px solid var(--line)",
              fontSize: 13.5,
              fontWeight: 600,
            }}
          >
            {t("tel2.collectors")}
          </div>
          {active.length === 0 && (
            <div style={{ padding: "12px 18px", fontSize: 12.5, color: "var(--ink-3)" }}>
              {t("tel2.collectorsNone")}
            </div>
          )}
          {active.map((k) => {
            const fresh = k.lastUsedAt && now.getTime() - k.lastUsedAt.getTime() < 10 * 60_000;
            return (
              <div
                key={k.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 18px",
                  borderBottom: "1px solid var(--line-2)",
                  fontSize: 12.5,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: fresh ? "var(--ok)" : k.lastUsedAt ? "var(--wait)" : "var(--ink-3)",
                    flex: "none",
                  }}
                />
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    whiteSpace: "nowrap",
                    flex: 1,
                    minWidth: 160,
                  }}
                >
                  {k.label}
                </span>
                <span style={{ color: "var(--ink-3)" }}>
                  {k.signals.join(" · ")} ·{" "}
                  {k.lastUsedAt
                    ? fresh
                      ? t("tel2.collectorHealthy", { ago: ago(k.lastUsedAt) })
                      : t("tel2.collectorSilent", { ago: ago(k.lastUsedAt) })
                    : t("tel2.collectorNever")}
                </span>
              </div>
            );
          })}
          {admin && (
            <div style={{ padding: "10px 18px", fontSize: 12 }}>
              <Link
                href="/app/telemetry?tab=connect"
                style={{ color: "var(--brand)", fontWeight: 600, textDecoration: "none" }}
              >
                {t("tel2.manageKeys")}
              </Link>
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          flex: "1 1 280px",
          maxWidth: 340,
          minWidth: 260,
        }}
      >
        <div
          style={{
            ...CARD,
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: ".08em",
              color: "var(--ink-3)",
            }}
          >
            {t("tel2.retention")}
          </div>
          {[
            [t("telemetry.tab.traces"), days(settings?.retentionTracesDays ?? 15) + sampled],
            [t("telemetry.tab.logs"), days(settings?.retentionLogsDays ?? 15)],
            [t("telemetry.tab.metrics"), days(settings?.retentionMetricsDays ?? 30)],
          ].map(([l, v]) => (
            <div
              key={l}
              style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}
            >
              <span style={{ color: "var(--ink-2)" }}>{l}</span>
              <span style={{ fontWeight: 600 }}>{v}</span>
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{t("tel2.perService")}</div>
        </div>
        <div
          style={{
            background: "var(--sunk)",
            borderRadius: "var(--radius-card)",
            padding: "12px 14px",
            fontSize: 12,
            color: "var(--ink-2)",
            lineHeight: 1.55,
          }}
        >
          {t("tel2.storedNote")}
        </div>
      </div>
    </div>
  );
}
