import Link from "next/link";
import { redirect } from "next/navigation";
import { withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
import {
  countViews,
  followUpPolicy,
  listFollowUps,
  listIncidents,
  INCIDENT_VIEWS,
  type IncidentView,
} from "@/lib/incidents";
import { IncidentCard } from "./incident-card";
import { TriageCard } from "./triage-card";
import { FollowUpRowView } from "./follow-up-row";
import { connectedTrackers } from "@/lib/trackers";
import { liveAnnouncements } from "@/lib/announcements";
import { severityInk } from "@/lib/tones";

/**
 * IN-01 — the incidents list of the design: a 232 px rail of views on the left
 * (open · triage · mine · resolved · follow-ups, each with its count), the title
 * with its count chip, then one card per incident — avatar of the lead, number
 * in mono, title, the subtitle line, severity in mono, the status pill and the
 * last activity.
 *
 * Sort and filter menus are drawn by the design and not built here yet: the
 * list already sorts by last activity, and a menu that changes nothing is a
 * dead control, so neither is shown until it acts.
 */
export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { view: raw } = await searchParams;
  const view = (INCIDENT_VIEWS as string[]).includes(raw ?? "") ? (raw as IncidentView) : "open";
  if (raw && raw !== view) redirect("/app/incidents");

  const data = await withTenant(tenant.id, async (tx) => ({
    counts: await countViews(tx, tenant.id, member.id),
    rows: view === "follow-ups" ? [] : await listIncidents(tx, tenant.id, view, member.id),
    followUps: view === "follow-ups" ? await listFollowUps(tx, tenant.id) : [],
    policy: view === "follow-ups" ? await followUpPolicy(tx, tenant.id) : null,
    trackers: view === "follow-ups" ? await connectedTrackers(tx, tenant.id) : [],
    announcements: view === "open" ? await liveAnnouncements(tx, tenant.id) : [],
  }));

  const titles: Record<IncidentView, string> = {
    open: t("incidents.views.open"),
    triage: t("incidents.views.triage"),
    mine: t("incidents.views.mine"),
    resolved: t("incidents.views.resolved"),
    "follow-ups": t("incidents.views.followUps"),
  };
  const listCount = view === "follow-ups" ? data.followUps.length : data.rows.length;

  return (
    <>
      <aside
        aria-label={t("incidents.viewsLabel")}
        style={{
          width: 232,
          flex: "none",
          background: "var(--panel)",
          borderRight: "1px solid var(--line)",
          padding: "16px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          overflow: "auto",
        }}
      >
        <div className="oi-eyebrow" style={{ padding: "0 10px 8px" }}>
          {t("incidents.viewsLabel")}
        </div>
        {INCIDENT_VIEWS.map((v) => {
          const active = v === view;
          const hot = v === "triage" && data.counts.triage > 0;
          return (
            <Link
              key={v}
              href={v === "open" ? "/app/incidents" : `/app/incidents?view=${v}`}
              aria-current={active ? "page" : undefined}
              className={active ? undefined : "oi-hover"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "8px 10px",
                borderRadius: 9,
                background: active ? "var(--brand-t)" : "transparent",
                color: active ? "var(--brand)" : "var(--ink-2)",
                fontWeight: active ? 600 : 450,
                fontSize: 13.5,
                textDecoration: "none",
              }}
            >
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {titles[v]}
              </span>
              <span
                style={{
                  fontSize: 11.5,
                  color: hot ? "var(--wait)" : "var(--ink-3)",
                  fontWeight: hot ? 700 : 400,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {t.fmt.number(data.counts[v])}
              </span>
            </Link>
          );
        })}
      </aside>

      <section
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 20px",
            flex: "none",
          }}
        >
          <h1 className="oi-title" style={{ margin: 0 }}>
            {titles[view]}
          </h1>
          <span
            style={{
              padding: "2px 9px",
              borderRadius: 999,
              background: "var(--brand-t)",
              color: "var(--brand)",
              fontSize: 12,
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {t.fmt.number(listCount)}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
            {t("incidents.sortedByActivity")}
          </span>
        </div>

        {view === "triage" ? (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              padding: "0 20px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              maxWidth: 900,
            }}
          >
            <div style={{ fontSize: 13, color: "var(--ink-3)", padding: "2px 4px" }}>
              {t("incidents.triageIntro")}
            </div>
            {data.rows.map((row) => (
              <TriageCard key={row.id} row={row} canAct={canRespond(member)} />
            ))}
            {data.rows.length === 0 && (
              <div
                style={{
                  padding: 28,
                  border: "1.5px dashed var(--line)",
                  borderRadius: 14,
                  textAlign: "center",
                  color: "var(--ink-3)",
                  fontSize: 13.5,
                  background: "var(--panel)",
                }}
              >
                {t("incidents.triageEmpty")}
              </div>
            )}
          </div>
        ) : view === "follow-ups" ? (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              padding: "0 20px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {data.policy?.p1Days && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: "var(--wait-t)",
                  border: "1px solid var(--note-b)",
                  borderRadius: 12,
                  padding: "10px 14px",
                  fontSize: 13,
                }}
              >
                <span
                  style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--wait)" }}
                />
                <span
                  dangerouslySetInnerHTML={{
                    __html: t("incidents.followUpPolicy", { count: data.policy.p1Days }).replace(
                      /^([^—]+—)/,
                      "<strong>$1</strong>",
                    ),
                  }}
                />
                {data.policy.overdue > 0 && (
                  <span style={{ color: "var(--wait)", fontWeight: 600 }}>
                    {t("incidents.followUpOverdue", { count: data.policy.overdue })}
                  </span>
                )}
              </div>
            )}
            {data.followUps.map((fu) => (
              <FollowUpRowView
                key={fu.id}
                row={fu}
                showIncident
                canAct={canRespond(member)}
                trackers={data.trackers}
              />
            ))}
            {data.followUps.length === 0 && (
              <div
                style={{
                  padding: 28,
                  border: "1.5px dashed var(--line)",
                  borderRadius: 14,
                  textAlign: "center",
                  color: "var(--ink-3)",
                  fontSize: 13.5,
                  background: "var(--panel)",
                }}
              >
                {t("incidents.followUpsEmpty")}
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              padding: "0 20px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {data.announcements.length > 0 && (
              <section
                aria-label={t("incidents.announcementsLabel")}
                style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 4 }}
              >
                {data.announcements.map((a) => (
                  <Link
                    key={a.id}
                    href={`/app/incidents/${a.incidentNumber}`}
                    data-testid="announcement"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      background: "var(--brand-t)",
                      border: "1px solid var(--brand-b)",
                      borderRadius: 12,
                      padding: "10px 14px",
                      fontSize: 13,
                      color: "inherit",
                      textDecoration: "none",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: ".08em",
                        color: "var(--brand)",
                        background: "var(--panel)",
                        borderRadius: 6,
                        padding: "2px 7px",
                        flex: "none",
                      }}
                    >
                      {t("incidents.announcementTag")}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11.5,
                        color: severityInk(
                          a.severity === "SEV1" ? 0 : a.severity === "SEV2" ? 1 : 2,
                        ),
                        flex: "none",
                      }}
                    >
                      {a.severity ?? ""}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {a.body}
                    </span>
                    <span style={{ fontSize: 11.5, color: "var(--ink-3)", flex: "none" }}>
                      {t("incidents.announcementUpdated", { when: t.fmt.relative(a.updatedAt) })}
                    </span>
                  </Link>
                ))}
              </section>
            )}
            {data.rows.map((row) => (
              <IncidentCard key={row.id} row={row} />
            ))}
            {data.rows.length === 0 && (
              <div
                style={{
                  padding: 28,
                  border: "1.5px dashed var(--line)",
                  borderRadius: 14,
                  textAlign: "center",
                  color: "var(--ink-3)",
                  fontSize: 13.5,
                  background: "var(--panel)",
                }}
              >
                {t("incidents.empty")}
              </div>
            )}
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", padding: "6px 4px" }}>
              {t("incidents.footer", { slug: tenant.slug })}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
