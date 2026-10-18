import Link from "next/link";
import { and, asc, eq, isNull } from "drizzle-orm";
import { alertPriorities, alertSources, alerts, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import type { IncidentDetail } from "@/lib/incidents";
import { avatarTone, initials } from "@/lib/avatar";
import { priorityTone } from "@/lib/tones";
import { severityTone, statusTone } from "../tone";
import type { IncidentService } from "../services-of";
import { AssignRole } from "./assign-role";
import { SeverityPicker } from "./severity-picker";

export const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
  padding: "13px 15px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};
export const eyebrow: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};

/**
 * The right column of the timeline tab, in the design's order: the incident's
 * facts, its roles (and who the page reached), the services it is about with
 * their owner, the alerts behind it, the chat channels it runs in, what the
 * status page says and the follow-ups it has produced.
 */
export async function SidePanel({
  inc,
  number,
  canAct,
  tenantId,
  services,
  paged,
  channels,
  statusPage,
}: {
  inc: IncidentDetail;
  number: number;
  canAct: boolean;
  tenantId: string;
  services: IncidentService[];
  /** Who the escalation reached — rows of the roles card. */
  paged?: React.ReactNode;
  /** The CHANNELS card. */
  channels?: React.ReactNode;
  /** The status page card, rendered by the page so it can stay one query. */
  statusPage?: React.ReactNode;
}) {
  const t = await getT();
  const sev = severityTone(inc.row.severityRank);
  const attached = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: alerts.id,
        title: alerts.title,
        status: alerts.status,
        groupCount: alerts.groupCount,
        sourceName: alertSources.name,
        severityName: alertPriorities.name,
      })
      .from(alerts)
      .innerJoin(alertSources, eq(alertSources.id, alerts.sourceId))
      .leftJoin(alertPriorities, eq(alertPriorities.id, alerts.priorityId))
      .where(
        and(
          eq(alerts.tenantId, tenantId),
          eq(alerts.incidentId, inc.row.id),
          isNull(alerts.groupId),
        ),
      )
      .orderBy(asc(alerts.firstAt)),
  );
  const allResolved = attached.length > 0 && attached.every((a) => a.status === "resolved");
  const openFu = inc.followUps.filter((f) => f.status === "open");
  const tta =
    inc.acknowledgedAt &&
    t.fmt.duration((inc.acknowledgedAt.getTime() - inc.row.declaredAt.getTime()) / 60_000);
  const ttr =
    inc.row.resolvedAt &&
    t.fmt.duration((inc.row.resolvedAt.getTime() - inc.row.declaredAt.getTime()) / 60_000);
  const first = attached[0];
  const detectedBy =
    inc.row.source === "alert" && first
      ? [first.sourceName, first.severityName].filter(Boolean).join(" · ")
      : inc.row.source === "api"
        ? t("timeline.source.api")
        : inc.row.creatorName
          ? t("incv2.meta.declaredBy", { name: inc.row.creatorName })
          : t("timeline.source.web");
  const sevLabel = (name: string, description: string | null) =>
    `${name}${description ? ` — ${description.split(" — ")[0]?.toLowerCase()}` : ""}`;

  const meta: Array<[string, React.ReactNode, string]> = [
    [
      t("incident.field.severity"),
      canAct ? (
        <SeverityPicker
          number={number}
          current={inc.severities.find((s) => s.name === inc.row.severityName)?.id ?? ""}
          options={inc.severities.map((s) => ({
            id: s.id,
            label: sevLabel(s.name, s.description),
          }))}
          none={t("incident.update.noSeverity")}
          label={t("incident.field.severity")}
          color={sev.ink}
        />
      ) : (
        sevLabel(inc.row.severityName ?? "—", inc.severityDescription)
      ),
      sev.ink,
    ],
    [
      t("incident.field.status"),
      inc.row.phase === "active"
        ? (inc.row.statusName ?? t("incident.phase.active"))
        : t(`incident.phase.${inc.row.phase}`),
      statusTone(inc.row.phase, inc.row.status).ink,
    ],
    [t("incident.field.type"), inc.typeName, "var(--ink)"],
    ...(inc.row.mode !== "live"
      ? ([[t("incident.field.mode"), t(`incident.mode.${inc.row.mode}`), "var(--viol)"]] as Array<
          [string, string, string]
        >)
      : []),
    [t("inc2.meta.detectedBy"), detectedBy, "var(--ink)"],
    ...(tta ? ([[t("inc2.meta.tta"), tta, "var(--ink)"]] as Array<[string, string, string]>) : []),
    ...(ttr ? ([[t("inc2.meta.ttr"), ttr, "var(--ink)"]] as Array<[string, string, string]>) : []),
    ...(inc.customFields.length > 0
      ? ([
          [
            t("incv2.meta.labels"),
            inc.customFields.map((f) => `${f.key}:${f.value}`).join(" · "),
            "var(--ink-2)",
          ],
        ] as Array<[string, string, string]>)
      : []),
  ];

  return (
    <aside
      aria-label={t("incident.detailsLabel")}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        flex: "1 1 260px",
        maxWidth: 320,
        minWidth: 240,
      }}
    >
      <div style={card} data-testid="incident-facts">
        {meta.map(([k, v, ink], i) => (
          <div
            key={`${k}-${i}`}
            style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}
          >
            <span style={{ color: "var(--ink-3)", flex: "none" }}>{k}</span>
            <span style={{ fontWeight: 600, textAlign: "right", color: ink, minWidth: 0 }}>
              {v}
            </span>
          </div>
        ))}
      </div>

      <div style={{ ...card, gap: 9 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={eyebrow}>{t("incident.roles")}</span>
          <span style={{ flex: 1 }} />
          {canAct && <AssignRole number={number} roles={inc.roles} />}
        </div>
        {inc.roles
          .filter((r) => r.memberName || r.isLead)
          .map((r) => (
            <Person
              key={r.roleId}
              name={r.memberName}
              sub={r.roleName}
              fallback={t("incident.roleUnassigned")}
            />
          ))}
        {paged}
      </div>

      <div style={card}>
        <div style={eyebrow}>{t("inc2.card.services")}</div>
        {services.length === 0 && (
          <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
            {inc.row.serviceName ?? t("inc2.svc.none")}
          </div>
        )}
        {services.map((s) => (
          <Link
            key={s.id}
            href={`/app/services/${s.id}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--brand)",
              }}
            >
              {s.key}
            </span>
            {s.ownerTeamName ? (
              <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                {t("inc2.svc.owner", { team: s.ownerTeamName })}
              </span>
            ) : (
              <span style={{ fontSize: 11, color: "var(--wait)", fontWeight: 600 }}>
                {t("inc2.svc.noOwner")}
              </span>
            )}
          </Link>
        ))}
      </div>

      <div style={card}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={eyebrow}>
            {attached.length > 0
              ? t("inc2.card.alertGroups", { count: attached.length })
              : t("inc2.card.alerts")}
          </span>
          <span style={{ flex: 1 }} />
          {attached.length > 0 && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: allResolved ? "var(--ok)" : "var(--dang)",
              }}
            >
              {allResolved ? t("inc2.alerts.resolved") : t("inc2.alerts.firing")}
            </span>
          )}
        </div>
        {attached.length === 0 && (
          <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("inc2.alerts.none")}</div>
        )}
        {attached.map((a) => (
          <Link
            key={a.id}
            href={`/app/alerts/${a.id}`}
            data-testid="linked-alert"
            style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink)", textDecoration: "none" }}
          >
            {a.title}{" "}
            <span style={{ color: "var(--ink-3)" }}>
              · {a.sourceName}
              {a.groupCount > 1 ? ` · ${t("incv2.alerts.grouped", { count: a.groupCount })}` : ""}
            </span>
          </Link>
        ))}
      </div>

      {channels}

      {statusPage}

      <div style={card}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={eyebrow}>{t("inc2.card.followUps", { count: inc.followUps.length })}</span>
          <span style={{ flex: 1 }} />
          <Link
            href={`/app/incidents/${number}?tab=post-incident`}
            className="oi-link"
            style={{ fontSize: 11.5, fontWeight: 600, color: "var(--brand)" }}
          >
            {t("inc2.postMortemLink")}
          </Link>
        </div>
        {inc.followUps.length === 0 && (
          <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("inc2.followUps.none")}</div>
        )}
        {[...openFu, ...inc.followUps.filter((f) => f.status !== "open")].slice(0, 5).map((f) => {
          const done = f.status === "done";
          const prio = priorityTone(f.priorityName === "P1" ? 0 : f.priorityName === "P2" ? 1 : 2);
          return (
            <div
              key={f.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontSize: 12.5,
                color: done ? "var(--ink-3)" : "var(--ink)",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: done ? "var(--ok)" : "var(--wait)",
                  flex: "none",
                }}
              />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  textDecoration: done ? "line-through" : "none",
                }}
              >
                {f.title}
              </span>
              {!done && f.priorityName && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    background: prio.bg,
                    color: prio.ink,
                    borderRadius: 5,
                    padding: "1px 5px",
                  }}
                >
                  {f.priorityName}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/** A person of the roles card: the avatar, the name, what they are to this incident. */
export function Person({
  name,
  sub,
  fallback,
  subInk = "var(--ink-3)",
  testid,
}: {
  name: string | null;
  sub: string;
  fallback?: string;
  subInk?: string;
  testid?: string;
}) {
  const tone = name ? avatarTone(name) : { bg: "var(--sunk)", ink: "var(--ink-3)" };
  return (
    <div data-testid={testid} style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        aria-hidden
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: tone.bg,
          color: tone.ink,
          display: "grid",
          placeItems: "center",
          fontSize: 9,
          fontWeight: 700,
          flex: "none",
        }}
      >
        {name ? initials(name) : "?"}
      </span>
      <div style={{ lineHeight: 1.2, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: name ? "var(--ink)" : "var(--ink-3)",
          }}
        >
          {name ?? fallback}
        </div>
        <div style={{ fontSize: 11, color: subInk }}>{sub}</div>
      </div>
    </div>
  );
}
