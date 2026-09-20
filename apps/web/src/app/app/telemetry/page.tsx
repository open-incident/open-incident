import Link from "next/link";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { requireTenant } from "@/lib/tenant";
import { otlpEndpoints } from "@/lib/telemetry-module";
import {
  listKeys,
  logs,
  recentRejections,
  telemetryInstalled,
  trace,
  traces,
  usageToday,
} from "@/lib/telemetry";
import { createIngestionKey, revokeIngestionKey } from "./actions";
import { NotInstalled } from "./not-installed";
import { Waterfall } from "./waterfall";

/**
 * Telemetry — logs, traces, and the four lines that start them arriving.
 *
 * Until the module is installed this screen says so and says how, rather than
 * drawing empty charts: an instance without a ClickHouse cannot show a span,
 * and pretending it can is the one thing the product refuses to do. Once it is
 * installed, an empty list is a different sentence — nothing has arrived yet —
 * and the screen says that instead.
 */

const TABS = ["logs", "traces", "connect"] as const;
type Tab = (typeof TABS)[number];

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};

const MONO: React.CSSProperties = { fontFamily: "var(--mono)", fontSize: 12 };

/** OTLP severity numbers, grouped the way the specification groups them. */
function severityTone(n: number): { label: string; color: string; bg: string } {
  if (n >= 21) return { label: "FATAL", color: "var(--dang)", bg: "var(--dang-t)" };
  if (n >= 17) return { label: "ERROR", color: "var(--dang)", bg: "var(--dang-t)" };
  if (n >= 13) return { label: "WARN", color: "var(--wait)", bg: "var(--wait-t)" };
  if (n >= 9) return { label: "INFO", color: "var(--ink-2)", bg: "var(--sunk)" };
  return { label: "DEBUG", color: "var(--ink-3)", bg: "var(--sunk)" };
}

function ms(ns: string): string {
  const n = Number(ns);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n < 1_000_000 ? `${Math.round(n / 1000)} µs` : `${(n / 1_000_000).toFixed(1)} ms`;
}

