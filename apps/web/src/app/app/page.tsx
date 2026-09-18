import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { incidents, monitors, severities, statusPages, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
import { alertingSetupStatus } from "@/lib/alerting-setup";
import { listServices } from "@/lib/services";
import { onCallNow } from "@/lib/oncall";
import { initials } from "@/lib/avatar";
import { SetupSteps } from "./setup-steps";

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
  overflow: "hidden",
};

/**
 * Home — three steps while the workspace is empty, the state of things once it
 * is not.
 *
 * The switch is not a setting: the steps disappear the day a real alert has
 * gone through the chain, because from then on the answer to "is this thing
 * working?" is the screen itself rather than a checklist.
 */
export default async function HomePage() {
  const { tenant, member } = await requireMember();
  const t = await getT();

  const data = await withTenant(tenant.id, async (tx) => {
    const [setup, svcs, onCall] = await Promise.all([
      alertingSetupStatus(tx, tenant.id),
      listServices(tx, tenant.id),
      onCallNow(tx, tenant.id),
    ]);
    const burning = await tx
      .select({
        number: incidents.number,
        name: incidents.name,
        phase: incidents.phase,
        severity: severities.name,
        severityRank: severities.rank,
        declaredAt: incidents.declaredAt,
        lastActivityAt: incidents.lastActivityAt,
      })
      .from(incidents)
      .leftJoin(severities, eq(severities.id, incidents.severityId))
      .where(
        and(
          eq(incidents.tenantId, tenant.id),
          sql`${incidents.phase} not in ('closed')`,
          sql`${incidents.mode} <> 'test'`,
        ),
      )
      .orderBy(desc(incidents.lastActivityAt))
      .limit(6);
    const mons = await tx
      .select({
        id: monitors.id,
        name: monitors.name,
        state: monitors.state,
        lastLatencyMs: monitors.lastLatencyMs,
      })
      .from(monitors)
      .where(eq(monitors.tenantId, tenant.id))
      .orderBy(monitors.name)
      .limit(8);
    const pages = await tx
      .select({
        id: statusPages.id,
        name: statusPages.name,
        slug: statusPages.slug,
        visibility: statusPages.visibility,
      })
      .from(statusPages)
      .where(eq(statusPages.tenantId, tenant.id))
      .limit(3);
    return { setup, svcs, onCall, burning, mons, pages };
  });

  const unowned = data.svcs.filter((s) => !s.ownerTeamId);

  if (!data.setup.complete && canRespond(member)) {
    return (
      <SetupSteps
        memberName={member.name}
        workspaceName={tenant.slug}
        steps={data.setup.steps}
        sourceCount={data.setup.sources.count}
        monitorCount={data.mons.length}
      />
    );
  }

  const MON_DOT: Record<string, string> = {
    online: "var(--ok)",
    degraded: "var(--wait)",
    offline: "var(--dang)",
    paused: "var(--ink-3)",
    waiting: "var(--ink-3)",
  };
  const online = data.mons.filter((m) => m.state === "online").length;
  const degraded = data.mons.filter((m) => m.state === "degraded" || m.state === "offline").length;

  return (
    <div
      className="oi-rise"
      style={{
        maxWidth: 1120,
        margin: "0 auto",
        padding: "26px 28px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--title)",
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: "-.015em",
          }}
        >
          {t("home.greeting", { name: member.name.split(" ")[0] ?? member.name })}
        </h1>
        <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
          {t.fmt.dateTime(new Date(), t.timeZone)} · {t.timeZone}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 300px",
          gap: 14,
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <div style={CARD}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 16px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span
                className={data.burning.length > 0 ? "oi-pulse" : undefined}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: data.burning.length > 0 ? "var(--dang)" : "var(--ok)",
                }}
              />
              <span style={{ fontSize: 14, fontWeight: 600 }}>{t("home.burning")}</span>
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {t("home.openIncidents", { count: data.burning.length })}
              </span>
              <span style={{ flex: 1 }} />
              <Link
                href="/app/incidents"
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "var(--brand)",
                  textDecoration: "none",
                }}
              >
                {t("home.allIncidents")} →
              </Link>
            </div>
            {data.burning.length === 0 ? (
              <div style={{ padding: "18px 16px", fontSize: 13, color: "var(--ink-2)" }}>
                {t("home.nothingBurning")}
              </div>
            ) : (
              data.burning.map((i) => (
                <Link
                  key={i.number}
                  href={`/app/incidents/${i.number}`}
                  className="oi-hover"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "11px 16px",
                    borderBottom: "1px solid var(--line-2)",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                      color: "var(--brand)",
                      fontWeight: 600,
                    }}
                  >
                    INC-{i.number}
                  </span>
                  {i.severity && (
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        borderRadius: 999,
                        padding: "2px 8px",
                        background: "var(--wait-t)",
                        color: "var(--wait)",
                      }}
                    >
                      {i.severity}
                    </span>
                  )}
                  <span
                    style={{
                      flex: 1,
                      minWidth: 160,
                      fontSize: 13.5,
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {i.name}
                  </span>
                  <span style={{ fontSize: 11.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>
                    {t.fmt.relative(i.lastActivityAt ?? i.declaredAt ?? new Date())}
                  </span>
                </Link>
              ))
            )}
          </div>

          <div style={CARD}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 16px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>{t("nav.monitors")}</span>
              {data.mons.length > 0 && (
                <>
                  <span style={{ fontSize: 12, color: "var(--ok)", fontWeight: 600 }}>
                    {t("home.monitorsOnline", { count: online })}
                  </span>
                  {degraded > 0 && (
                    <span style={{ fontSize: 12, color: "var(--wait)", fontWeight: 600 }}>
                      {t("home.monitorsDegraded", { count: degraded })}
                    </span>
                  )}
                </>
              )}
              <span style={{ flex: 1 }} />
              <Link
                href="/app/monitors"
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "var(--brand)",
                  textDecoration: "none",
                }}
              >
                {t("home.allMonitors")} →
              </Link>
            </div>
            {data.mons.length === 0 ? (
              <div style={{ padding: "18px 16px", fontSize: 13, color: "var(--ink-2)" }}>
                {t("home.noMonitors")}
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 1,
                  background: "var(--line-2)",
                }}
              >
                {data.mons.map((m) => (
                  <Link
                    key={m.id}
                    href={`/app/monitors/${m.id}`}
                    className="oi-hover"
                    style={{
                      background: "var(--panel)",
                      padding: "10px 14px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      textDecoration: "none",
                      color: "inherit",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: MON_DOT[m.state] ?? "var(--ink-3)",
                          flex: "none",
                        }}
                      />
                      <span
                        style={{
                          fontSize: 12.5,
                          fontWeight: 600,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {m.name}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--mono)" }}>
                      {m.lastLatencyMs !== null ? `${m.lastLatencyMs} ms` : t("home.noCheckYet")}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              ...CARD,
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 11,
            }}
          >
            <div style={{ display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{t("home.onCallNow")}</span>
              <span style={{ flex: 1 }} />
              <Link
                href="/app/on-call"
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "var(--brand)",
                  textDecoration: "none",
                }}
              >
                {t("nav.onCall")} →
              </Link>
            </div>
            {data.onCall.filter((s) => s.memberName).length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
                {t("home.nobodyOnCall")}
              </div>
            ) : (
              data.onCall
                .filter((s) => s.memberName)
                .slice(0, 3)
                .map((s) => (
                  <div
                    key={`${s.scheduleId}-${s.rotationName}`}
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <span
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: "50%",
                        background: "var(--wait-t)",
                        color: "var(--wait)",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 12,
                        fontWeight: 700,
                        flex: "none",
                      }}
                    >
                      {initials(s.memberName!)}
                    </span>
                    <div style={{ flex: 1, lineHeight: 1.25, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.memberName}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                        {s.scheduleName} · {s.rotationName} ·{" "}
                        {t("home.until", { until: t.fmt.time(s.until, t.timeZone) })}
                      </div>
                    </div>
                  </div>
                ))
            )}
          </div>

          {data.pages.length > 0 && (
            <div
              style={{
                ...CARD,
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center" }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{t("nav.statusPages")}</span>
                <span style={{ flex: 1 }} />
                <Link
                  href="/app/status-pages"
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "var(--brand)",
                    textDecoration: "none",
                  }}
                >
                  {t("home.manage")} →
                </Link>
              </div>
              {data.pages.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    padding: "9px 12px",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "var(--ok)",
                      flex: "none",
                    }}
                  />
                  <div style={{ flex: 1, lineHeight: 1.25, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "var(--ink-3)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.slug} · {p.visibility}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {unowned.length > 0 && (
            <div
              style={{
                ...CARD,
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 9,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{t("nav.services")}</span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    background: "var(--wait-t)",
                    color: "var(--wait)",
                    borderRadius: 999,
                    padding: "2px 8px",
                  }}
                >
                  {t("home.withoutOwner", { count: unowned.length })}
                </span>
                <span style={{ flex: 1 }} />
                <Link
                  href="/app/services?tab=seen"
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "var(--brand)",
                    textDecoration: "none",
                  }}
                >
                  {t("home.assign")} →
                </Link>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
                {t("home.unownedBody", {
                  names: unowned
                    .slice(0, 3)
                    .map((s) => s.key)
                    .join(", "),
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
