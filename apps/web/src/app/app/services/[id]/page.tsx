import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { escalationPaths, withTenant } from "@openincident/db";
import { runbooksForService } from "@openincident/ai";
import { ServiceAtlasCard } from "@/components/atlas/service-card";
import { getT } from "@/i18n/server";
import { canRespond, isManager, requireMember } from "@/lib/session";
import { getService, listTeams, mergeCandidates } from "@/lib/services";
import { telemetryInstalled } from "@/lib/telemetry-module";
import { ContextCard } from "./context-card";
import { Dependencies } from "./dependencies";
import { HeaderActions } from "./header-actions";
import { Labels } from "./labels";
import { OwnerCard } from "./owner-card";
import { RunbookList } from "./runbook-list";
import { ServiceTelemetry } from "./telemetry-card";
import { CARD, EYEBROW } from "./ui";

const KPI: React.CSSProperties = { ...CARD, padding: "13px 15px", gap: 6 };

const STATE_DOT: Record<string, string> = {
  online: "var(--ok)",
  degraded: "var(--wait)",
  offline: "var(--dang)",
  paused: "var(--ink-3)",
  waiting: "var(--ink-3)",
};

/**
 * One service: what watches it, what broke, what Atlas may do on it, what it
 * talks to, what the records say — and, on the right, who owns it, its
 * runbooks and where it was seen.
 */
