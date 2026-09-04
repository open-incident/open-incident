import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { withTenant, incidentChannels, statusPages, statusPageIncidents } from "@openincident/db";
import { getT } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
import { getIncident } from "@/lib/incidents";
import { severityInk } from "@/lib/tones";
import { StatusPill } from "../status-pill";
import { FollowUpRowView } from "../follow-up-row";
import { Timeline } from "./timeline";
import { SidePanel } from "./side-panel";
import { IncidentAlerts } from "./incident-alerts";
import { IncidentChat } from "./incident-chat";
import { IncidentStatusPage } from "./incident-status-page";
import { EscalateDialog } from "./escalate-dialog";
import { listPaths } from "@/lib/oncall";
import { PostIncident } from "./post-incident";
import { UpdateDialog } from "./update-dialog";
import { AddFollowUp } from "./add-follow-up";
import { AiPanel } from "./ai-panel";
import { SuggestFollowUps } from "./suggest-follow-ups";
import { aiAllowance } from "@/lib/ai-capabilities";
import { connectedTrackers } from "@/lib/trackers";
import { connectedDocs } from "@/lib/docs";

type Tab = "timeline" | "follow-ups" | "post-incident";

/**
 * IN-02 — the incident. Header (status pill, severity in mono, title, the
 * primary action, the position among open incidents), the identity line, three
 * tabs; then the timeline with its four metric tiles on the left and the
 * details panel on the right.
 *
 * "Escalate" opens the path picker with a preview of who will be paged; the
 * escalation engine then pages them for real.
 */
