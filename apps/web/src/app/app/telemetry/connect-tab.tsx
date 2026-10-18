/**
 * Connect — every ingestion key, the rejections, the packs and who reports.
 *
 * The Setup tab is the design's short version (endpoint, token, collectors,
 * retention). This is the long one, kept at `?tab=connect`, where a key is
 * issued with a label, revoked one by one, and a pack's dashboard installed.
 */
import Link from "next/link";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { services, telemetrySettings, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { listKeys, recentRejections, usageToday } from "@/lib/telemetry";
import { packsReporting, type PackId } from "@openincident/telemetry";
import { packDashboardSlugs } from "@openincident/oncall";
import { createIngestionKey, installPackDashboard, revokeIngestionKey } from "./actions";

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};

const MONO: React.CSSProperties = { fontFamily: "var(--mono)", fontSize: 12 };

/** OTLP severity numbers, grouped the way the specification groups them. */
/**


/**
 * The day's volume, and — when there is one — the fact that it is being
 * thinned.
 *
 * The share is stated rather than implied. A workspace over its cap otherwise
 * reads a smaller number than yesterday's and concludes its traffic fell,
 * which is the silent cut the cap is written not to be.
 */
export async function Usage({ tenantId, label }: { tenantId: string; label: string }) {
  const t = await getT();
  const { rows, dropped, capGb } = await usageToday(tenantId);
  if (rows + dropped === 0) return null;
  const share = Math.round((dropped / (rows + dropped)) * 100);
  return (
    <span style={{ fontSize: 12, color: "var(--ink-3)", display: "flex", gap: 8 }}>
      <span>
        {label}: <strong style={{ color: "var(--ink-2)" }}>{rows.toLocaleString("en-US")}</strong>
      </span>
      {dropped > 0 && (
        <span
          data-testid="telemetry-sampling"
          title={t("telemetry.sampledWhy", {
            dropped: dropped.toLocaleString("en-US"),
            cap: capGb ?? "—",
          })}
          style={{
            padding: "1px 7px",
            borderRadius: 999,
            background: "var(--wait-t)",
            border: "1px solid var(--wait)",
            color: "var(--wait)",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {t("telemetry.sampled", { share })}
        </span>
      )}
    </span>
  );
}

export async function ConnectTab({
  tenantId,
  admin,
  issued,
  http,
}: {
  tenantId: string;
  admin: boolean;
  issued?: string;
  http: string;
}) {
  const t = await getT();
  const [keys, rejections, reporting, placed] = await Promise.all([
    listKeys(tenantId),
    recentRejections(tenantId),
    // Which packs are actually sending, and which already have their screen.
    // Both are read here rather than guessed from the pack list: "install" on
    // a dashboard that exists, or "reporting" on one that stopped, are the two
    // ways this card could lie.
    packsReporting(tenantId).catch(() => [] as PackId[]),
    packDashboardSlugs(tenantId),
  ]);
  // Who has actually reported, and on what terms. Both from Postgres: the
  // services table already records when telemetry last named a service, so
  // this costs nothing on top of the page.
  const setup = await withTenant(tenantId, async (tx) => {
    const seen = await tx
      .select({
        key: services.key,
        stack: services.techStack,
        at: services.telemetryLastSeenAt,
        override: services.retentionOverrideDays,
      })
      .from(services)
      .where(and(eq(services.tenantId, tenantId), isNotNull(services.telemetryLastSeenAt)))
      .orderBy(desc(services.telemetryLastSeenAt))
      .limit(12);
    const [settings] = await tx
      .select()
      .from(telemetrySettings)
      .where(eq(telemetrySettings.tenantId, tenantId));
    return { seen, settings: settings ?? null };
  });
  const snippet = [
    `OTEL_EXPORTER_OTLP_ENDPOINT=${http}`,
    `OTEL_EXPORTER_OTLP_HEADERS=x-oi-key=${issued ?? "<your key>"}`,
    "OTEL_SERVICE_NAME=checkout-api",
    "OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,service.version=2.31.0",
  ].join("\n");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {issued && (
        <div
          style={{
            ...CARD,
            borderColor: "var(--ok)",
            background: "var(--ok-t)",
            padding: "12px 16px",
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
            {t("telemetry.keyOnce")}
          </div>
          <code style={{ ...MONO, fontSize: 12.5, wordBreak: "break-all" }}>{issued}</code>
        </div>
      )}

      <div style={{ ...CARD, padding: "14px 16px" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("telemetry.fourLines")}</div>
        <p style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.6, margin: "6px 0 10px" }}>
          {t("telemetry.fourLinesBody")}
        </p>
        <pre
          style={{
            ...MONO,
            background: "var(--sunk)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: "10px 12px",
            margin: 0,
            overflowX: "auto",
            lineHeight: 1.7,
          }}
        >
          {snippet}
        </pre>
      </div>

      {/*
        The packs, beside the key they need. A reader on this screen has just
        been handed a token and an endpoint; the next thing they want is
        something to paste them into, and sending them to a repository to look
        for it is where onboarding stops.
      */}
      <div style={{ ...CARD, padding: "14px 16px" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>
          {t("telemetry.packs")}
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 10, lineHeight: 1.5 }}>
          {t("telemetry.packsHint")}
        </div>
        {(
          [
            ["host", "telemetry.packHost"],
            ["postgres", "telemetry.packPostgres"],
            ["docker", "telemetry.packDocker"],
            ["kubernetes", "telemetry.packKubernetes"],
          ] as const
        ).map(([file, label]) => {
          const on = reporting.includes(file);
          const slug = placed[file];
          return (
            <div
              key={file}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                padding: "8px 0",
                borderTop: "1px solid var(--line-2)",
                fontSize: 12.5,
              }}
            >
              <span style={{ ...MONO, fontWeight: 600, minWidth: 130 }}>{file}.yaml</span>
              <span style={{ color: "var(--ink-2)", lineHeight: 1.45, flex: 1, minWidth: 180 }}>
                {t(label)}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: on ? "var(--ok)" : "var(--ink-3)",
                  whiteSpace: "nowrap",
                }}
              >
                {on ? t("telemetry.packReporting") : t("telemetry.packSilent")}
              </span>
              {slug ? (
                <Link
                  href={`/app/dashboards/${slug}`}
                  style={{ fontSize: 11.5, fontWeight: 600, color: "var(--brand)" }}
                >
                  {t("telemetry.packOpen")}
                </Link>
              ) : (
                admin && (
                  <form action={installPackDashboard}>
                    <input type="hidden" name="pack" value={file} />
                    <button
                      type="submit"
                      data-testid={`pack-install-${file}`}
                      style={{
                        border: "1px solid var(--line)",
                        background: "var(--panel)",
                        borderRadius: 7,
                        padding: "3px 9px",
                        fontSize: 11.5,
                        fontWeight: 600,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t("telemetry.packInstall")}
                    </button>
                  </form>
                )
              )}
            </div>
          );
        })}
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 10, lineHeight: 1.5 }}>
          {t("telemetry.packsWhere")}
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-start" }}>
        <div style={{ ...CARD, padding: "14px 16px", flex: "1 1 320px", minWidth: 280 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>
            {t("telemetry.collectors")}
          </div>
          {setup.seen.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
              {t("telemetry.collectorsNone")}
            </div>
          ) : (
            setup.seen.map((c) => (
              <div
                key={c.key}
                data-testid="collector-seen"
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  padding: "5px 0",
                  borderTop: "1px solid var(--line-2)",
                  fontSize: 12.5,
                }}
              >
                <span style={{ fontWeight: 600, minWidth: 0, flex: 1 }}>{c.key}</span>
                {c.stack && (
                  <span style={{ ...MONO, fontSize: 11, color: "var(--ink-3)" }}>{c.stack}</span>
                )}
                <span style={{ fontSize: 11, color: "var(--ink-3)", whiteSpace: "nowrap" }}>
                  {c.at ? t.fmt.relativeCompact(c.at) : "—"}
                </span>
              </div>
            ))
          )}
        </div>

        <div style={{ ...CARD, padding: "14px 16px", flex: "1 1 320px", minWidth: 280 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>
            {t("telemetry.retention")}
          </div>
          {(
            [
              ["telemetry.retentionLogs", setup.settings?.retentionLogsDays ?? 15],
              ["telemetry.retentionTraces", setup.settings?.retentionTracesDays ?? 15],
              ["telemetry.retentionMetrics", setup.settings?.retentionMetricsDays ?? 30],
              ["telemetry.retentionProfiles", setup.settings?.retentionProfilesDays ?? 7],
              ["telemetry.retentionRum", setup.settings?.retentionRumDays ?? 7],
            ] as const
          ).map(([label, days]) => (
            <div
              key={label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                padding: "5px 0",
                borderTop: "1px solid var(--line-2)",
                fontSize: 12.5,
              }}
            >
              <span style={{ color: "var(--ink-2)" }}>{t(label)}</span>
              <span style={{ ...MONO }}>{t("telemetry.nDays", { count: days })}</span>
            </div>
          ))}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              padding: "5px 0",
              borderTop: "1px solid var(--line-2)",
              fontSize: 12.5,
            }}
          >
            <span style={{ color: "var(--ink-2)" }}>{t("telemetry.softCap")}</span>
            <span style={{ ...MONO }}>
              {setup.settings?.dailySoftCapGb
                ? t("telemetry.softCapGb", { gb: setup.settings.dailySoftCapGb })
                : t("telemetry.softCapNone")}
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.5 }}>
            {t("telemetry.retentionWhere")}{" "}
            {admin && (
              <Link href="/app/settings/observability" style={{ color: "var(--brand)" }}>
                {t("telemetry.retentionEdit")}
              </Link>
            )}
          </div>
        </div>
      </div>

      <div style={{ ...CARD, padding: "14px 16px" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 10 }}>
          {t("telemetry.keys")}
        </div>
        {keys.length === 0 && (
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 10 }}>
            {t("telemetry.noKeys")}
          </div>
        )}
        {keys.map((k) => (
          <div
            key={k.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "7px 0",
              borderTop: "1px solid var(--line-2)",
              fontSize: 12.5,
            }}
          >
            <span
              style={{ fontWeight: 600, textDecoration: k.revokedAt ? "line-through" : "none" }}
            >
              {k.label}
            </span>
            <span style={{ ...MONO, fontSize: 11, color: "var(--ink-3)" }}>
              {k.signals.join(", ")}
              {k.lastUsedAt
                ? ` · ${t("telemetry.lastUsed", { when: t.fmt.relativeCompact(k.lastUsedAt) })}`
                : ` · ${t("telemetry.neverUsed")}`}
            </span>
            <span style={{ flex: 1 }} />
            {admin && !k.revokedAt && (
              <form action={revokeIngestionKey}>
                <input type="hidden" name="id" value={k.id} />
                <button
                  type="submit"
                  style={{
                    border: "1px solid var(--line)",
                    background: "var(--panel)",
                    borderRadius: 7,
                    padding: "3px 9px",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {t("telemetry.revoke")}
                </button>
              </form>
            )}
          </div>
        ))}
        {admin && (
          <form action={createIngestionKey} style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input
              name="label"
              placeholder={t("telemetry.keyLabel")}
              className="oi-field"
              style={{ flex: 1, maxWidth: 260, fontSize: 13 }}
            />
            <button
              type="submit"
              style={{
                background: "var(--brand)",
                color: "#fff",
                border: 0,
                borderRadius: 8,
                padding: "6px 12px",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t("telemetry.issueKey")}
            </button>
          </form>
        )}
      </div>

      {rejections.length > 0 && (
        <div style={{ ...CARD, padding: "14px 16px" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("telemetry.rejections")}</div>
          <p
            style={{ fontSize: 12.5, color: "var(--ink-2)", margin: "6px 0 10px", lineHeight: 1.6 }}
          >
            {t("telemetry.rejectionsBody")}
          </p>
          {rejections.map((r, i) => (
            <div
              key={i}
              style={{ padding: "5px 0", borderTop: i ? "1px solid var(--line-2)" : "none" }}
            >
              <div style={{ fontSize: 12.5, color: "var(--dang)" }}>
                {r.reason} <span style={{ color: "var(--ink-3)" }}>· {r.signal}</span>
              </div>
              {r.excerpt && (
                <div style={{ ...MONO, fontSize: 11, color: "var(--ink-3)" }}>{r.excerpt}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
