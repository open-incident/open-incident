import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@openincident/db";
import { aiConfigured } from "@openincident/ai";
import { getT } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
import { getService, listTeams } from "@/lib/services";
import { telemetryInstalled } from "@/lib/telemetry-module";
import { assignOwner } from "../actions";

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
  padding: "13px 15px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const EYEBROW: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".08em",
  color: "var(--ink-3)",
};

/**
 * One service: who owns it, what watches it, what broke, and what Atlas knows.
 *
 * The dependency card is the honest one: without traces the product does not
 * know what calls what, and says so rather than drawing a graph it invented.
 */
export default async function ServiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { id } = await params;

  const data = await withTenant(tenant.id, async (tx) => {
    const svc = await getService(tx, tenant.id, id);
    if (!svc) return null;
    return { svc, teams: await listTeams(tx, tenant.id) };
  });
  if (!data) notFound();
  const { svc, teams } = data;
  const mayEdit = canRespond(member);

  const STATE_DOT: Record<string, string> = {
    online: "var(--ok)",
    degraded: "var(--wait)",
    offline: "var(--dang)",
    paused: "var(--ink-3)",
    waiting: "var(--ink-3)",
  };

  return (
    <div
      className="oi-rise"
      style={{
        maxWidth: 1160,
        margin: "0 auto",
        padding: "22px 28px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <Link
        href="/app/services"
        style={{
          fontSize: 12.5,
          color: "var(--ink-3)",
          textDecoration: "none",
          width: "fit-content",
        }}
      >
        ‹ {t("nav.services")}
      </Link>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: svc.confirmed ? "var(--ok)" : "var(--wait)",
              }}
            />
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              {svc.confirmed ? t("services.confirmed") : t("services.seenOnly")} ·{" "}
              {t("services.seenInCount", { count: svc.seenIn.length })}
            </span>
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--mono)",
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-.015em",
            }}
          >
            {svc.key}
          </h1>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {Object.entries(svc.labels).map(([k, v]) => (
              <span
                key={k}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  background: "var(--sunk)",
                  borderRadius: 5,
                  padding: "2px 7px",
                }}
              >
                {k}:{v}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 320px",
          gap: 14,
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <div style={CARD}>
              <div style={EYEBROW}>{t("services.kpiMonitors", { count: svc.monitors.length })}</div>
              {svc.monitors.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                  {t("services.noMonitors")}
                </div>
              ) : (
                svc.monitors.slice(0, 4).map((m) => (
                  <div
                    key={m.id}
                    style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: STATE_DOT[m.state] ?? "var(--ink-3)",
                        flex: "none",
                      }}
                    />
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.name}
                    </span>
                    {m.lastLatencyMs !== null && (
                      <span style={{ color: "var(--ink-3)", fontFamily: "var(--mono)" }}>
                        {m.lastLatencyMs} ms
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
            <div style={CARD}>
              <div style={EYEBROW}>{t("services.kpiAlerts")}</div>
              <div style={{ fontFamily: "var(--title)", fontSize: 22, fontWeight: 600 }}>
                {svc.alerts7d}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {t("services.alertsPaged", { count: svc.alertsPaged7d })}
              </div>
            </div>
            <div style={CARD}>
              <div style={EYEBROW}>{t("services.kpiIncidents")}</div>
              <div style={{ fontFamily: "var(--title)", fontSize: 22, fontWeight: 600 }}>
                {svc.incidents.length}
              </div>
              {svc.incidents.length > 0 && (
                <div style={{ fontSize: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {svc.incidents.slice(0, 3).map((i) => (
                    <Link
                      key={i.number}
                      href={`/app/incidents/${i.number}`}
                      style={{
                        color: "var(--brand)",
                        fontWeight: 600,
                        textDecoration: "none",
                        fontFamily: "var(--mono)",
                      }}
                    >
                      INC-{i.number}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ ...CARD, padding: "14px 16px", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("services.dependencies")}</span>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
              {telemetryInstalled()
                ? t("services.dependenciesEmpty")
                : t("services.dependenciesNoTelemetry")}
            </div>
          </div>

          <div style={{ ...CARD, padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "var(--viol)" }}>✦</span>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("services.context")}</span>
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-2)" }}>
              {aiConfigured() ? t("services.contextEmpty") : t("services.contextUnavailable")}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ ...CARD, padding: "14px 16px" }}>
            <div style={EYEBROW}>{t("services.owner")}</div>
            {svc.ownerTeamName ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 9,
                      background: "var(--brand-t)",
                      color: "var(--brand)",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {svc.ownerTeamName.slice(0, 2).toUpperCase()}
                  </span>
                  <div style={{ lineHeight: 1.25 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{svc.ownerTeamName}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                      {svc.ownerPolicyName
                        ? t("services.pagesPolicy", { policy: svc.ownerPolicyName })
                        : t("services.noPolicy")}
                      {svc.ownerChannel ? ` · ${svc.ownerChannel}` : ""}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: "var(--wait)", fontWeight: 600 }}>
                {t("services.noOwner")}
              </div>
            )}
            {mayEdit && teams.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                {teams
                  .filter((x) => x.id !== svc.ownerTeamId)
                  .slice(0, 3)
                  .map((x) => (
                    <form key={x.id} action={assignOwner}>
                      <input type="hidden" name="serviceId" value={svc.id} />
                      <input type="hidden" name="teamId" value={x.id} />
                      <button
                        type="submit"
                        className="oi-hover-edge"
                        style={{
                          height: 28,
                          padding: "0 10px",
                          border: "1px solid var(--line)",
                          borderRadius: 8,
                          background: "var(--panel)",
                          color: "var(--ink-2)",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {x.name}
                      </button>
                    </form>
                  ))}
              </div>
            )}
          </div>

          <div style={{ ...CARD, padding: "14px 16px" }}>
            <div style={EYEBROW}>{t("services.seenIn")}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--ink-2)" }}>
              {svc.seenIn.length > 0 ? svc.seenIn.join(" · ") : t("services.seenNowhere")}
            </div>
            {svc.lastSeenAt && (
              <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                {t("services.lastSignal", { when: t.fmt.relative(svc.lastSeenAt) })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
