import Link from "next/link";
import { withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
import { listMonitors, monitorCapabilities } from "@/lib/monitors";
import { listServices } from "@/lib/services";
import { NewMonitor } from "./new-monitor";

const STATE_TONE: Record<string, [string, string]> = {
  online: ["var(--ok-t)", "var(--ok)"],
  degraded: ["var(--wait-t)", "var(--wait)"],
  offline: ["var(--dang-t)", "var(--dang)"],
  paused: ["var(--sunk)", "var(--ink-3)"],
  waiting: ["var(--sunk)", "var(--ink-2)"],
};

const BAR: Record<string, string> = {
  online: "rgba(14,122,88,.55)",
  degraded: "var(--wait)",
  offline: "var(--dang)",
  none: "var(--line)",
};

/**
 * Monitors — what the product watches itself.
 *
 * The row is the whole story: what it is, how it is, thirty days of bars, its
 * uptime, when it last answered and which service it belongs to. A monitor
 * that has never run says "waiting for first check" rather than pretending to
 * be online.
 */
export default async function MonitorsPage({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    error?: string;
    why?: string;
    type?: string;
    q?: string;
  }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { new: openNew, error, why, type, q } = await searchParams;

  const data = await withTenant(tenant.id, async (tx) => ({
    monitors: await listMonitors(tx, tenant.id),
    services: await listServices(tx, tenant.id),
  }));
  const capabilities = await monitorCapabilities();

  const counts = {
    online: data.monitors.filter((m) => m.state === "online").length,
    degraded: data.monitors.filter((m) => m.state === "degraded").length,
    offline: data.monitors.filter((m) => m.state === "offline").length,
    waiting: data.monitors.filter((m) => m.state === "waiting").length,
    // Counted like the rest: a list of seven monitors whose header said
    // nothing because all seven were paused is a header that lies by omission.
    paused: data.monitors.filter((m) => m.state === "paused").length,
  };
  const mayEdit = canRespond(member);

  return (
    <div
      style={{
        maxWidth: 1160,
        margin: "0 auto",
        padding: "22px 28px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
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
          {t("nav.monitors")}
        </h1>
        <span style={{ display: "flex", gap: 10, fontSize: 12.5 }}>
          {counts.online > 0 && (
            <span style={{ color: "var(--ok)", fontWeight: 600 }}>
              {t("monitors.nOnline", { count: counts.online })}
            </span>
          )}
          {counts.degraded > 0 && (
            <span style={{ color: "var(--wait)", fontWeight: 600 }}>
              {t("monitors.nDegraded", { count: counts.degraded })}
            </span>
          )}
          {counts.offline > 0 && (
            <span style={{ color: "var(--dang)", fontWeight: 600 }}>
              {t("monitors.nOffline", { count: counts.offline })}
            </span>
          )}
          {counts.waiting > 0 && (
            <span style={{ color: "var(--ink-3)" }}>
              {t("monitors.nWaiting", { count: counts.waiting })}
            </span>
          )}
          {counts.paused > 0 && (
            <span style={{ color: "var(--ink-3)" }}>
              {t("monitors.nPaused", { count: counts.paused })}
            </span>
          )}
        </span>
        <span style={{ flex: 1 }} />
        {mayEdit && (
          <NewMonitor
            services={data.services.map((s) => s.key)}
            capabilities={capabilities}
            initialOpen={!!openNew || !!type}
            initialType={type}
            initialQuery={q}
          />
        )}
      </div>

      {/*
        A refused creation used to come back to this list with the reason in
        the address bar and nowhere else, which reads as "the button does
        nothing". The reason is shown.
      */}
      {error && (
        <div
          role="alert"
          data-testid="monitors-error"
          style={{
            border: "1px solid var(--dang)",
            background: "var(--dang-t)",
            color: "var(--dang)",
            borderRadius: 11,
            padding: "11px 14px",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {error === "telemetry-query"
            ? t("monitors.error.telemetry-query", { why: why ?? t("monitors.error.missing") })
            : error === "steps"
              ? t("monitors.error.steps")
              : t("monitors.error.invalid")}
        </div>
      )}

      {data.monitors.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--line)",
            borderRadius: "var(--radius-card)",
            padding: 28,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            alignItems: "flex-start",
            maxWidth: 640,
          }}
        >
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t("monitors.emptyTitle")}</div>
          <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
            {t("monitors.emptyBody")}
          </div>
        </div>
      ) : (
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-card)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) 110px 200px 90px 110px 120px",
              gap: 12,
              padding: "8px 16px",
              borderBottom: "1px solid var(--line)",
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
            }}
          >
            <span>{t("monitors.colMonitor")}</span>
            <span>{t("monitors.colStatus")}</span>
            <span>{t("monitors.colLast30")}</span>
            <span>{t("monitors.colUptime")}</span>
            <span>{t("monitors.colLastCheck")}</span>
            <span>{t("monitors.colService")}</span>
          </div>
          {data.monitors.map((m) => {
            const tone = STATE_TONE[m.state] ?? STATE_TONE.waiting!;
            return (
              <Link
                key={m.id}
                href={`/app/monitors/${m.id}`}
                className="oi-hover"
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) 110px 200px 90px 110px 120px",
                  gap: 12,
                  alignItems: "center",
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--line-2)",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                  <span
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {m.name}
                  </span>
                  <span
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      fontFamily: "var(--mono)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {m.type.toUpperCase()} · {m.target || "—"}
                  </span>
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11.5,
                    fontWeight: 600,
                    borderRadius: 999,
                    padding: "3px 9px",
                    background: tone[0],
                    color: tone[1],
                    width: "fit-content",
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: tone[1] }} />
                  {t(`monitors.state.${m.state}` as const)}
                </span>
                <span style={{ display: "flex", gap: 1.5, alignItems: "flex-end" }}>
                  {m.days.map((d) => (
                    <span
                      key={d.day}
                      title={d.day}
                      style={{
                        flex: 1,
                        height: 14,
                        borderRadius: 1.5,
                        background: BAR[d.state],
                      }}
                    />
                  ))}
                </span>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    fontWeight: 600,
                    color: m.uptime90 === null ? "var(--ink-3)" : "var(--ok)",
                  }}
                >
                  {m.uptime90 === null ? "—" : `${m.uptime90.toFixed(2)} %`}
                </span>
                <span style={{ fontSize: 12, color: "var(--ink-2)", fontFamily: "var(--mono)" }}>
                  {m.lastCheckAt ? t.fmt.relative(m.lastCheckAt) : "—"}
                </span>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "var(--brand)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.serviceKey ?? "—"}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
