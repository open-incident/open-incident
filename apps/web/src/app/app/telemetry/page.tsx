import Link from "next/link";
import { getT } from "@/i18n/server";
import { canRespond, isManager, requireMember } from "@/lib/session";
import { requireTenant } from "@/lib/tenant";
import { otlpEndpoints } from "@/lib/telemetry-module";
import { telemetryInstalled } from "@/lib/telemetry";
import {
  RANGE_MINUTES,
  receivingNow,
  type RangeKey,
  type TelemetrySearch,
} from "@/lib/telemetry-board";
import { NotInstalled } from "./not-installed";
import { ExceptionsTab } from "./exceptions-tab";
import { MapTab } from "./map-tab";
import { SqlTab } from "./sql-tab";
import { ProfilesTab } from "./profiles-tab";
import { RumTab } from "./rum-tab";
import { SlosTab } from "./slos-tab";
import { DashboardsTab } from "./dashboards-tab";
import { ConnectTab } from "./connect-tab";
import { ServicesView } from "./services-view";
import { TracesView } from "./traces-view";
import { LogsView } from "./logs-view";
import { MetricsView } from "./metrics-view";
import { SetupView } from "./setup-view";
import { WindowMenu } from "./window-menu";
import { ago } from "../monitors/format";

/**
 * Telemetry — the services, their traces, their logs and their metrics, and
 * how they are plugged in (design: V2Telemetry).
 *
 * Until the module is installed this screen says so and says how, rather than
 * drawing empty charts: an instance without a ClickHouse cannot show a span,
 * and pretending it can is the one thing the product refuses to do.
 *
 * Five tabs, as the design draws them. The other views the module has —
 * exceptions, profiles, real users, SQL, the service map, dashboards,
 * objectives and the long connection page — keep their addresses (`?tab=`),
 * because runbooks, alert bodies and other screens link to them; they render
 * under the same header with no tab selected.
 */
const TABS = ["services", "traces", "logs", "metrics", "setup"] as const;
type Tab = (typeof TABS)[number];
const LEGACY = [
  "exceptions",
  "profiles",
  "rum",
  "sql",
  "map",
  "dashboards",
  "slos",
  "connect",
] as const;
type Legacy = (typeof LEGACY)[number];

/** Old addresses that name a view the five tabs now hold. */
const MOVED: Record<string, Tab | Legacy> = {
  overview: "services",
  explore: "traces",
};

