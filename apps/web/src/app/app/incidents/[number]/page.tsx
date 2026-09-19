import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  alerts,
  incidentChannels,
  incidents,
  statusPageIncidents,
  statusPages,
  withTenant,
} from "@openincident/db";
import { getT } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
import { getIncident } from "@/lib/incidents";
import { listPaths } from "@/lib/oncall";
import { aiAllowance } from "@/lib/ai-capabilities";
import { investigationAccess } from "@/lib/investigations";
import { templateFor } from "@/lib/post-mortem";
import { connectedDocs } from "@/lib/docs";
import { connectedTrackers } from "@/lib/trackers";
import { severityTone, statusInk } from "../tone";
import { servicesOfIncidents } from "../services-of";
import { acceptTriage, declineTriage } from "../triage-actions";
import { Timeline } from "./timeline";
import { SidePanel } from "./side-panel";
import { IncidentEscalations } from "./incident-alerts";
import { IncidentChat } from "./incident-chat";
import { IncidentStatusPage } from "./incident-status-page";
import { EscalateDialog } from "./escalate-dialog";
import { UpdateDialog } from "./update-dialog";
import { AtlasTab } from "./atlas";
import { Investigation } from "./investigation";
import { ContextTab } from "./context";
import { PostIncident } from "./post-incident";

const TABS = ["timeline", "atlas", "rca", "context", "post-incident"] as const;
type Tab = (typeof TABS)[number];

/**
 * IN-02 — the incident. The identity line and its window, the four things a
 * responder does with it, then the five tabs of the design: the timeline with
 * the incident's facts beside it, what Atlas makes of it, the root cause
 * analysis, everything the workspace knows, and the post-incident document.
 */