export default async function ServiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; exists?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { id } = await params;
  const { error, exists } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const data = await withTenant(tenant.id, async (tx) => {
    const svc = await getService(tx, tenant.id, id);
    if (!svc) return null;
    if (svc.mergedInto !== null) return { kind: "merged" as const, to: svc.mergedInto };
    // The policies on offer, for the case where the owner team has none: the
    // chain has to be completable where the reader notices it is broken.
    const paths = await tx
      .select({ id: escalationPaths.id, name: escalationPaths.name })
      .from(escalationPaths)
      .where(eq(escalationPaths.tenantId, tenant.id))
      .orderBy(asc(escalationPaths.name));
    return {
      kind: "ok" as const,
      svc,
      teams: await listTeams(tx, tenant.id),
      paths,
      runbooks: await runbooksForService(tx, tenant.id, svc.id),
      others: await mergeCandidates(tx, tenant.id, svc.id),
    };
  });
  if (!data) notFound();
  if (data.kind === "merged") redirect(`/app/services/${data.to}`);
  const { svc, teams, paths, runbooks, others } = data;
  const mayEdit = canRespond(member);
  const mayManage = isManager(member);
  const installed = telemetryInstalled();

  // "Datadog · Sentry · 3 monitors · traces · Skylark Status (Checkout)".
  const seenIn = [
    ...svc.sightings.sources.map((s) => s.name),
    ...(svc.monitors.length > 0
      ? [t("services.monitorsCount", { count: svc.monitors.length })]
      : []),
    ...(svc.sightings.traces ? [t("services.traces")] : []),
    ...svc.statusPages.map((p) => `${p.page} (${p.component})`),
  ];
  const alertsLine = [
    ...svc.alertsBySource7d.map((s) => `${s.name} ${s.count}`),
    t("services.alertsPaged", { count: svc.alertsPaged7d }),
  ].join(" · ");
  // A runbook attached to the whole workspace is listed on every service but
  // belongs to none: only the service's own count in the eyebrow.
  const ownRunbooks = runbooks.filter((r) => r.serviceId === svc.id);

  return (
    <div
      style={{
        maxWidth: 1160,
        margin: "0 auto",
        padding: "22px 28px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        animation: "oi-rise .18s ease backwards",
      }}
    >
      <Link
        href="/app/services"
        className="si-back"
        style={{
          fontSize: 12.5,
          color: "var(--ink-3)",
          textDecoration: "none",
          width: "fit-content",
        }}
      >
        ‹ {t("nav.services")}
      </Link>
      <style>{`.si-back:hover{color:var(--brand)!important}`}</style>

      {exists === "1" && (
        <div
          data-testid="service-exists"
          style={{
            background: "var(--sunk)",
            borderRadius: 12,
            padding: "11px 15px",
            fontSize: 13,
            color: "var(--ink-2)",
          }}
        >
          {t("services.exists")}
        </div>
      )}

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
              {`${svc.confirmed ? t("services.confirmed") : t("services.seenOnly")} · ${t("services.seenInCount", { count: seenIn.length })}`}
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
          {/* A name that only repeats the key is not a name. */}
          {svc.name && svc.name !== svc.key && (
            <div style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: -2 }}>{svc.name}</div>
          )}
          <Labels serviceId={svc.id} labels={svc.labels} mayEdit={mayEdit} />
        </div>
        <HeaderActions
          service={{ id: svc.id, key: svc.key }}
          others={others}
          mayManage={mayManage}
          deletable={mayManage && !svc.lastSeenAt}
        />
      </div>

      {(error === "seen" ||
        error === "has_runbook" ||
        error === "merge" ||
        error === "runbook") && (
        <div
          role="alert"
          style={{
            background: "var(--dang-t)",
            border: "1px solid rgba(192,52,43,.25)",
            borderRadius: 12,
            padding: "11px 15px",
            fontSize: 13,
            color: "var(--dang)",
          }}
        >
          {error === "seen"
            ? t("services.deleteSeen")
            : error === "has_runbook"
              ? t("services.deleteRunbook")
              : error === "merge"
                ? t("services.mergeFailed")
                : t("svc.runbooks.error")}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 320px",
          gap: 14,
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            <div style={KPI} data-testid="service-monitors">
              <div style={EYEBROW}>{t("services.kpiMonitors", { count: svc.monitors.length })}</div>
              {svc.monitors.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                  {t("services.noMonitors")}
                </div>
              ) : (
                svc.monitors.slice(0, 3).map((m) => (
                  <Link
                    key={m.id}
                    href={`/app/monitors/${m.id}`}
                    style={{
                      fontSize: 12.5,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      color: "inherit",
                      textDecoration: "none",
                      minWidth: 0,
                    }}
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
                      style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {`${m.name}${m.lastLatencyMs !== null && m.state !== "paused" ? ` · ${t.fmt.number(m.lastLatencyMs)} ms` : ""}`}
                    </span>
                  </Link>
                ))
              )}
              {svc.monitors.length > 3 && (
                <Link
                  href="/app/monitors"
                  style={{
                    fontSize: 12,
                    color: "var(--brand)",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  {t("services.moreMonitors", { count: svc.monitors.length - 3 })}
                </Link>
              )}
            </div>
            <div style={KPI} data-testid="service-alerts">
              <div style={EYEBROW}>{t("services.kpiAlerts")}</div>
              <div style={{ fontFamily: "var(--title)", fontSize: 22, fontWeight: 600 }}>
                {t.fmt.number(svc.alerts7d)}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {svc.alerts7d === 0 ? t("services.quietWeek") : alertsLine}
              </div>
            </div>
            <div style={KPI} data-testid="service-incidents">
              <div style={EYEBROW}>{t("services.kpiIncidents")}</div>
              <div style={{ fontFamily: "var(--title)", fontSize: 22, fontWeight: 600 }}>
                {t.fmt.number(svc.incidents90d)}
              </div>
              {svc.incidents.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {t("services.noIncidents")}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--brand)", fontWeight: 600 }}>
                  {svc.incidents.map((i, n) => (
                    <span key={i.number}>
                      {n > 0 && " · "}
                      <Link
                        href={`/app/incidents/${i.number}`}
                        title={i.name}
                        style={{ color: "inherit", textDecoration: "none" }}
                      >
                        {`INC-${i.number}`}
                      </Link>
                    </span>
                  ))}{" "}
                  <Link
                    href="/app/incidents?tab=all"
                    aria-label={t("services.allIncidents")}
                    style={{ color: "inherit", textDecoration: "none" }}
                  >
                    →
                  </Link>
                </div>
              )}
            </div>
          </div>

          <ServiceAtlasCard tenantId={tenant.id} serviceId={svc.id} />

          <Dependencies
            tenantId={tenant.id}
            service={{ id: svc.id, key: svc.key, aliases: svc.aliases }}
            others={others}
            mayEdit={mayEdit}
          />

          {installed && <ServiceTelemetry tenantId={tenant.id} names={[svc.key, ...svc.aliases]} />}

          <ContextCard tenantId={tenant.id} serviceId={svc.id} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <OwnerCard
            service={{ id: svc.id, ownerTeamId: svc.ownerTeamId }}
            owner={
              svc.ownerTeamName
                ? {
                    name: svc.ownerTeamName,
                    policyName: svc.ownerPolicyName,
                    channel: svc.ownerChannel,
                  }
                : null
            }
            teams={teams.map((x) => ({ id: x.id, name: x.name }))}
            paths={paths}
            mayEdit={mayEdit}
          />

          <div style={CARD} data-testid="runbooks">
            <div style={EYEBROW}>{t("services.kpiRunbooks", { count: ownRunbooks.length })}</div>
            <RunbookList
              serviceId={svc.id}
              mayManage={mayManage}
              runbooks={runbooks.map((r) => ({
                id: r.id,
                title: r.title,
                sourceUrl: r.sourceUrl,
                content: r.content,
                fetchError: r.fetchError,
                fetchedAt: r.fetchedAt ? r.fetchedAt.toISOString() : null,
                workspaceWide: r.serviceId === null,
              }))}
            />
          </div>

          <div style={CARD} data-testid="service-seen-in">
            <div style={EYEBROW}>{t("services.seenIn")}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--ink-2)" }}>
              {seenIn.length > 0 ? seenIn.join(" · ") : t("services.seenNowhere")}
            </div>
            {svc.aliases.length > 0 && (
              <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                {t("services.alsoNamed")}{" "}
                <span style={{ fontFamily: "var(--mono)" }}>{svc.aliases.join(", ")}</span>
              </div>
            )}
          </div>

          {!installed && (
            <div
              style={{
                background: "var(--sunk)",
                borderRadius: "var(--radius-card)",
                padding: "12px 14px",
                fontSize: 12,
                color: "var(--ink-2)",
                lineHeight: 1.5,
              }}
            >
              {t("services.dependenciesNoTelemetry")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