export default async function IncidentPage({
  params,
  searchParams,
}: {
  params: Promise<{ number: string }>;
  searchParams: Promise<{ tab?: string; update?: string; publish?: string; exportError?: string }>;
}) {
  const { tenant, member, workspace } = await requireMember();
  const t = await getT();
  const { number: raw } = await params;
  const { tab: rawTab, update, publish, exportError } = await searchParams;
  const number = Number(raw);
  if (!Number.isInteger(number) || number <= 0) notFound();
  const tab: Tab = rawTab === "follow-ups" || rawTab === "post-incident" ? rawTab : "timeline";
  if (rawTab && rawTab !== tab) redirect(`/app/incidents/${number}`);

  const inc = await withTenant(tenant.id, (tx) => getIncident(tx, tenant.id, number));
  const paths = await withTenant(tenant.id, (tx) => listPaths(tx, tenant.id));
  // The status page option of the update dialog: offered when the severity meets
  // the page's threshold or the incident is already published there.
  const statusPageOpt = inc
    ? await withTenant(tenant.id, async (tx) => {
        const [page] = await tx
          .select()
          .from(statusPages)
          .where(eq(statusPages.tenantId, tenant.id))
          .limit(1);
        if (!page) return null;
        const [pub] = await tx
          .select({ id: statusPageIncidents.id })
          .from(statusPageIncidents)
          .where(eq(statusPageIncidents.incidentId, inc.row.id));
        const eligible =
          inc.row.severityRank !== null && inc.row.severityRank <= page.minSeverityRank;
        if (!pub && !eligible) return null;
        return {
          name: page.name,
          published: Boolean(pub),
          checked: Boolean(pub) || publish === "1",
        };
      })
    : null;
  const trackers = inc ? await withTenant(tenant.id, (tx) => connectedTrackers(tx, tenant.id)) : [];
  const docs = inc ? await withTenant(tenant.id, (tx) => connectedDocs(tx, tenant.id)) : [];
  const aiUpdate = inc ? (await aiAllowance(tenant.id, "update_draft")).ok : false;
  const aiFollowUps = inc ? (await aiAllowance(tenant.id, "follow_ups")).ok : false;
  const aiPostMortem = inc ? (await aiAllowance(tenant.id, "post_mortem")).ok : false;
  const slackChannel = inc
    ? (
        await withTenant(tenant.id, (tx) =>
          tx
            .select({ name: incidentChannels.channelName })
            .from(incidentChannels)
            .where(
              and(eq(incidentChannels.incidentId, inc.row.id), eq(incidentChannels.kind, "slack")),
            ),
        )
      )[0]
    : undefined;
  if (!inc) notFound();
  const acts = canRespond(member) && inc.row.phase !== "closed";
  const openFu = inc.followUps.filter((f) => f.status === "open").length;

  const metrics: Array<[string, string]> = [
    [t("incident.metric.detected"), t.fmt.dateTime(inc.row.declaredAt, t.timeZone)],
    [
      t("incident.metric.acknowledged"),
      inc.acknowledgedAt
        ? `${t.fmt.time(inc.acknowledgedAt, t.timeZone)} · ${t("incident.metric.tta", { duration: t.fmt.duration((inc.acknowledgedAt.getTime() - inc.row.declaredAt.getTime()) / 60_000) })}`
        : "—",
    ],
    inc.row.resolvedAt
      ? [
          t("incident.metric.resolved"),
          `${t.fmt.time(inc.row.resolvedAt, t.timeZone)} · ${t("incident.metric.ttr", { duration: t.fmt.duration((inc.row.resolvedAt.getTime() - inc.row.declaredAt.getTime()) / 60_000) })}`,
        ]
      : [t("incident.metric.status"), inc.row.statusName ?? t(`incident.phase.${inc.row.phase}`)],
    inc.row.resolvedAt
      ? [
          t("incident.metric.followUps"),
          inc.followUps.length
            ? t("incident.metric.followUpsValue", { count: inc.followUps.length, open: openFu })
            : "—",
        ]
      : [
          t("incident.metric.duration"),
          t("incident.metric.ongoing", {
            duration: t.fmt.duration((Date.now() - inc.row.declaredAt.getTime()) / 60_000),
          }),
        ],
  ];

  const declared = t.fmt.dateTime(inc.row.declaredAt, t.timeZone);
  const identity = [
    inc.row.creatorName
      ? t("incidents.card.declaredBy", { when: declared, actor: inc.row.creatorName })
      : t("incidents.card.declaredFrom", {
          when: declared,
          source: t(
            `timeline.source.${inc.row.source === "api" ? "api" : inc.row.source === "alert" ? "alert" : "web"}`,
          ),
        }),
    inc.row.region,
  ].filter(Boolean);

  const tabHref = (tb: Tab) =>
    tb === "timeline" ? `/app/incidents/${number}` : `/app/incidents/${number}?tab=${tb}`;
  const tabs: Array<[Tab, string]> = [
    ["timeline", t("incident.tab.timeline")],
    [
      "follow-ups",
      inc.followUps.length
        ? t("incident.tab.followUpsCount", { count: inc.followUps.length })
        : t("incident.tab.followUps"),
    ],
    ["post-incident", t("incident.tab.postIncident")],
  ];

  return (
    <section
      style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      <header
        style={{
          flex: "none",
          background: "var(--panel)",
          borderBottom: "1px solid var(--line)",
          padding: "14px 22px 0",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <StatusPill row={inc.row} size="lg" />
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              fontWeight: 500,
              color: severityInk(inc.row.severityRank),
            }}
          >
            {inc.row.severityName ?? "—"}
          </span>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-title)",
              fontSize: 21,
              fontWeight: 600,
              letterSpacing: "-.015em",
              minWidth: 0,
            }}
          >
            {inc.row.name}
          </h1>
          {inc.row.visibility === "private" && (
            <span
              style={{
                padding: "1px 8px",
                borderRadius: 999,
                background: "var(--viol-t)",
                color: "var(--viol)",
                fontSize: 10.5,
                fontWeight: 700,
              }}
            >
              {t("incident.private")}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {acts && inc.row.phase !== "triage" && (
              <UpdateDialog
                number={number}
                statuses={inc.statuses}
                severities={inc.severities}
                currentStatusId={
                  inc.statuses.find((s) => s.name === inc.row.statusName)?.id ?? null
                }
                currentSeverityName={inc.row.severityName}
                openInitially={update === "1"}
                slackChannel={slackChannel?.name ?? null}
                statusPage={statusPageOpt}
                aiDraft={aiUpdate}
              />
            )}
            {acts && inc.row.phase !== "closed" && inc.row.phase !== "triage" && (
              <EscalateDialog
                number={number}
                paths={paths
                  .filter((p) => p.current)
                  .map((p) => ({
                    id: p.path.id,
                    name: p.path.name,
                    levels: p.current!.graph.nodes.filter((n) => n.kind === "level").length,
                  }))}
              />
            )}
            {inc.row.phase === "triage" && acts && (
              <Link
                href="/app/incidents?view=triage"
                className="oi-hover-edge-fill"
                style={{
                  height: 36,
                  padding: "0 14px",
                  border: "1px solid var(--line)",
                  borderRadius: 9,
                  background: "var(--panel)",
                  display: "flex",
                  alignItems: "center",
                  fontSize: 13.5,
                  fontWeight: 500,
                  color: "inherit",
                  textDecoration: "none",
                }}
              >
                {t("incident.goTriage")}
              </Link>
            )}
            {inc.position.total > 0 && (
              <nav
                aria-label={t("incident.positionLabel")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  border: "1px solid var(--line)",
                  borderRadius: 9,
                  overflow: "hidden",
                }}
              >
                <Link
                  aria-disabled={!inc.position.prev}
                  href={inc.position.prev ? `/app/incidents/${inc.position.prev}` : "#"}
                  className="oi-hover"
                  style={{
                    height: 36,
                    width: 32,
                    display: "grid",
                    placeItems: "center",
                    color: inc.position.prev ? "var(--ink-2)" : "var(--ink-3)",
                    textDecoration: "none",
                    pointerEvents: inc.position.prev ? "auto" : "none",
                  }}
                >
                  ‹
                </Link>
                <span
                  style={{
                    padding: "0 8px",
                    fontSize: 12,
                    color: "var(--ink-3)",
                    fontVariantNumeric: "tabular-nums",
                    borderLeft: "1px solid var(--line-2)",
                    borderRight: "1px solid var(--line-2)",
                    height: 36,
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  {inc.position.index} / {inc.position.total}
                </span>
                <Link
                  aria-disabled={!inc.position.next}
                  href={inc.position.next ? `/app/incidents/${inc.position.next}` : "#"}
                  className="oi-hover"
                  style={{
                    height: 36,
                    width: 32,
                    display: "grid",
                    placeItems: "center",
                    color: inc.position.next ? "var(--ink-2)" : "var(--ink-3)",
                    textDecoration: "none",
                    pointerEvents: inc.position.next ? "auto" : "none",
                  }}
                >
                  ›
                </Link>
              </nav>
            )}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 13,
            color: "var(--ink-3)",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>INC-{number}</span>
          {identity.map((part, i) => (
            <span key={i} style={{ display: "contents" }}>
              <span>·</span>
              <span>{part}</span>
            </span>
          ))}
          {inc.row.serviceName && (
            <>
              <span>·</span>
              <Link
                href={`/app/catalog?entry=${encodeURIComponent(inc.row.serviceName)}`}
                className="oi-link"
                style={{ fontWeight: 500 }}
              >
                {inc.row.serviceName}
              </Link>
            </>
          )}
        </div>
        <nav aria-label={t("incident.tabsLabel")} style={{ display: "flex", gap: 2 }}>
          {tabs.map(([tb, label]) => {
            const active = tb === tab;
            return (
              <Link
                key={tb}
                href={tabHref(tb)}
                aria-current={active ? "page" : undefined}
                style={{
                  padding: "10px 15px",
                  fontSize: 13.5,
                  fontWeight: active ? 600 : 500,
                  color: active ? "var(--ink)" : "var(--ink-3)",
                  borderBottom: `2px solid ${active ? "var(--brand)" : "transparent"}`,
                  marginBottom: -1,
                  textDecoration: "none",
                }}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: "20px 22px 28px" }}>
          {tab === "timeline" && (
            <div
              className="oi-rise"
              style={{ maxWidth: 860, display: "flex", flexDirection: "column", gap: 14 }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                {metrics.map(([l, v]) => (
                  <div
                    key={l}
                    style={{
                      background: "var(--panel)",
                      border: "1px solid var(--line)",
                      borderRadius: 13,
                      padding: "12px 15px",
                      boxShadow: "var(--shadow-card)",
                    }}
                  >
                    <div className="oi-eyebrow">{l}</div>
                    <div
                      style={{
                        fontFamily: "var(--font-title)",
                        fontSize: 16,
                        fontWeight: 600,
                        marginTop: 3,
                        letterSpacing: "-.01em",
                      }}
                    >
                      {v}
                    </div>
                  </div>
                ))}
              </div>
              <Timeline
                incidentId={inc.row.id}
                number={number}
                events={inc.events}
                canAct={acts}
                declaredAt={inc.row.declaredAt}
              />
            </div>
          )}
          {tab === "follow-ups" && (
            <div
              className="oi-rise"
              style={{ maxWidth: 760, display: "flex", flexDirection: "column", gap: 8 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
                  {inc.followUps.length === 0
                    ? t("incident.followUps.none")
                    : t("incident.followUps.summary", {
                        count: inc.followUps.length,
                        open: openFu,
                        done: inc.followUps.length - openFu,
                      })}
                </span>
                <span style={{ flex: 1 }} />
                {canRespond(member) && <AddFollowUp number={number} />}
              </div>
              {canRespond(member) && aiFollowUps && <SuggestFollowUps number={number} />}
              {inc.followUps.map((fu) => (
                <FollowUpRowView
                  key={fu.id}
                  row={fu}
                  canAct={canRespond(member)}
                  trackers={trackers}
                />
              ))}
              <div style={{ fontSize: 12.5, color: "var(--ink-3)", textWrap: "pretty" }}>
                {t("incident.followUps.exportNote")}
              </div>
            </div>
          )}
          {tab === "post-incident" && (
            <PostIncident
              inc={inc}
              number={number}
              canAct={canRespond(member)}
              postMortemTerm={workspace.postMortemTerm}
              aiAllowed={aiPostMortem}
              docs={docs}
              exportError={exportError ?? null}
            />
          )}
        </div>
        {tab === "timeline" && (
          <SidePanel
            inc={inc}
            number={number}
            canAct={acts}
            extra={
              <>
                <IncidentStatusPage
                  incidentId={inc.row.id}
                  number={number}
                  severityRank={inc.row.severityRank}
                  phase={inc.row.phase}
                  canAct={acts}
                />
                <IncidentChat incidentId={inc.row.id} number={number} canAct={acts} />
                <IncidentAlerts incidentId={inc.row.id} />
                <AiPanel inc={inc} tenantId={tenant.id} number={number} canAct={acts} />
              </>
            }
          />
        )}
      </div>
    </section>
  );
}