export default async function IncidentPage({
  params,
  searchParams,
}: {
  params: Promise<{ number: string }>;
  searchParams: Promise<{
    tab?: string;
    update?: string;
    publish?: string;
    use?: string;
    exportError?: string;
  }>;
}) {
  const { tenant, member, workspace } = await requireMember();
  const t = await getT();
  const { number: raw } = await params;
  const { tab: rawTab, update, publish, use, exportError } = await searchParams;
  const number = Number(raw);
  if (!Number.isInteger(number) || number <= 0) notFound();
  // The first design's tab names still arrive from links and bookmarks.
  const alias: Record<string, Tab> = {
    investigation: "rca",
    "follow-ups": "post-incident",
  };
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? "")
    ? (rawTab as Tab)
    : (alias[rawTab ?? ""] ?? "timeline");

  const inc = await withTenant(tenant.id, (tx) => getIncident(tx, tenant.id, number));
  if (!inc) notFound();

  const data = await withTenant(tenant.id, async (tx) => {
    const [row] = await tx
      .select({ serviceId: incidents.serviceId })
      .from(incidents)
      .where(eq(incidents.id, inc.row.id));
    const [page] = await tx
      .select()
      .from(statusPages)
      .where(eq(statusPages.tenantId, tenant.id))
      .limit(1);
    const [published] = page
      ? await tx
          .select({ id: statusPageIncidents.id })
          .from(statusPageIncidents)
          .where(eq(statusPageIncidents.incidentId, inc.row.id))
      : [];
    const [alertCount] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(alerts)
      .where(and(eq(alerts.tenantId, tenant.id), eq(alerts.incidentId, inc.row.id)));
    const [chat] = await tx
      .select({ name: incidentChannels.channelName })
      .from(incidentChannels)
      .where(and(eq(incidentChannels.incidentId, inc.row.id), eq(incidentChannels.kind, "slack")));
    const [groups] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(alerts)
      .where(
        and(
          eq(alerts.tenantId, tenant.id),
          eq(alerts.incidentId, inc.row.id),
          isNull(alerts.groupId),
        ),
      );
    return {
      serviceId: row?.serviceId ?? null,
      services: (await servicesOfIncidents(tx, tenant.id, [inc.row.id])).get(inc.row.id) ?? [],
      page: page ?? null,
      published: Boolean(published),
      alerts: alertCount?.n ?? 0,
      alertGroups: groups?.n ?? 0,
      chatChannel: chat?.name ?? null,
      paths: await listPaths(tx, tenant.id),
    };
  });

  const acts = canRespond(member) && inc.row.phase !== "closed";
  const statusPageOpt =
    data.page &&
    (data.published ||
      (inc.row.severityRank !== null && inc.row.severityRank <= data.page.minSeverityRank))
      ? {
          name: data.page.name,
          published: data.published,
          checked: data.published || publish === "1",
        }
      : null;
  const aiUpdate = (await aiAllowance(tenant.id, "update_draft")).ok;
  const aiPostMortem = (await aiAllowance(tenant.id, "post_mortem")).ok;
  const rca = await investigationAccess(tenant);
  const sev = severityTone(inc.row.severityRank);
  const summaryForUpdate =
    use === "summary"
      ? await withTenant(tenant.id, async (tx) => {
          const [r] = await tx
            .select({ aiSummary: incidents.aiSummary })
            .from(incidents)
            .where(eq(incidents.id, inc.row.id));
          return r?.aiSummary ?? "";
        })
      : "";

  const end = inc.row.resolvedAt;
  const window = end
    ? t("inc2.window", {
        start: `${t.fmt.dateShort(inc.row.declaredAt)} · ${t.fmt.time(inc.row.declaredAt, t.timeZone)}`,
        end: t.fmt.time(end, t.timeZone),
        duration: t.fmt.duration((end.getTime() - inc.row.declaredAt.getTime()) / 60_000),
      })
    : t("inc2.ongoing", {
        start: `${t.fmt.dateShort(inc.row.declaredAt)} · ${t.fmt.time(inc.row.declaredAt, t.timeZone)}`,
        duration: t.fmt.duration((Date.now() - inc.row.declaredAt.getTime()) / 60_000),
      });

  const tabs: Array<[Tab, string, boolean]> = [
    ["timeline", t("inc2.dtab.timeline"), false],
    ["atlas", t("inc2.dtab.atlas"), true],
    ["rca", t("inc2.dtab.rca"), true],
    ["context", t("inc2.dtab.context"), true],
    ["post-incident", t("inc2.dtab.post"), false],
  ];

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
    >
      <Link
        href="/app/incidents"
        className="oi-link"
        style={{ fontSize: 12.5, color: "var(--ink-3)", width: "fit-content" }}
      >
        ‹ {t("inc2.back")}
      </Link>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            flex: 1,
            minWidth: 280,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--brand)",
                background: "var(--brand-t)",
                borderRadius: 6,
                padding: "2px 8px",
              }}
            >
              INC-{number}
            </span>
            {inc.row.severityName && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 999,
                  padding: "2px 9px",
                  background: sev.bg,
                  color: sev.ink,
                }}
              >
                {inc.row.severityName}
              </span>
            )}
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 999,
                padding: "2px 9px",
                background: "var(--sunk)",
                color: statusInk(inc.row.phase, inc.row.statusName),
              }}
            >
              {inc.row.phase === "active"
                ? (inc.row.statusName ?? t("incident.phase.active"))
                : t(`incident.phase.${inc.row.phase}`)}
            </span>
            {inc.row.visibility === "private" && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 999,
                  padding: "2px 9px",
                  background: "var(--viol-t)",
                  color: "var(--viol)",
                }}
              >
                {t("incident.private")}
              </span>
            )}
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{window}</span>
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--title)",
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-.015em",
            }}
          >
            {inc.row.name}
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8, flex: "none", flexWrap: "wrap" }}>
          {acts && inc.row.phase === "triage" && (
            <>
              <form action={acceptTriage} style={{ display: "contents" }}>
                <input type="hidden" name="number" value={number} />
                <button
                  type="submit"
                  data-testid="triage-accept"
                  className="oi-hover-brand-2"
                  style={{
                    height: 34,
                    padding: "0 15px",
                    borderRadius: 9,
                    border: 0,
                    background: "var(--brand)",
                    color: "var(--on-brand)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {t("incidents.triage.accept")}
                </button>
              </form>
              <details style={{ position: "relative" }}>
                <summary
                  style={{
                    height: 34,
                    padding: "0 13px",
                    border: "1px solid var(--line)",
                    borderRadius: 9,
                    background: "var(--panel)",
                    display: "flex",
                    alignItems: "center",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    listStyle: "none",
                  }}
                >
                  {t("incidents.triage.decline")}
                </summary>
                <form
                  action={declineTriage}
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "calc(100% + 4px)",
                    zIndex: 5,
                    width: 280,
                    background: "var(--panel)",
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    boxShadow: "var(--shadow-pop)",
                    padding: 10,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <input type="hidden" name="number" value={number} />
                  <input
                    name="reason"
                    required
                    maxLength={500}
                    placeholder={t("incidents.triage.reasonPlaceholder")}
                    className="oi-field"
                    style={{
                      height: 32,
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      padding: "0 10px",
                      fontSize: 12.5,
                      background: "var(--panel)",
                      outline: "none",
                    }}
                  />
                  <button
                    type="submit"
                    className="oi-hover-dang"
                    style={{
                      height: 30,
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      background: "var(--panel)",
                      color: "var(--dang)",
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {t("incidents.triage.decline")}
                  </button>
                </form>
              </details>
            </>
          )}
          {acts && inc.row.phase !== "triage" && (
            <UpdateDialog
              number={number}
              statuses={inc.statuses}
              severities={inc.severities}
              currentStatusId={inc.statuses.find((s) => s.name === inc.row.statusName)?.id ?? null}
              currentSeverityName={inc.row.severityName}
              openInitially={update === "1"}
              initialMessage={summaryForUpdate}
              resolved={Boolean(inc.row.resolvedAt)}
              slackChannel={data.chatChannel}
              statusPage={statusPageOpt}
              aiDraft={aiUpdate}
            />
          )}
          {acts && inc.row.phase === "active" && (
            <EscalateDialog
              number={number}
              paths={data.paths
                .filter((p) => p.current)
                .map((p) => ({
                  id: p.path.id,
                  name: p.path.name,
                  levels: p.current!.graph.nodes.filter((n) => n.kind === "level").length,
                }))}
            />
          )}
          {statusPageOpt && !statusPageOpt.published && acts && (
            <Link
              href={`/app/incidents/${number}?update=1&publish=1`}
              className="oi-hover-edge-fill"
              style={{
                height: 34,
                padding: "0 13px",
                border: "1px solid var(--line)",
                borderRadius: 9,
                background: "var(--panel)",
                display: "flex",
                alignItems: "center",
                fontSize: 13,
                fontWeight: 600,
                color: "inherit",
                textDecoration: "none",
              }}
            >
              {t("inc2.publish")}
            </Link>
          )}
        </div>
      </div>

      <nav
        aria-label={t("incident.tabsLabel")}
        style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--line)" }}
      >
        {tabs.map(([id, label, atlas]) => {
          const on = id === tab;
          return (
            <Link
              key={id}
              href={
                id === "timeline"
                  ? `/app/incidents/${number}`
                  : `/app/incidents/${number}?tab=${id}`
              }
              aria-current={on ? "page" : undefined}
              style={{
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 600,
                color: on ? "var(--brand)" : "var(--ink-3)",
                borderBottom: `2px solid ${on ? "var(--brand)" : "transparent"}`,
                marginBottom: -1,
                textDecoration: "none",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {label}
              {atlas && <span style={{ fontSize: 10, color: "var(--viol)" }}>✦</span>}
            </Link>
          );
        })}
      </nav>

      {tab === "timeline" && (
        <div
          className="oi-rise-fast"
          style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-start" }}
        >
          <Timeline
            incidentId={inc.row.id}
            number={number}
            events={inc.events}
            canAct={acts}
            declaredAt={inc.row.declaredAt}
          />
          <SidePanel
            inc={inc}
            number={number}
            canAct={acts}
            tenantId={tenant.id}
            services={data.services}
            statusPage={
              <IncidentStatusPage
                incidentId={inc.row.id}
                number={number}
                severityRank={inc.row.severityRank}
                phase={inc.row.phase}
                canAct={acts}
              />
            }
            extra={
              <>
                <IncidentEscalations incidentId={inc.row.id} />
                <IncidentChat incidentId={inc.row.id} number={number} canAct={acts} />
              </>
            }
          />
        </div>
      )}

      {tab === "atlas" && (
        <AtlasTab
          inc={inc}
          tenantId={tenant.id}
          number={number}
          canAct={canRespond(member)}
          alerts={data.alerts}
        />
      )}

      {tab === "rca" && (
        <Investigation
          tenantId={tenant.id}
          inc={inc}
          number={number}
          canAct={canRespond(member) && inc.row.phase !== "closed"}
          access={rca}
        />
      )}

      {tab === "context" && (
        <ContextTab
          inc={inc}
          tenantId={tenant.id}
          services={data.services}
          serviceId={data.serviceId}
        />
      )}

      {tab === "post-incident" && (
        <PostIncident
          inc={inc}
          number={number}
          canAct={canRespond(member)}
          tenantId={tenant.id}
          postMortemTerm={workspace.postMortemTerm}
          template={templateFor(workspace, t)}
          aiAllowed={aiPostMortem}
          docs={await withTenant(tenant.id, (tx) => connectedDocs(tx, tenant.id))}
          trackers={await withTenant(tenant.id, (tx) => connectedTrackers(tx, tenant.id))}
          exportError={exportError ?? null}
          slackChannel={data.chatChannel}
        />
      )}
    </div>
  );
}
