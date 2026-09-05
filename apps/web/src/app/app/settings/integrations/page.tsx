import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { alertSources, alerts, integrationInstalls, withTenant } from "@openincident/db";
import {
  getSlackInstall,
  getTeamsInstall,
  getTeamsPairing,
  slack,
  slackConfigured,
  teamsAppId,
  teamsConfigured,
  teamsGraph,
} from "@openincident/chat";
import { isManagerRole } from "@openincident/config";
import { getT } from "@/i18n/server";
import { currentOrigin } from "@/lib/tenant";
import { requireMember } from "@/lib/session";
import {
  disconnectSlack,
  removeBridge,
  removeTracker,
  saveBridge,
  saveSlackConfig,
  removeDocs,
  saveDocs,
  saveTracker,
  syncTrackersNow,
  testSlack,
  disconnectTeamsAction,
  saveTeamsConfig,
  startTeamsPairingAction,
  testTeams,
} from "./actions";
import {
  TRACKER_KINDS,
  trackerTarget,
  type TrackerConfig,
  type TrackerKind,
} from "@openincident/trackers";
import { DOCS_KINDS, docsTarget, type DocsConfig, type DocsKind } from "@openincident/docs";
import { SOCIAL_PROVIDERS } from "@openincident/auth";
import { IntegrationIcon } from "./icons";

type Card = {
  id: string;
  /** The glyph to draw; defaults to the card's id (see icons.tsx). */
  icon?: string;
  name: string;
  category: "sources" | "trackers" | "docs" | "chat" | "sso" | "catalog" | "migration";
  kind?: string;
  connect?:
    | "slack"
    | "teams"
    | "meet"
    | "zoom"
    | "github"
    | "gitlab"
    | "jira"
    | "linear"
    | "confluence"
    | "notion";
  soon?: string;
  /** A screen that configures this integration, when it has one. */
  href?: string;
  /** Decided by the card itself: an identity provider the instance carries. */
  connected?: boolean;
  /** The instance lacks what this needs — said, never silently disabled. */
  unavailable?: boolean;
  desc: string;
};

/**
 * Settings → Integrations: the catalog of connectors. Alert sources and the
 * Slack app are live; video-call links are a template attached to every new
 * incident; trackers, Teams and SSO are drawn with their milestone, never as
 * buttons that do nothing. The Slack connect flow is the design's three-step
 * modal: authorize, configure, test.
 */