export default async function TelemetryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; trace?: string; service?: string; issued?: string }>;
}) {
  const { member } = await requireMember();
  const tenant = await requireTenant();
  const t = await getT();
  const sp = await searchParams;
  const admin = isManager(member);

  if (!telemetryInstalled()) {
    return <NotInstalled admin={admin} endpoint={otlpEndpoints(hostOf(tenant)).grpc} />;
  }

  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "logs";
  const endpoints = otlpEndpoints(hostOf(tenant));

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "22px 28px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--title)",
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-.015em",
          }}
        >
          {t("nav.telemetry")}
        </h1>
        <div
          style={{
            display: "flex",
            gap: 2,
            background: "var(--sunk)",
            borderRadius: 10,
            padding: 3,
          }}
        >
          {TABS.map((x) => (
            <Link
              key={x}
              data-testid={`telemetry-tab-${x}`}
              href={`/app/telemetry?tab=${x}`}
              style={{
                height: 28,
                padding: "0 12px",
                borderRadius: 8,
                background: tab === x ? "var(--panel)" : "transparent",
                color: tab === x ? "var(--ink)" : "var(--ink-3)",
                boxShadow: tab === x ? "var(--shadow-card)" : "none",
                display: "flex",
                alignItems: "center",
                fontSize: 12.5,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              {t(`telemetry.tab.${x}`)}
            </Link>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <Usage tenantId={tenant.id} label={t("telemetry.todayRows")} />
      </div>

      <div style={{ marginTop: 18 }}>
        {tab === "logs" && <LogsTab tenantId={tenant.id} service={sp.service} />}
        {tab === "traces" && <TracesTab tenantId={tenant.id} open={sp.trace} />}
        {tab === "connect" && (
          <ConnectTab tenantId={tenant.id} admin={admin} issued={sp.issued} http={endpoints.http} />
        )}
      </div>
    </div>
  );
}

function hostOf(tenant: { slug: string; customDomain: string | null }): string {
  return tenant.customDomain ?? `${tenant.slug}.${process.env.BASE_DOMAIN ?? "example"}`;
}

async function Usage({ tenantId, label }: { tenantId: string; label: string }) {
  const rows = await usageToday(tenantId);
  const total = rows.reduce((n, r) => n + r.rows, 0);
  if (total === 0) return null;
  return (
    <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
      {label}: <strong style={{ color: "var(--ink-2)" }}>{total.toLocaleString("en-US")}</strong>
    </span>
  );
}

async function Empty({ message }: { message: string }) {
  return (
    <div
      style={{
        ...CARD,
        padding: "28px 20px",
        textAlign: "center",
        color: "var(--ink-3)",
        fontSize: 13,
      }}
    >
      {message}
    </div>
  );
}

async function LogsTab({ tenantId, service }: { tenantId: string; service?: string }) {
  const t = await getT();
  const rows = await logs(tenantId, { limit: 200, ...(service ? { service } : {}) });
  if (rows.length === 0) return <Empty message={t("telemetry.noLogs")} />;
  return (
    <div style={{ ...CARD, overflow: "hidden" }}>
      {rows.map((l, i) => {
        const tone = severityTone(l.severity_number);
        return (
          <div
            key={`${l.ts}-${i}`}
            style={{
              display: "grid",
              gridTemplateColumns: "150px 62px 150px minmax(0,1fr) 90px",
              gap: 10,
              alignItems: "baseline",
              padding: "7px 14px",
              borderTop: i ? "1px solid var(--line-2)" : "none",
              fontSize: 12.5,
            }}
          >
            <span style={{ ...MONO, color: "var(--ink-3)" }}>{l.ts.slice(0, 23)}</span>
            <span
              style={{
                ...MONO,
                fontSize: 10.5,
                fontWeight: 700,
                color: tone.color,
                background: tone.bg,
                borderRadius: 5,
                padding: "1px 5px",
                justifySelf: "start",
              }}
            >
              {l.severity_text || tone.label}
            </span>
            <span style={{ ...MONO, color: "var(--ink-2)" }}>{l.service_name}</span>
            <span style={{ ...MONO, color: "var(--ink)", wordBreak: "break-word" }}>{l.body}</span>
            {l.trace_id ? (
              <Link
                href={`/app/telemetry?tab=traces&trace=${l.trace_id}`}
                style={{
                  ...MONO,
                  color: "var(--brand)",
                  textDecoration: "none",
                  justifySelf: "end",
                }}
              >
                {t("telemetry.openTrace")}
              </Link>
            ) : (
              <span />
            )}
          </div>
        );
      })}
    </div>
  );
}

async function TracesTab({ tenantId, open }: { tenantId: string; open?: string }) {
  const t = await getT();
  const rows = await traces(tenantId);
  if (rows.length === 0) return <Empty message={t("telemetry.noTraces")} />;
  const spans = open ? await trace(tenantId, open) : [];
  const correlated = open ? await logs(tenantId, { traceId: open, limit: 50 }) : [];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: open ? "minmax(0,1fr) minmax(0,1.2fr)" : "1fr",
        gap: 14,
      }}
    >
      <div style={{ ...CARD, overflow: "hidden", alignSelf: "start" }}>
        {rows.map((r, i) => (
          <Link
            key={r.trace_id}
            href={`/app/telemetry?tab=traces&trace=${r.trace_id}`}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) 70px 58px",
              gap: 10,
              alignItems: "center",
              padding: "9px 14px",
              borderTop: i ? "1px solid var(--line-2)" : "none",
              background: r.trace_id === open ? "var(--sunk)" : "transparent",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{r.root_name}</span>
              <span style={{ ...MONO, fontSize: 11, color: "var(--ink-3)" }}>
                {r.root_service}
                {r.services.length > 1 ? ` +${r.services.length - 1}` : ""} ·{" "}
                {r.start_ts.slice(0, 19)}
              </span>
            </span>
            <span style={{ ...MONO, color: "var(--ink-2)", textAlign: "right" }}>
              {ms(r.duration_ns)}
            </span>
            <span
              style={{
                ...MONO,
                fontSize: 10.5,
                textAlign: "right",
                color: Number(r.error_count) > 0 ? "var(--dang)" : "var(--ink-3)",
              }}
            >
              {r.span_count} {t("telemetry.spans")}
            </span>
          </Link>
        ))}
      </div>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ ...CARD, padding: "14px 16px" }}>
            <div style={{ ...MONO, fontSize: 11, color: "var(--ink-3)", marginBottom: 10 }}>
              {open}
            </div>
            <Waterfall spans={spans} />
          </div>
          <div style={{ ...CARD, padding: "12px 16px" }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>
              {t("telemetry.logsOfTrace")}
            </div>
            {correlated.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                {t("telemetry.noLogsHere")}
              </div>
            ) : (
              correlated.map((l, i) => (
                <div key={i} style={{ ...MONO, padding: "3px 0", color: "var(--ink)" }}>
                  <span style={{ color: "var(--ink-3)" }}>{l.ts.slice(11, 23)} </span>
                  {l.body}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

async function ConnectTab({
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
  const [keys, rejections] = await Promise.all([listKeys(tenantId), recentRejections(tenantId)]);
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