export default async function TelemetryPage({
  searchParams,
}: {
  searchParams: Promise<TelemetrySearch>;
}) {
  const { member } = await requireMember();
  const tenant = await requireTenant();
  const t = await getT();
  const sp = await searchParams;
  const admin = isManager(member);
  const endpoints = otlpEndpoints(hostOf(tenant));

  if (!telemetryInstalled()) {
    return <NotInstalled admin={admin} endpoint={endpoints.grpc} />;
  }

  /*
   * The view. `?tab=explore&signal=logs` is how the previous screen spelled
   * the logs, and it lands on the logs.
   */
  const asked = sp.tab ?? "";
  const signal = sp.signal ?? "";
  let view: Tab | Legacy = "services";
  if ((TABS as readonly string[]).includes(asked)) view = asked as Tab;
  else if ((LEGACY as readonly string[]).includes(asked)) view = asked as Legacy;
  else if (
    asked === "explore" &&
    ((TABS as readonly string[]).includes(signal) || (LEGACY as readonly string[]).includes(signal))
  )
    view = signal as Tab | Legacy;
  else if (MOVED[asked]) view = MOVED[asked]!;
  const range: RangeKey = sp.range && sp.range in RANGE_MINUTES ? (sp.range as RangeKey) : "1h";
  const minutes = RANGE_MINUTES[range];
  const zoomFrom = Number(sp.from);
  const zoomTo = Number(sp.to);
  const zoomed =
    Number.isFinite(zoomFrom) && Number.isFinite(zoomTo) && zoomTo > zoomFrom && zoomFrom > 0;
  const to = zoomed ? new Date(zoomTo) : new Date();
  const from = zoomed ? new Date(zoomFrom) : new Date(to.getTime() - minutes * 60_000);

  const receiving = await receivingNow(tenant.id);

  const href = (tab: Tab) => {
    const q = new URLSearchParams({ tab });
    if (range !== "1h") q.set("range", range);
    if (zoomed) {
      q.set("from", String(zoomFrom));
      q.set("to", String(zoomTo));
    }
    if (sp.service && tab !== "setup") q.set("service", sp.service);
    return `/app/telemetry?${q.toString()}`;
  };

  return (
    <div
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: "22px 28px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
      data-screen-label="Telemetry"
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
          {t("nav.telemetry")}
        </h1>
        <nav
          aria-label={t("nav.telemetry")}
          style={{
            display: "flex",
            gap: 2,
            background: "var(--sunk)",
            borderRadius: 10,
            padding: 3,
          }}
        >
          {TABS.map((k) => {
            const on = view === k;
            return (
              <Link
                key={k}
                href={href(k)}
                data-testid={`telemetry-tab-${k}`}
                aria-current={on ? "page" : undefined}
                style={{
                  height: 28,
                  padding: "0 12px",
                  borderRadius: 8,
                  background: on ? "var(--panel)" : "transparent",
                  color: on ? "var(--ink)" : "var(--ink-3)",
                  boxShadow: on ? "var(--shadow-card)" : "none",
                  display: "flex",
                  alignItems: "center",
                  fontSize: 12.5,
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                {t(`telemetry.tab.${k}` as "telemetry.tab.logs")}
              </Link>
            );
          })}
        </nav>
        <span style={{ flex: 1 }} />
        <span
          data-testid="telemetry-receiving"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11.5,
            color: receiving.perSecond > 0 ? "var(--ok)" : "var(--ink-3)",
            fontWeight: 600,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: receiving.perSecond > 0 ? "var(--ok)" : "var(--ink-3)",
              animation: receiving.perSecond > 0 ? "oi-pulse 2.4s infinite" : "none",
            }}
          />
          {receiving.perSecond > 0
            ? t("tel2.receiving", { rate: rateLabel(receiving.perSecond) })
            : receiving.lastAt
              ? t("tel2.silent", { ago: ago(receiving.lastAt) })
              : t("tel2.silentNever")}
        </span>
        {view !== "metrics" && (
          <WindowMenu
            range={range}
            zoomed={zoomed ? { from: zoomFrom, to: zoomTo } : null}
            labels={{
              "15m": t("tel2.last15m"),
              "1h": t("tel2.last1h"),
              "6h": t("tel2.last6h"),
              "24h": t("tel2.last24h"),
              "7d": t("tel2.last7d"),
            }}
          />
        )}
      </div>

      {view === "services" && (
        <ServicesView tenantId={tenant.id} from={from} to={to} range={range} />
      )}
      {view === "traces" && (
        <TracesView tenantId={tenant.id} from={from} to={to} sp={sp} mayEdit={canRespond(member)} />
      )}
      {view === "logs" && (
        <LogsView tenantId={tenant.id} from={from} to={to} sp={sp} range={range} />
      )}
      {view === "metrics" && <MetricsView tenantId={tenant.id} sp={sp} />}
      {view === "setup" && (
        <SetupView tenantId={tenant.id} admin={admin} endpoints={endpoints} sp={sp} />
      )}

      {view === "exceptions" && (
        <ExceptionsTab
          tenantId={tenant.id}
          open={sp.fp}
          mayEdit={canRespond(member)}
          service={sp.service}
          filter={sp.q}
        />
      )}
      {view === "profiles" && (
        <ProfilesTab
          tenantId={tenant.id}
          service={sp.service}
          type={sp.type}
          sinceMinutes={Math.min(minutes, 1440)}
          compare={sp.compare === "1"}
        />
      )}
      {view === "rum" && (
        <RumTab
          tenantId={tenant.id}
          view={sp.view === "sessions" || sp.view === "errors" ? sp.view : "overview"}
          sinceHours={Math.max(1, Math.round(minutes / 60))}
          session={sp.session}
        />
      )}
      {view === "sql" && <SqlTab tenantId={tenant.id} query={sp.q} />}
      {view === "map" && (
        <MapTab
          tenantId={tenant.id}
          sinceMinutes={minutes}
          highlight={sp.service}
          windowLinks={false}
        />
      )}
      {view === "dashboards" && (
        <DashboardsTab tenantId={tenant.id} admin={admin} error={sp.error} />
      )}
      {view === "slos" && (
        <SlosTab
          tenantId={tenant.id}
          mayEdit={canRespond(member)}
          error={sp.error}
          why={sp.why}
          openNew={!!sp.new}
        />
      )}
      {view === "connect" && (
        <ConnectTab tenantId={tenant.id} admin={admin} issued={sp.issued} http={endpoints.http} />
      )}
    </div>
  );
}

function hostOf(tenant: { slug: string; customDomain: string | null }): string {
  return tenant.customDomain ?? `${tenant.slug}.${process.env.BASE_DOMAIN ?? "example"}`;
}

function rateLabel(perSecond: number): string {
  if (perSecond >= 1000) return `${(perSecond / 1000).toFixed(1)}k`;
  if (perSecond >= 10) return String(Math.round(perSecond));
  return perSecond.toFixed(1);
}