export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const q = await searchParams;
  const origin = await currentOrigin();
  const manages = isManagerRole(member);
  const data = await withTenant(tenant.id, async (tx) => {
    const sources = await tx
      .select({
        kind: alertSources.kind,
        active: alertSources.active,
        count:
          sql<number>`(select count(*) from ${alerts} a where a.source_id = ${alertSources.id} and a.first_at > now() - interval '90 days')`.mapWith(
            Number,
          ),
      })
      .from(alertSources)
      .where(eq(alertSources.tenantId, tenant.id));
    const installs = await tx
      .select()
      .from(integrationInstalls)
      .where(
        and(eq(integrationInstalls.tenantId, tenant.id), eq(integrationInstalls.status, "active")),
      );
    const slackInstall = await getSlackInstall(tx, tenant.id);
    const teamsInstall = await getTeamsInstall(tx, tenant.id);
    const teamsPairing = teamsInstall ? null : await getTeamsPairing(tx, tenant.id);
    return { sources, installs, slackInstall, teamsInstall, teamsPairing };
  });
  const bridge = data.installs.find((i) => i.kind === "meet" || i.kind === "zoom");
  const trackerInstalls = data.installs.filter((i) => (TRACKER_KINDS as string[]).includes(i.kind));
  const docsInstalls = data.installs.filter((i) => (DOCS_KINDS as string[]).includes(i.kind));
  const isDocs = (v: string | null | undefined): v is DocsKind =>
    (DOCS_KINDS as string[]).includes(v ?? "");
  const isTracker = (v: string | null | undefined): v is TrackerKind =>
    (TRACKER_KINDS as string[]).includes(v ?? "");
  const slackEnv = slackConfigured();
  const teamsEnv = teamsConfigured();
  // The identity providers this instance really has credentials for.
  const socialProviders = SOCIAL_PROVIDERS as string[];
  const CARDS: Card[] = [
    {
      id: "datadog",
      name: "Datadog",
      category: "sources",
      kind: "datadog",
      desc: t("settings.integrations.desc.datadog"),
    },
    {
      id: "prometheus",
      name: "Prometheus / Alertmanager",
      category: "sources",
      kind: "prometheus",
      desc: t("settings.integrations.desc.prometheus"),
    },
    {
      id: "grafana",
      name: "Grafana",
      category: "sources",
      kind: "grafana",
      desc: t("settings.integrations.desc.grafana"),
    },
    {
      id: "sentry",
      name: "Sentry",
      category: "sources",
      kind: "sentry",
      desc: t("settings.integrations.desc.sentry"),
    },
    {
      id: "cloudwatch",
      name: "Amazon CloudWatch",
      category: "sources",
      kind: "cloudwatch",
      desc: t("settings.integrations.desc.cloudwatch"),
    },
    {
      id: "uptime_kuma",
      name: "Uptime Kuma",
      category: "sources",
      kind: "uptime_kuma",
      desc: t("settings.integrations.desc.kuma"),
    },
    {
      id: "http",
      name: t("settings.integrations.httpName"),
      category: "sources",
      kind: "http",
      desc: t("settings.integrations.desc.http"),
    },
    {
      id: "email",
      name: t("settings.integrations.emailName"),
      category: "sources",
      soon: "V2",
      desc: t("settings.integrations.desc.email"),
    },
    {
      id: "slack",
      name: "Slack",
      category: "chat",
      connect: "slack",
      desc: t("settings.integrations.desc.slack"),
    },
    {
      id: "meet",
      name: "Google Meet",
      category: "chat",
      connect: "meet",
      desc: t("settings.integrations.desc.bridge"),
    },
    {
      id: "zoom",
      name: "Zoom",
      category: "chat",
      connect: "zoom",
      desc: t("settings.integrations.desc.bridge"),
    },
    {
      id: "teams",
      name: "Microsoft Teams",
      category: "chat",
      connect: "teams",
      desc: t("settings.integrations.desc.teams"),
    },
    {
      id: "github",
      name: "GitHub Issues",
      category: "trackers",
      connect: "github",
      desc: t("settings.integrations.desc.github"),
    },
    {
      id: "gitlab",
      name: "GitLab Issues",
      category: "trackers",
      connect: "gitlab",
      desc: t("settings.integrations.desc.gitlab"),
    },
    {
      id: "jira",
      name: "Jira",
      category: "trackers",
      connect: "jira",
      desc: t("settings.integrations.desc.jira"),
    },
    {
      id: "linear",
      name: "Linear",
      category: "trackers",
      connect: "linear",
      desc: t("settings.integrations.desc.linear"),
    },
    {
      id: "confluence",
      name: "Confluence",
      category: "docs",
      connect: "confluence",
      desc: t("settings.integrations.desc.confluence"),
    },
    {
      id: "notion",
      name: "Notion",
      category: "docs",
      connect: "notion",
      desc: t("settings.integrations.desc.notion"),
    },
    {
      id: "newrelic",
      name: "New Relic",
      category: "sources",
      soon: "V2",
      desc: t("settings.integrations.desc.parser"),
    },
    {
      id: "elastic",
      name: "Elastic",
      category: "sources",
      soon: "V2",
      desc: t("settings.integrations.desc.parser"),
    },
    {
      id: "google",
      icon: "saml",
      name: "Google",
      category: "sso",
      desc: t("settings.integrations.desc.oauth"),
      unavailable: !socialProviders.includes("google"),
      connected: socialProviders.includes("google"),
    },
    {
      id: "microsoft",
      icon: "saml",
      name: "Microsoft",
      category: "sso",
      desc: t("settings.integrations.desc.oauth"),
      unavailable: !socialProviders.includes("microsoft"),
      connected: socialProviders.includes("microsoft"),
    },
    {
      id: "githubsso",
      icon: "github",
      name: "GitHub",
      category: "sso",
      desc: t("settings.integrations.desc.oauth"),
      unavailable: !socialProviders.includes("github"),
      connected: socialProviders.includes("github"),
    },
    {
      id: "scim",
      name: "SCIM",
      category: "sso",
      href: "/app/settings/scim",
      desc: t("settings.integrations.desc.scim"),
    },
    {
      id: "backstage",
      name: "Backstage",
      category: "catalog",
      href: "/app/settings/api",
      desc: t("settings.integrations.desc.backstage"),
    },
    {
      id: "cli",
      name: t("settings.integrations.importerName"),
      category: "catalog",
      href: "/app/catalog",
      desc: t("settings.integrations.desc.importer"),
    },
    {
      id: "terraform",
      name: "Terraform",
      category: "catalog",
      soon: "V2+",
      desc: t("settings.integrations.desc.terraform"),
    },
    {
      id: "pagerduty",
      name: "PagerDuty",
      category: "migration",
      soon: "V2+",
      desc: t("settings.integrations.desc.pagerduty"),
    },
    {
      id: "opsgenie",
      name: "Opsgenie",
      category: "migration",
      soon: "V2+",
      desc: t("settings.integrations.desc.opsgenie"),
    },
    {
      id: "statuspage",
      name: "Statuspage",
      category: "migration",
      soon: "V2+",
      desc: t("settings.integrations.desc.statuspage"),
    },
    {
      id: "hris",
      name: t("settings.integrations.hrisName"),
      category: "migration",
      soon: "V2+",
      desc: t("settings.integrations.desc.hris"),
    },
    {
      id: "siem",
      name: t("settings.integrations.siemName"),
      category: "migration",
      soon: "V2+",
      desc: t("settings.integrations.desc.siem"),
    },
    {
      id: "saml",
      name: "SAML / OIDC",
      category: "sso",
      href: "/app/settings/sso",
      desc: t("settings.integrations.desc.sso"),
    },
  ];
  const cats = [
    "all",
    "sources",
    "chat",
    "trackers",
    "docs",
    "sso",
    "catalog",
    "migration",
  ] as const;
  const cat = cats.includes(q.cat as (typeof cats)[number])
    ? (q.cat as (typeof cats)[number])
    : "all";
  const query = (q.q ?? "").trim().toLowerCase();
  const list = CARDS.filter(
    (c) =>
      (cat === "all" || c.category === cat) && (!query || c.name.toLowerCase().includes(query)),
  );
  const stateOf = (c: Card): { connected: boolean; meta: string | null; unavailable?: boolean } => {
    // A card that knows its own state (an identity provider read from the
    // instance's configuration) is believed.
    if (c.connected !== undefined || c.unavailable !== undefined) {
      return {
        connected: Boolean(c.connected),
        meta: null,
        ...(c.unavailable ? { unavailable: true } : {}),
      };
    }
    if (c.kind) {
      const s = data.sources.filter((x) => x.kind === c.kind && x.active);
      return {
        connected: s.length > 0,
        meta: s.length
          ? t("settings.sources.meta", { count: s.reduce((a, x) => a + x.count, 0) })
          : null,
      };
    }
    if (c.connect === "slack")
      return slackEnv
        ? {
            connected: Boolean(data.slackInstall),
            meta: data.slackInstall
              ? `${data.slackInstall.teamName}${data.slackInstall.config.announceChannelName ? ` · #${data.slackInstall.config.announceChannelName}` : ""}`
              : null,
          }
        : { connected: false, meta: null, unavailable: true };
    if (c.connect === "teams")
      return teamsEnv
        ? {
            connected: Boolean(data.teamsInstall),
            meta: data.teamsInstall
              ? `${data.teamsInstall.teamName}${data.teamsInstall.config.announceChannelName ? ` · ${data.teamsInstall.config.announceChannelName}` : ""}`
              : data.teamsPairing
                ? t("settings.integrations.teamsPairingPending")
                : null,
          }
        : { connected: false, meta: null, unavailable: true };
    if (c.connect === "confluence" || c.connect === "notion") {
      const inst = docsInstalls.find((i) => i.kind === c.connect);
      return {
        connected: Boolean(inst),
        meta: inst
          ? `${docsTarget({ ...(inst.config as object), kind: inst.kind } as DocsConfig)}${inst.externalName ? ` · ${inst.externalName}` : ""}`
          : null,
      };
    }
    if (
      c.connect === "github" ||
      c.connect === "gitlab" ||
      c.connect === "jira" ||
      c.connect === "linear"
    ) {
      const inst = trackerInstalls.find((i) => i.kind === c.connect);
      return {
        connected: Boolean(inst),
        meta: inst
          ? `${trackerTarget({ ...(inst.config as object), kind: inst.kind } as TrackerConfig)}${inst.externalName ? ` · ${inst.externalName}` : ""}`
          : null,
      };
    }
    if (c.connect === "meet" || c.connect === "zoom")
      return {
        connected: bridge?.kind === c.connect,
        meta:
          bridge?.kind === c.connect
            ? String((bridge.config as { template?: string }).template ?? "")
            : null,
      };
    return { connected: false, meta: null };
  };
  const connected = CARDS.filter((c) => stateOf(c).connected).length;
  const connect =
    q.connect === "slack" ||
    q.connect === "teams" ||
    q.connect === "meet" ||
    q.connect === "zoom" ||
    isTracker(q.connect) ||
    isDocs(q.connect)
      ? q.connect
      : null;
  const teamsStep =
    connect === "teams"
      ? q.step === "3"
        ? 3
        : q.step === "2" || (data.teamsInstall && q.step !== "1")
          ? 2
          : 1
      : 1;
  const teamsChannels =
    connect === "teams" && teamsStep === 2 && data.teamsInstall
      ? await teamsGraph
          .listChannels(data.teamsInstall.config.aadTenantId, data.teamsInstall.teamId)
          .then((r) => (r.ok ? r.value.value : []))
          .catch(() => [])
      : [];
  const docsConnect = isDocs(connect) ? connect : null;
  const docsInstall = docsConnect ? docsInstalls.find((i) => i.kind === docsConnect) : undefined;
  const docsCfg = (docsInstall?.config ?? {}) as Record<string, string | undefined>;
  const trackerConnect = isTracker(connect) ? connect : null;
  const trackerInstall = trackerConnect
    ? trackerInstalls.find((i) => i.kind === trackerConnect)
    : undefined;
  const trackerCfg = (trackerInstall?.config ?? {}) as Record<string, string | undefined>;
  const step =
    connect === "slack" ? (q.step === "3" ? 3 : q.step === "2" || data.slackInstall ? 2 : 1) : 1;
  const channels =
    connect === "slack" && step === 2 && data.slackInstall
      ? await slack(data.slackInstall.token)
          .listChannels()
          .catch(() => [])
      : [];
  const chip = (text: string, tone: "ok" | "muted") => (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 9px 2px 7px",
        borderRadius: 999,
        background: tone === "ok" ? "var(--ok-t)" : "var(--sunk)",
        color: tone === "ok" ? "var(--ok)" : "var(--ink-3)",
        fontSize: 10.5,
        fontWeight: 700,
        flex: "none",
      }}
    >
      <span style={{ width: 4, height: 4, borderRadius: "50%", background: "currentColor" }} />
      {text}
    </span>
  );
  const label: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: ".1em",
    textTransform: "uppercase",
    color: "var(--ink-3)",
  };
  const control: React.CSSProperties = {
    height: 38,
    padding: "0 12px",
    border: "1px solid var(--line)",
    borderRadius: 10,
    outline: "none",
    fontSize: 13,
    background: "var(--panel)",
    width: "100%",
  };
  const brandBtn: React.CSSProperties = {
    height: 34,
    padding: "0 16px",
    borderRadius: 9,
    background: "var(--brand)",
    color: "#fff",
    border: 0,
    display: "inline-flex",
    alignItems: "center",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    textDecoration: "none",
  };
  const ghostBtn: React.CSSProperties = {
    height: 34,
    padding: "0 13px",
    border: "1px solid var(--line)",
    borderRadius: 9,
    background: "var(--panel)",
    display: "inline-flex",
    alignItems: "center",
    fontSize: 12.5,
    cursor: "pointer",
    color: "inherit",
    textDecoration: "none",
  };

  return (
    <div
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1060 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("settings.integrations.title")}
        </h1>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {t("settings.integrations.subtitle", { count: connected })}
        </span>
        <span style={{ flex: 1 }} />
        {q.synced !== undefined && (
          <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
            {t("settings.integrations.trackerSynced", {
              checked: Number(q.synced),
              completed: Number(q.completed ?? 0),
            })}
          </span>
        )}
        {q.saved && (
          <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
            {t("common.saved")}
          </span>
        )}
        <Link
          href="/app/settings/api"
          className="oi-hover"
          style={{ ...ghostBtn, height: 32, fontWeight: 600 }}
        >
          {t("settings.integrations.apiLink")}
        </Link>
      </div>
      <form style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input type="hidden" name="cat" value={cat} />
        <input
          name="q"
          defaultValue={q.q ?? ""}
          placeholder={t("settings.integrations.search")}
          className="oi-field"
          style={{
            height: 34,
            padding: "0 12px",
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            width: 270,
            fontSize: 13,
          }}
        />
        {cats.map((c) => (
          <Link
            key={c}
            href={`/app/settings/integrations?cat=${c}${q.q ? `&q=${encodeURIComponent(q.q)}` : ""}`}
            style={{
              height: 30,
              padding: "0 12px",
              border: `1px solid ${cat === c ? "var(--brand)" : "var(--line)"}`,
              borderRadius: 999,
              background: cat === c ? "var(--brand-t)" : "var(--panel)",
              color: cat === c ? "var(--brand)" : "var(--ink-2)",
              display: "flex",
              alignItems: "center",
              fontSize: 12,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {t(`settings.integrations.cat.${c}`)}
          </Link>
        ))}
      </form>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(252px, 1fr))",
          gap: 10,
        }}
      >
        {list.map((c) => {
          const st = stateOf(c);
          const href = c.href
            ? c.href
            : c.kind
              ? `/app/settings/alert-sources?new=${c.kind}`
              : c.connect
                ? `/app/settings/integrations?connect=${c.connect}`
                : null;
          return (
            <div
              key={c.id}
              data-testid="integration-card"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 9,
                padding: "13px 14px",
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: 13,
                opacity: c.soon || st.unavailable ? 0.75 : 1,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    width: 36,
                    height: 36,
                    flex: "none",
                    borderRadius: 10,
                    border: "1px solid var(--line-2)",
                    background: "var(--sunk)",
                    display: "grid",
                    placeItems: "center",
                    color: "var(--ink-2)",
                  }}
                >
                  <IntegrationIcon id={c.icon ?? c.id} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
                    {t(`settings.integrations.cat.${c.category}`)}
                  </div>
                </div>
                {c.soon ? (
                  <span
                    style={{
                      padding: "2px 8px",
                      border: "1px solid var(--line)",
                      borderRadius: 6,
                      color: "var(--ink-3)",
                      fontSize: 10.5,
                      fontWeight: 600,
                      flex: "none",
                    }}
                  >
                    {c.soon}
                  </span>
                ) : st.unavailable ? (
                  <span
                    title={
                      c.connect === "slack"
                        ? t("settings.integrations.slackNotConfigured")
                        : t("settings.integrations.notConfigured")
                    }
                    style={{
                      padding: "2px 8px",
                      border: "1px solid var(--line)",
                      borderRadius: 6,
                      color: "var(--ink-3)",
                      fontSize: 10.5,
                      fontWeight: 600,
                      flex: "none",
                    }}
                  >
                    {t("notif.instanceConfig")}
                  </span>
                ) : st.connected ? (
                  c.connect && manages ? (
                    <Link
                      href={href!}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "2px 9px 2px 7px",
                        borderRadius: 999,
                        background: "var(--ok-t)",
                        color: "var(--ok)",
                        fontSize: 10.5,
                        fontWeight: 700,
                        flex: "none",
                        textDecoration: "none",
                      }}
                      aria-label={t("settings.integrations.configure")}
                    >
                      <span
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: "50%",
                          background: "currentColor",
                        }}
                      />
                      {t("settings.integrations.connected")}
                    </Link>
                  ) : (
                    chip(t("settings.integrations.connected"), "ok")
                  )
                ) : href && manages ? (
                  <Link
                    href={href}
                    style={{
                      padding: "3px 10px",
                      border: "1px solid var(--brand-b)",
                      borderRadius: 999,
                      color: "var(--brand)",
                      fontSize: 11,
                      fontWeight: 700,
                      flex: "none",
                      textDecoration: "none",
                    }}
                  >
                    {c.href ? t("settings.integrations.open") : t("settings.integrations.connect")}
                  </Link>
                ) : (
                  chip(t("settings.integrations.notConnected"), "muted")
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5, minHeight: 36 }}>
                {st.unavailable
                  ? c.connect === "teams"
                    ? t("settings.integrations.teamsNotConfigured")
                    : t("settings.integrations.slackNotConfigured")
                  : c.desc}
              </div>
              {st.meta && (
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--ink-3)",
                    fontVariantNumeric: "tabular-nums",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {st.meta}
                </div>
              )}
            </div>
          );
        })}
        {list.length === 0 && (
          <div
            style={{
              gridColumn: "1 / -1",
              padding: 36,
              border: "1.5px dashed var(--line)",
              borderRadius: 14,
              color: "var(--ink-3)",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            {t("settings.integrations.empty")}
          </div>
        )}
      </div>

      {connect === "slack" && manages && slackEnv && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim-dialog)",
            display: "grid",
            placeItems: "center",
            padding: 24,
            zIndex: 60,
          }}
        >
          <div
            data-testid="slack-connect"
            role="dialog"
            className="oi-rise"
            style={{
              width: 600,
              maxWidth: "100%",
              maxHeight: "88vh",
              overflow: "auto",
              background: "var(--panel)",
              borderRadius: 18,
              boxShadow: "var(--shadow-modal)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 20px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span
                style={{
                  width: 40,
                  height: 40,
                  flex: "none",
                  borderRadius: 11,
                  border: "1px solid var(--line-2)",
                  background: "var(--sunk)",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--ink-2)",
                }}
              >
                SL
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "var(--font-title)", fontSize: 16.5, fontWeight: 600 }}>
                  Slack
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                  {t("settings.integrations.cat.chat")}
                </div>
              </div>
              <Link
                href="/app/settings/integrations"
                aria-label={t("common.close")}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  display: "grid",
                  placeItems: "center",
                  color: "var(--ink-3)",
                  fontSize: 14,
                  textDecoration: "none",
                }}
              >
                ✕
              </Link>
            </div>
            <div
              style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 16 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {([1, 2, 3] as const).map((n) => (
                  <div
                    key={n}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      flex: n < 3 ? "1 1 auto" : "none",
                    }}
                  >
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background:
                          step === n ? "var(--brand)" : step > n ? "var(--brand-t)" : "var(--sunk)",
                        color: step === n ? "#fff" : step > n ? "var(--brand)" : "var(--ink-3)",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 11,
                        fontWeight: 700,
                        border: `1px solid ${step >= n ? "var(--brand-b)" : "var(--line)"}`,
                      }}
                    >
                      {n}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: step === n ? 600 : 500,
                        color: step === n ? "var(--ink)" : "var(--ink-3)",
                      }}
                    >
                      {t(`settings.integrations.step${n}`)}
                    </span>
                    {n < 3 && <span style={{ flex: 1, height: 1, background: "var(--line)" }} />}
                  </div>
                ))}
              </div>
              {q.error && (
                <div role="alert" style={{ fontSize: 12.5, color: "var(--dang)" }}>
                  {t("settings.integrations.slackError", { error: q.error })}
                </div>
              )}
              {step === 1 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
                    {t("settings.integrations.slackAuthorizeText")}
                  </div>
                  <a
                    href="/api/slack/oauth/start"
                    data-testid="slack-authorize"
                    style={{ ...brandBtn, height: 40, justifyContent: "center" }}
                  >
                    {t("settings.integrations.slackAuthorize")}
                  </a>
                  <div
                    style={{
                      background: "var(--sunk)",
                      borderRadius: 11,
                      padding: "11px 13px",
                      fontSize: 12,
                      color: "var(--ink-2)",
                      lineHeight: 1.5,
                    }}
                  >
                    {t("settings.integrations.slackScopesNote")}
                  </div>
                </div>
              )}
              {step === 2 && data.slackInstall && (
                <form
                  action={saveSlackConfig}
                  data-testid="slack-config"
                  style={{ display: "flex", flexDirection: "column", gap: 12 }}
                >
                  <div
                    data-testid="slack-authorized"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 14px",
                      borderRadius: 10,
                      background: "var(--ok-t)",
                      color: "var(--ok)",
                      fontSize: 12.5,
                      fontWeight: 600,
                    }}
                  >
                    ✓{" "}
                    {t("settings.integrations.slackAuthorized", {
                      team: data.slackInstall.teamName,
                    })}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={label}>{t("settings.integrations.channelMode")}</span>
                    <div
                      style={{
                        display: "flex",
                        gap: 2,
                        background: "var(--sunk)",
                        borderRadius: 9,
                        padding: 3,
                      }}
                    >
                      {(["auto", "none"] as const).map((m) => (
                        <label
                          key={m}
                          style={{
                            flex: 1,
                            padding: "6px 0",
                            borderRadius: 7,
                            textAlign: "center",
                            fontSize: 12.5,
                            fontWeight: 600,
                            cursor: "pointer",
                            background:
                              data.slackInstall!.config.channelMode === m
                                ? "var(--panel)"
                                : "transparent",
                            color:
                              data.slackInstall!.config.channelMode === m
                                ? "var(--ink)"
                                : "var(--ink-3)",
                          }}
                        >
                          <input
                            type="radio"
                            name="channelMode"
                            value={m}
                            defaultChecked={data.slackInstall!.config.channelMode === m}
                            style={{ display: "none" }}
                          />
                          {t(`settings.integrations.channelMode.${m}`)}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 10 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={label}>{t("settings.integrations.channelPrefix")}</span>
                      <input
                        name="channelPrefix"
                        defaultValue={data.slackInstall.config.channelPrefix}
                        pattern="[a-z0-9_-]{1,20}"
                        required
                        className="oi-field"
                        style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12.5 }}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={label}>{t("settings.integrations.announceChannel")}</span>
                      <select
                        name="announceChannelId"
                        defaultValue={data.slackInstall.config.announceChannelId ?? ""}
                        className="oi-field"
                        style={control}
                      >
                        <option value="">{t("settings.integrations.noAnnounceChannel")}</option>
                        {channels.map((c) => (
                          <option key={c.id} value={c.id}>
                            #{c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {channels.map((c) => (
                    <input key={c.id} type="hidden" name={`channelName_${c.id}`} value={c.name} />
                  ))}
                  <input type="hidden" name="announceChannelName" value="" />
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      fontSize: 12.5,
                      color: "var(--ink-2)",
                    }}
                  >
                    <input
                      type="checkbox"
                      name="autoInvite"
                      defaultChecked={data.slackInstall.config.autoInvite}
                    />{" "}
                    {t("settings.integrations.autoInvite")}
                  </label>
                  <div
                    style={{
                      background: "var(--sunk)",
                      borderRadius: 11,
                      padding: "11px 13px",
                      fontSize: 12,
                      color: "var(--ink-2)",
                      lineHeight: 1.5,
                    }}
                  >
                    {t("settings.integrations.slackConfigNote")}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      borderTop: "1px solid var(--line-2)",
                      paddingTop: 14,
                    }}
                  >
                    <button
                      type="submit"
                      formAction={disconnectSlack}
                      formNoValidate
                      className="oi-hover-dang"
                      style={{ ...ghostBtn, color: "var(--dang)" }}
                    >
                      {t("settings.integrations.disconnect")}
                    </button>
                    <span style={{ flex: 1 }} />
                    <button type="submit" data-testid="slack-config-save" style={brandBtn}>
                      {t("settings.integrations.nextStep")}
                    </button>
                  </div>
                </form>
              )}
              {step === 3 && data.slackInstall && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
                    {t("settings.integrations.testNote")}
                  </div>
                  {q.tested && q.tested !== "fail" ? (
                    <div
                      data-testid="slack-tested"
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 9,
                        padding: "12px 14px",
                        borderRadius: 10,
                        background: "var(--ok-t)",
                        color: "var(--ok)",
                        fontSize: 12.5,
                        fontWeight: 600,
                      }}
                    >
                      ✓ {t("settings.integrations.slackTested", { where: q.tested })}
                    </div>
                  ) : (
                    <form action={testSlack}>
                      <button
                        type="submit"
                        data-testid="slack-test"
                        style={{
                          width: "100%",
                          height: 40,
                          border: "1px solid var(--brand-b)",
                          borderRadius: 10,
                          color: "var(--brand)",
                          background: "var(--brand-t)",
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {t("settings.integrations.slackTestButton", {
                          where: data.slackInstall.config.announceChannelName
                            ? `#${data.slackInstall.config.announceChannelName}`
                            : "DM",
                        })}
                      </button>
                      {q.tested === "fail" && (
                        <div
                          role="alert"
                          style={{ marginTop: 8, fontSize: 12.5, color: "var(--dang)" }}
                        >
                          {t("settings.integrations.slackTestFailed")}
                        </div>
                      )}
                    </form>
                  )}
                  <div
                    style={{
                      background: "var(--sunk)",
                      borderRadius: 11,
                      padding: "11px 13px",
                      fontSize: 12,
                      color: "var(--ink-2)",
                      lineHeight: 1.5,
                    }}
                  >
                    {t("settings.integrations.slackCommandsNote")}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      borderTop: "1px solid var(--line-2)",
                      paddingTop: 14,
                    }}
                  >
                    <Link
                      href="/app/settings/integrations?connect=slack&step=2"
                      className="oi-hover"
                      style={ghostBtn}
                    >
                      ← {t("common.previous")}
                    </Link>
                    <span style={{ flex: 1 }} />
                    <Link
                      href="/app/settings/integrations"
                      data-testid="slack-finish"
                      style={brandBtn}
                    >
                      {t("settings.integrations.finish")}
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {(connect === "meet" || connect === "zoom") && manages && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim-dialog)",
            display: "grid",
            placeItems: "center",
            padding: 24,
            zIndex: 60,
          }}
        >
          <form
            action={saveBridge}
            data-testid="bridge-form"
            role="dialog"
            className="oi-rise"
            style={{
              width: 520,
              maxWidth: "100%",
              background: "var(--panel)",
              borderRadius: 18,
              boxShadow: "var(--shadow-modal)",
            }}
          >
            <input type="hidden" name="kind" value={connect} />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 20px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <div style={{ fontFamily: "var(--font-title)", fontSize: 16.5, fontWeight: 600 }}>
                {connect === "meet" ? "Google Meet" : "Zoom"}
              </div>
              <Link
                href="/app/settings/integrations"
                aria-label={t("common.close")}
                style={{
                  marginLeft: "auto",
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  display: "grid",
                  placeItems: "center",
                  color: "var(--ink-3)",
                  fontSize: 14,
                  textDecoration: "none",
                }}
              >
                ✕
              </Link>
            </div>
            <div
              style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}
            >
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
                {t("settings.integrations.bridgeText")}
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("settings.integrations.bridgeTemplate")}</span>
                <input
                  name="template"
                  type="url"
                  required
                  defaultValue={
                    bridge?.kind === connect
                      ? String((bridge.config as { template?: string }).template ?? "")
                      : connect === "meet"
                        ? "https://meet.google.com/new"
                        : "https://zoom.us/j/"
                  }
                  className="oi-field"
                  style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12 }}
                />
              </label>
              <div
                style={{
                  background: "var(--sunk)",
                  borderRadius: 11,
                  padding: "11px 13px",
                  fontSize: 12,
                  color: "var(--ink-2)",
                  lineHeight: 1.5,
                }}
              >
                {t("settings.integrations.bridgeNote")}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "14px 20px",
                borderTop: "1px solid var(--line)",
              }}
            >
              {bridge?.kind === connect && (
                <button
                  type="submit"
                  formAction={removeBridge}
                  formNoValidate
                  className="oi-hover-dang"
                  style={{ ...ghostBtn, color: "var(--dang)" }}
                >
                  {t("settings.integrations.disconnect")}
                </button>
              )}
              <span style={{ flex: 1 }} />
              <Link href="/app/settings/integrations" className="oi-hover" style={ghostBtn}>
                {t("common.cancel")}
              </Link>
              <button type="submit" style={brandBtn}>
                {t("common.save")}
              </button>
            </div>
          </form>
        </div>
      )}
      {trackerConnect && manages && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim-dialog)",
            display: "grid",
            placeItems: "center",
            padding: 24,
            zIndex: 60,
          }}
        >
          <form
            action={saveTracker}
            data-testid="tracker-form"
            role="dialog"
            className="oi-rise"
            style={{
              width: 540,
              maxWidth: "100%",
              background: "var(--panel)",
              borderRadius: 18,
              boxShadow: "var(--shadow-modal)",
            }}
          >
            <input type="hidden" name="kind" value={trackerConnect} />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 20px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <div style={{ fontFamily: "var(--font-title)", fontSize: 16.5, fontWeight: 600 }}>
                {trackerConnect === "github"
                  ? "GitHub Issues"
                  : trackerConnect === "gitlab"
                    ? "GitLab Issues"
                    : trackerConnect === "jira"
                      ? "Jira"
                      : "Linear"}
              </div>
              {trackerInstall && chip(t("settings.integrations.connected"), "ok")}
              <Link
                href="/app/settings/integrations"
                aria-label={t("common.close")}
                style={{
                  marginLeft: "auto",
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  display: "grid",
                  placeItems: "center",
                  color: "var(--ink-3)",
                  fontSize: 14,
                  textDecoration: "none",
                }}
              >
                ✕
              </Link>
            </div>
            <div
              style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}
            >
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
                {t(`settings.integrations.trackerText.${trackerConnect}`)}
              </div>
              {trackerConnect === "github" && (
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("settings.integrations.tracker.repo")}</span>
                  <input
                    name="repo"
                    required
                    placeholder="owner/repository"
                    defaultValue={trackerCfg.repo ?? ""}
                    className="oi-field"
                    style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12 }}
                  />
                </label>
              )}
              {trackerConnect === "gitlab" && (
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("settings.integrations.tracker.project")}</span>
                  <input
                    name="project"
                    required
                    placeholder="group/project"
                    defaultValue={trackerCfg.project ?? ""}
                    className="oi-field"
                    style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12 }}
                  />
                </label>
              )}
              {trackerConnect === "jira" && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={label}>{t("settings.integrations.tracker.site")}</span>
                      <input
                        name="site"
                        required
                        placeholder="acme.atlassian.net"
                        defaultValue={trackerCfg.site ?? ""}
                        className="oi-field"
                        style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12 }}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={label}>{t("settings.integrations.tracker.projectKey")}</span>
                      <input
                        name="projectKey"
                        required
                        placeholder="OPS"
                        defaultValue={trackerCfg.projectKey ?? ""}
                        className="oi-field"
                        style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12 }}
                      />
                    </label>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={label}>{t("settings.integrations.tracker.email")}</span>
                      <input
                        name="email"
                        type="email"
                        required
                        defaultValue={trackerCfg.email ?? ""}
                        className="oi-field"
                        style={control}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={label}>{t("settings.integrations.tracker.issueType")}</span>
                      <input
                        name="issueType"
                        placeholder="Task"
                        defaultValue={trackerCfg.issueType ?? ""}
                        className="oi-field"
                        style={control}
                      />
                    </label>
                  </div>
                </>
              )}
              {trackerConnect === "linear" && (
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("settings.integrations.tracker.teamKey")}</span>
                  <input
                    name="teamKey"
                    required
                    placeholder="OPS"
                    defaultValue={trackerCfg.teamKey ?? ""}
                    className="oi-field"
                    style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12 }}
                  />
                </label>
              )}
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>
                  {t(`settings.integrations.tracker.secret.${trackerConnect}`)}
                </span>
                <input
                  name="secret"
                  type="password"
                  required
                  autoComplete="off"
                  placeholder={trackerInstall ? "••••••••" : ""}
                  className="oi-field"
                  style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12 }}
                />
              </label>
              {q.error === "test" && (
                <div role="alert" style={{ fontSize: 12.5, color: "var(--dang)" }}>
                  {t("settings.integrations.trackerTestFailed")}
                  {q.detail ? ` — ${q.detail}` : ""}
                </div>
              )}
              {q.error === "invalid" && (
                <div role="alert" style={{ fontSize: 12.5, color: "var(--dang)" }}>
                  {t("settings.integrations.trackerInvalid")}
                </div>
              )}
              <div
                style={{
                  background: "var(--sunk)",
                  borderRadius: 11,
                  padding: "11px 13px",
                  fontSize: 12,
                  color: "var(--ink-2)",
                  lineHeight: 1.5,
                }}
              >
                {t("settings.integrations.trackerNote")}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "14px 20px",
                borderTop: "1px solid var(--line)",
              }}
            >
              {trackerInstall && (
                <>
                  <button
                    type="submit"
                    formAction={removeTracker}
                    formNoValidate
                    className="oi-hover-dang"
                    style={{ ...ghostBtn, color: "var(--dang)" }}
                  >
                    {t("settings.integrations.disconnect")}
                  </button>
                  <button
                    type="submit"
                    formAction={syncTrackersNow}
                    formNoValidate
                    data-testid="tracker-sync"
                    className="oi-hover"
                    style={ghostBtn}
                  >
                    {t("settings.integrations.trackerSyncNow")}
                  </button>
                </>
              )}
              <span style={{ flex: 1 }} />
              <Link href="/app/settings/integrations" className="oi-hover" style={ghostBtn}>
                {t("common.cancel")}
              </Link>
              <button type="submit" data-testid="tracker-save" style={brandBtn}>
                {trackerInstall
                  ? t("settings.integrations.trackerReconnect")
                  : t("settings.integrations.trackerTestConnect")}
              </button>
            </div>
          </form>
        </div>
      )}
      {connect === "teams" && manages && teamsEnv && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim-dialog)",
            display: "grid",
            placeItems: "center",
            padding: 24,
            zIndex: 60,
          }}
        >
          <div
            role="dialog"
            data-testid="teams-dialog"
            className="oi-rise"
            style={{
              width: 560,
              maxWidth: "100%",
              background: "var(--panel)",
              borderRadius: 18,
              boxShadow: "var(--shadow-modal)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 20px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span
                style={{
                  width: 36,
                  height: 36,
                  flex: "none",
                  borderRadius: 11,
                  border: "1px solid var(--line-2)",
                  background: "var(--sunk)",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--ink-2)",
                }}
              >
                MT
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "var(--font-title)", fontSize: 16.5, fontWeight: 600 }}>
                  Microsoft Teams
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                  {t("settings.integrations.cat.chat")}
                </div>
              </div>
              {data.teamsInstall && chip(t("settings.integrations.connected"), "ok")}
              <Link
                href="/app/settings/integrations"
                aria-label={t("common.close")}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  display: "grid",
                  placeItems: "center",
                  color: "var(--ink-3)",
                  fontSize: 14,
                  textDecoration: "none",
                }}
              >
                ✕
              </Link>
            </div>
            <div
              style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 16 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {([1, 2, 3] as const).map((n) => (
                  <div
                    key={n}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      flex: n < 3 ? "1 1 auto" : "none",
                    }}
                  >
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background:
                          teamsStep === n
                            ? "var(--brand)"
                            : teamsStep > n
                              ? "var(--brand-t)"
                              : "var(--sunk)",
                        color:
                          teamsStep === n
                            ? "#fff"
                            : teamsStep > n
                              ? "var(--brand)"
                              : "var(--ink-3)",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 11,
                        fontWeight: 700,
                        border: `1px solid ${teamsStep >= n ? "var(--brand-b)" : "var(--line)"}`,
                      }}
                    >
                      {n}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: teamsStep === n ? 600 : 500,
                        color: teamsStep === n ? "var(--ink)" : "var(--ink-3)",
                      }}
                    >
                      {t(`settings.integrations.step${n}`)}
                    </span>
                    {n < 3 && <span style={{ flex: 1, height: 1, background: "var(--line)" }} />}
                  </div>
                ))}
              </div>
              {teamsStep === 1 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
                    {t("settings.integrations.teamsIntro")}
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr",
                      gap: "6px 12px",
                      fontSize: 12.5,
                      alignItems: "center",
                    }}
                  >
                    <span style={label}>{t("settings.integrations.teamsEndpoint")}</span>
                    <code style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>
                      {`${origin}/api/teams/messages`}
                    </code>
                    <span style={label}>{t("settings.integrations.teamsAppId")}</span>
                    <code style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>
                      {teamsAppId()}
                    </code>
                  </div>
                  {data.teamsInstall ? (
                    <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                      {t("settings.integrations.teamsPaired", { team: data.teamsInstall.teamName })}
                    </div>
                  ) : data.teamsPairing ? (
                    <div
                      data-testid="teams-pairing-code"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        border: "1px solid var(--brand-b)",
                        background: "var(--brand-t)",
                        borderRadius: 11,
                        padding: "12px 14px",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 22,
                          fontWeight: 700,
                          letterSpacing: ".12em",
                          color: "var(--brand)",
                        }}
                      >
                        {data.teamsPairing.code}
                      </span>
                      <span style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
                        {t("settings.integrations.teamsPairingHint", {
                          code: data.teamsPairing.code,
                          until: t.fmt.time(data.teamsPairing.expiresAt, t.timeZone),
                        })}
                      </span>
                    </div>
                  ) : null}
                  <form action={startTeamsPairingAction} style={{ display: "flex", gap: 8 }}>
                    <button type="submit" data-testid="teams-pair" style={brandBtn}>
                      {data.teamsPairing || data.teamsInstall
                        ? t("settings.integrations.teamsNewCode")
                        : t("settings.integrations.teamsGenerateCode")}
                    </button>
                    {data.teamsInstall && (
                      <Link
                        href="/app/settings/integrations?connect=teams&step=2"
                        className="oi-hover"
                        style={ghostBtn}
                      >
                        {t("settings.integrations.nextStep")}
                      </Link>
                    )}
                  </form>
                </div>
              )}
              {teamsStep === 2 && data.teamsInstall && (
                <form
                  action={saveTeamsConfig}
                  data-testid="teams-config-form"
                  style={{ display: "flex", flexDirection: "column", gap: 12 }}
                >
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                    {t("settings.integrations.teamsPaired", { team: data.teamsInstall.teamName })}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={label}>{t("settings.integrations.channelMode")}</span>
                      <select
                        name="channelMode"
                        defaultValue={data.teamsInstall.config.channelMode}
                        className="oi-field"
                        style={control}
                      >
                        <option value="auto">{t("settings.integrations.channelMode.auto")}</option>
                        <option value="none">{t("settings.integrations.channelMode.none")}</option>
                      </select>
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={label}>{t("settings.integrations.channelPrefix")}</span>
                      <input
                        name="channelPrefix"
                        defaultValue={data.teamsInstall.config.channelPrefix}
                        className="oi-field"
                        style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12 }}
                      />
                    </label>
                  </div>
                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={label}>{t("settings.integrations.announceChannel")}</span>
                    <select
                      name="announceChannel"
                      defaultValue={
                        data.teamsInstall.config.announceChannelId
                          ? `${data.teamsInstall.config.announceChannelId}|${data.teamsInstall.config.announceChannelName ?? ""}`
                          : ""
                      }
                      className="oi-field"
                      style={control}
                    >
                      <option value="">{t("settings.integrations.noAnnounceChannel")}</option>
                      {teamsChannels.map((ch) => (
                        <option key={ch.id} value={`${ch.id}|${ch.displayName}`}>
                          {ch.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div
                    style={{
                      background: "var(--sunk)",
                      borderRadius: 11,
                      padding: "11px 13px",
                      fontSize: 12,
                      color: "var(--ink-2)",
                      lineHeight: 1.5,
                    }}
                  >
                    {t("settings.integrations.teamsConfigNote")}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      borderTop: "1px solid var(--line-2)",
                      paddingTop: 14,
                    }}
                  >
                    <button
                      type="submit"
                      formAction={disconnectTeamsAction}
                      formNoValidate
                      className="oi-hover-dang"
                      style={{ ...ghostBtn, color: "var(--dang)" }}
                    >
                      {t("settings.integrations.disconnect")}
                    </button>
                    <span style={{ flex: 1 }} />
                    <button type="submit" data-testid="teams-config-save" style={brandBtn}>
                      {t("settings.integrations.nextStep")}
                    </button>
                  </div>
                </form>
              )}
              {teamsStep === 3 && data.teamsInstall && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
                    {t("settings.integrations.teamsTestText", {
                      channel:
                        data.teamsInstall.config.announceChannelName ??
                        t("settings.integrations.teamsGeneralChannel"),
                    })}
                  </div>
                  {q.test === "ok" && (
                    <div
                      role="status"
                      style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}
                    >
                      {t("settings.integrations.teamsTested")}
                    </div>
                  )}
                  {q.test === "failed" && (
                    <div role="alert" style={{ fontSize: 12.5, color: "var(--dang)" }}>
                      {t("settings.integrations.teamsTestFailed")}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <form action={testTeams}>
                      <button type="submit" data-testid="teams-test" style={brandBtn}>
                        {t("settings.integrations.teamsTestButton")}
                      </button>
                    </form>
                    <Link
                      href="/app/settings/integrations?connect=teams&step=2"
                      className="oi-hover"
                      style={ghostBtn}
                    >
                      {t("common.previous")}
                    </Link>
                    <span style={{ flex: 1 }} />
                    <Link href="/app/settings/integrations" className="oi-hover" style={ghostBtn}>
                      {t("common.close")}
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {docsConnect && manages && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim-dialog)",
            display: "grid",
            placeItems: "center",
            padding: 24,
            zIndex: 60,
          }}
        >
          <form
            action={saveDocs}
            data-testid="docs-form"
            role="dialog"
            className="oi-rise"
            style={{
              width: 540,
              maxWidth: "100%",
              background: "var(--panel)",
              borderRadius: 18,
              boxShadow: "var(--shadow-modal)",
            }}
          >
            <input type="hidden" name="kind" value={docsConnect} />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 20px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <div style={{ fontFamily: "var(--font-title)", fontSize: 16.5, fontWeight: 600 }}>
                {docsConnect === "confluence" ? "Confluence" : "Notion"}
              </div>
              {docsInstall && chip(t("settings.integrations.connected"), "ok")}
              <Link
                href="/app/settings/integrations"
                aria-label={t("common.close")}
                style={{
                  marginLeft: "auto",
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  display: "grid",
                  placeItems: "center",
                  color: "var(--ink-3)",
                  fontSize: 14,
                  textDecoration: "none",
                }}
              >
                ✕
              </Link>
            </div>
            <div
              style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}
            >
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
                {t(`settings.integrations.docsText.${docsConnect}`)}
              </div>
              {docsConnect === "confluence" && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={label}>{t("settings.integrations.docs.site")}</span>
                      <input
                        name="site"
                        required
                        placeholder="acme.atlassian.net"
                        defaultValue={docsCfg.site ?? ""}
                        className="oi-field"
                        style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12 }}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={label}>{t("settings.integrations.docs.spaceKey")}</span>
                      <input
                        name="spaceKey"
                        required
                        placeholder="OPS"
                        defaultValue={docsCfg.spaceKey ?? ""}
                        className="oi-field"
                        style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12 }}
                      />
                    </label>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={label}>{t("settings.integrations.tracker.email")}</span>
                      <input
                        name="email"
                        type="email"
                        required
                        defaultValue={docsCfg.email ?? ""}
                        className="oi-field"
                        style={control}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={label}>{t("settings.integrations.docs.parentPage")}</span>
                      <input
                        name="parentPageId"
                        defaultValue={docsCfg.parentPageId ?? ""}
                        className="oi-field"
                        style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12 }}
                      />
                    </label>
                  </div>
                </>
              )}
              {docsConnect === "notion" && (
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("settings.integrations.docs.notionParent")}</span>
                  <input
                    name="parentPageId"
                    required
                    placeholder="a1b2c3d4-…"
                    defaultValue={docsCfg.parentPageId ?? ""}
                    className="oi-field"
                    style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12 }}
                  />
                </label>
              )}
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t(`settings.integrations.docs.secret.${docsConnect}`)}</span>
                <input
                  name="secret"
                  type="password"
                  required
                  autoComplete="off"
                  placeholder={docsInstall ? "••••••••" : ""}
                  className="oi-field"
                  style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12 }}
                />
              </label>
              {q.error === "test" && (
                <div role="alert" style={{ fontSize: 12.5, color: "var(--dang)" }}>
                  {t("settings.integrations.trackerTestFailed")}
                  {q.detail ? ` — ${q.detail}` : ""}
                </div>
              )}
              {q.error === "invalid" && (
                <div role="alert" style={{ fontSize: 12.5, color: "var(--dang)" }}>
                  {t("settings.integrations.docsInvalid")}
                </div>
              )}
              <div
                style={{
                  background: "var(--sunk)",
                  borderRadius: 11,
                  padding: "11px 13px",
                  fontSize: 12,
                  color: "var(--ink-2)",
                  lineHeight: 1.5,
                }}
              >
                {t("settings.integrations.docsNote")}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "14px 20px",
                borderTop: "1px solid var(--line)",
              }}
            >
              {docsInstall && (
                <button
                  type="submit"
                  formAction={removeDocs}
                  formNoValidate
                  className="oi-hover-dang"
                  style={{ ...ghostBtn, color: "var(--dang)" }}
                >
                  {t("settings.integrations.disconnect")}
                </button>
              )}
              <span style={{ flex: 1 }} />
              <Link href="/app/settings/integrations" className="oi-hover" style={ghostBtn}>
                {t("common.cancel")}
              </Link>
              <button type="submit" data-testid="docs-save" style={brandBtn}>
                {docsInstall
                  ? t("settings.integrations.trackerReconnect")
                  : t("settings.integrations.trackerTestConnect")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
