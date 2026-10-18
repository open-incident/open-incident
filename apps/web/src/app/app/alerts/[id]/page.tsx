import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { alertNotes, services, withTenant } from "@openincident/db";
import { aiConfigured } from "@openincident/ai";
import { getT, type Translate } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
import { getAlert, type AlertDetail } from "@/lib/alerts";
import { relatedIncidents } from "@/lib/ai-capabilities";
import { AtlasAlertBanner } from "@/components/atlas/alert";
import { sharedRoute, sourceChoices } from "../sources/choices";
import { priorityChip } from "../tone";
import { Fold } from "../fold";
import { rich } from "../rich";
import { Countdown } from "./countdown";
import {
  addAlertNote,
  deleteAlertNote,
  acknowledgeAlert,
  resolveAlert,
  snoozeAlert,
  unacknowledgeAlert,
} from "../actions";

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};
const eyebrow: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".08em",
  color: "var(--ink-3)",
};
const action: React.CSSProperties = {
  height: 34,
  padding: "0 13px",
  border: "1px solid var(--line)",
  borderRadius: 9,
  background: "var(--panel)",
  display: "flex",
  alignItems: "center",
  fontSize: 13,
  cursor: "pointer",
  color: "inherit",
  textDecoration: "none",
};

/** The colour of a dot on the timeline — what kind of thing happened, not who did it. */
function eventInk(kind: string): string {
  if (kind === "triggered") return "var(--dang)";
  if (kind === "routed") return "var(--brand)";
  if (kind === "incident_created" || kind === "incident_linked") return "var(--wait)";
  if (kind === "acknowledged" || kind === "resolved") return "var(--ok)";
  if (kind === "note") return "var(--viol)";
  return "var(--ink-3)";
}

type Decision = { path: string | null; via: string | null; skipped: string | null };

/**
 * "auth-service → Platform → Platform primary", the trail the owner lookup
 * leaves, read back as words: who owns the service, and the policy paged.
 */
function ownerTrail(via: string | null): { service?: string; team: string } | null {
  if (!via) return null;
  const parts = via.split(" → ");
  if (parts.length === 3) return { service: parts[0]!, team: parts[1]! };
  if (parts.length === 2) return { team: parts[0]! };
  return null;
}

/** The escalation decisions an alert's routing recorded, in both payload shapes it was written in. */
function decisionsOf(p: Record<string, unknown>): Decision[] {
  if (Array.isArray(p.escalation)) return p.escalation as Decision[];
  // The first shape: one trail at the top level.
  if (typeof p.via === "string") {
    const parts = p.via.split(" → ");
    return [{ path: parts[parts.length - 1] ?? null, via: p.via, skipped: null }];
  }
  return [];
}

/** One taken decision, as the timeline and "why this path" say it. */
function pagingLine(t: Translate, d: Decision): string {
  const owner = ownerTrail(d.via);
  if (owner?.service)
    return t("alst.event.pagingOwner", {
      service: owner.service,
      team: owner.team,
      path: d.path ?? "—",
    });
  if (owner) return t("alst.event.pagingTeam", { team: owner.team, path: d.path ?? "—" });
  return t("alst.event.paging", { path: d.path ?? "—" });
}

/** What one alert event says, in words. */
function eventText(
  t: Translate,
  e: AlertDetail["events"][number],
  ctx: { rule: string | null; levelOf: Record<string, number>; window: number; source: string },
): string {
  const p = e.payload as Record<string, unknown>;
  switch (e.kind) {
    case "triggered":
      return t("alst.event.fired", { priority: String(p.priority ?? "—"), source: ctx.source });
    case "routed": {
      if (p.warning === "path_unpublished") return t("alerts.event.pathUnpublished");
      const taken = decisionsOf(p).filter((d) => d.path && !d.skipped);
      const paging = taken.length
        ? taken.map((d) => pagingLine(t, d)).join(" · ")
        : t("alst.event.pagesNobody");
      return ctx.rule ? t("alst.event.ruleMatched", { rule: ctx.rule, paging }) : paging;
    }
    case "escalated": {
      const who = Array.isArray(p.members) ? (p.members as string[]).join(", ") : "—";
      const level = typeof p.nodeId === "string" ? ctx.levelOf[p.nodeId] : undefined;
      const low = p.urgency === "low";
      if (level)
        return t(low ? "alst.event.levelLow" : "alst.event.levelHigh", { level, members: who });
      return t(low ? "alst.event.levelLowNoLevel" : "alst.event.levelHighNoLevel", {
        members: who,
      });
    }
    case "incident_created":
      return t("alst.event.incidentOpened", {
        number: String(p.number),
        phase: t(`incident.phase.${String(p.phase ?? "triage") as "triage"}`).toLowerCase(),
      });
    case "incident_linked":
      return t("alerts.event.incidentLinked", { number: `INC-${String(p.number)}` });
    case "grouped":
      return p.leaderId
        ? t("alst.event.joined", { title: String(p.leaderTitle ?? "") })
        : t("alst.event.grouped", { count: 1, window: t.fmt.duration(ctx.window) });
    case "acknowledged":
      return t("alst.event.acknowledged", { by: e.actorName ?? "—" });
    case "unacknowledged":
      return t("alerts.event.unacknowledged", { by: e.actorName ?? "—" });
    case "snoozed":
      return t("alerts.event.snoozed", { count: Number(p.minutes ?? 0) });
    case "resolved":
      return p.by === "member"
        ? t("alerts.event.resolvedBy", { by: e.actorName ?? "—" })
        : t("alerts.event.resolvedSource");
    case "deferred":
      return t("alerts.event.deferred", { count: Number(p.minutes ?? 0) });
    case "test_mode":
      return t("alerts.event.testMode");
    default:
      return e.kind;
  }
}

/**
 * One alert: its labels, everything that happened to it, the payload it came
 * in with — and, down the right, who is being paged right now, why this path
 * and not another, and what the history says about alerts like it. When Atlas
 * took the alert, a violet line under the title says what it is doing.
 */
export default async function AlertPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant, member } = await requireMember();
  const t = await getT();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const alert = await withTenant(tenant.id, (tx) => getAlert(tx, tenant.id, id));
  if (!alert) notFound();
  const a = alert.row;
  const extra = await withTenant(tenant.id, async (tx) => {
    const notes = await tx
      .select()
      .from(alertNotes)
      .where(eq(alertNotes.alertId, id))
      .orderBy(desc(alertNotes.createdAt));
    const [service] = a.attributes.service
      ? await tx
          .select({ id: services.id })
          .from(services)
          .where(
            and(
              eq(services.tenantId, tenant.id),
              sql`lower(${services.key}) = lower(${a.attributes.service})`,
            ),
          )
      : [];
    const governing = {
      shared: await sharedRoute(tx, tenant.id),
      choices: await sourceChoices(tx, tenant.id, a.sourceId),
    };
    return { notes, serviceId: service?.id ?? null, governing };
  });
  const acts = canRespond(member);
  const firing = a.status === "firing";
  const acked = Boolean(a.ackedAt);
  const chip = priorityChip(alert.priority?.rank ?? null);
  const esc = alert.escalation;
  const paging = Boolean(esc && esc.status === "pending" && !acked);
  const window = alert.route?.grouping?.windowMinutes ?? 5;

  const statusTone = firing
    ? acked
      ? { bg: "var(--ok-t)", ink: "var(--ok)", label: t("alt2.detail.status.acked") }
      : { bg: "var(--dang-t)", ink: "var(--dang)", label: t("alt2.detail.status.firing") }
    : { bg: "var(--ok-t)", ink: "var(--ok)", label: t("alt2.detail.status.resolved") };

  // The labels: the service first, then the rest of the attributes the
  // pipeline bound, minus the bookkeeping keys nobody wants on a chip.
  const hidden = new Set(["service", "service_id", "team_id", "priority", "source", "source_name"]);
  const labels = Object.entries(a.attributes).filter(([k, v]) => !hidden.has(k) && v);

  // "Why this path": read back from the routing decision the ingest stored.
  const routed = alert.events.find((e) => e.kind === "routed")?.payload as
    Record<string, unknown> | undefined;
  const decided = routed ? decisionsOf(routed) : [];
  const taken = decided.find((d) => d.path && !d.skipped) ?? null;
  const blocked = decided.find((d) => d.skipped) ?? null;
  const owner = ownerTrail(taken?.via ?? null);
  // Who decided: a rule if the alert points at anything but the shared one,
  // the source's own three choices otherwise.
  const byRule = Boolean(alert.route && alert.route.id !== extra.governing.shared?.id);
  const page = extra.governing.choices.page;
  const teamFromOwner = Boolean(owner?.service && labels.some(([k]) => k === "team"));

  // The timeline: what the pipeline recorded and what people wrote, in order.
  // A leader's "one more joined" lines fold into one: the design's "2 more
  // alerts grouped", at the time of the last.
  const ctx = {
    rule: byRule ? (alert.route?.name ?? null) : null,
    levelOf: esc?.levelOf ?? {},
    window,
    source: alert.source.name,
  };
  const joins = alert.events.filter((e) => e.kind === "grouped" && !e.payload.leaderId);
  const lastJoin = joins[joins.length - 1];
  const entries = [
    ...alert.events
      .filter((e) => !(e.kind === "grouped" && !e.payload.leaderId && e !== lastJoin))
      .map((e) => ({
        key: e.id,
        at: e.occurredAt,
        ink: eventInk(e.kind),
        text:
          e === lastJoin
            ? t("alst.event.grouped", { count: joins.length, window: t.fmt.duration(window) })
            : eventText(t, e, ctx),
        note: null as null | (typeof extra.notes)[number],
      })),
    ...extra.notes.map((n) => ({
      key: n.id,
      at: n.createdAt,
      ink: eventInk("note"),
      text: t("alt2.detail.noteBy", { name: n.memberName, body: n.body }),
      note: n,
    })),
  ].sort((x, y) => x.at.getTime() - y.at.getTime());

  // Atlas: only when the instance has a provider — otherwise the card says so.
  // The alert's own incident is not "similar": it is the same one.
  const atlas = aiConfigured()
    ? await relatedIncidents(tenant.id, { id: a.id, name: a.title, summary: null }, 4)
    : null;
  const similar = atlas?.items.find((x) => x.number !== alert.incident?.number) ?? null;

  const whySentence = (() => {
    if (!alert.route && !extra.governing.choices.own) return <>{t("alt2.detail.whyNoRoute")}</>;
    const pagedPart = taken
      ? owner?.service
        ? rich(
            t,
            "alst.why.owner",
            { service: owner.service, team: owner.team, path: taken.path ?? "—" },
            ["service", "team"],
          )
        : rich(t, "alst.why.path", { path: taken.path ?? "—" }, [])
      : blocked?.skipped === "unpublished"
        ? [t("alt2.detail.whyUnpublished", { path: blocked.path ?? "—" })]
        : [t("alt2.detail.whyNobody")];
    if (byRule)
      return (
        <>
          {rich(t, "alst.why.rule", { rule: alert.route!.name, source: alert.source.name })}{" "}
          {pagedPart}
        </>
      );
    const says =
      page.kind === "owner"
        ? t("alst.why.saysOwner")
        : page.kind === "nobody"
          ? t("alst.why.saysNobody")
          : t("alst.why.saysPath", { name: page.name });
    return (
      <>
        {rich(t, "alst.why.source", { source: alert.source.name, says }, ["source"])} {pagedPart}{" "}
        {t("alst.why.noRule")}
      </>
    );
  })();

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
        href="/app/alerts"
        className="oi-link"
        style={{ fontSize: 12.5, color: "var(--ink-3)", width: "fit-content" }}
      >
        {t("alt2.detail.back")}
      </Link>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 6,
                padding: "2px 8px",
                background: chip.bg,
                color: chip.ink,
              }}
            >
              {alert.priority?.name ?? "—"}
            </span>
            <span
              data-testid="alert-status"
              style={{
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 999,
                padding: "2px 9px",
                background: statusTone.bg,
                color: statusTone.ink,
              }}
            >
              {statusTone.label}
            </span>
            {a.testMode && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "var(--viol)",
                  background: "var(--viol-t)",
                  borderRadius: 5,
                  padding: "1px 6px",
                }}
              >
                {t("alt2.list.test")}
              </span>
            )}
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              {t("alt2.detail.meta", {
                source: alert.source.name,
                count: a.groupCount,
                when: t.fmt.time(a.lastAt, t.timeZone),
              })}
            </span>
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--title)",
              fontSize: 21,
              fontWeight: 600,
              letterSpacing: "-.015em",
            }}
          >
            {a.title}
          </h1>
          <AtlasAlertBanner tenantId={tenant.id} alertId={a.id} incidentId={a.incidentId} />
        </div>
        <div style={{ display: "flex", gap: 8, flex: "none", flexWrap: "wrap" }}>
          {acts && firing && !acked && (
            <form action={acknowledgeAlert}>
              <input type="hidden" name="id" value={a.id} />
              <button
                type="submit"
                data-testid="alert-ack"
                className="oi-hover-brand-2"
                style={{
                  ...action,
                  padding: "0 15px",
                  border: 0,
                  background: "var(--brand)",
                  color: "var(--on-brand)",
                  fontWeight: 600,
                }}
              >
                {t("alt2.detail.ack")}
              </button>
            </form>
          )}
          {(alert.incident || acts) && (
            <Link
              href={
                alert.incident
                  ? `/app/incidents/${alert.incident.number}`
                  : `/app/incidents/new?alert=${a.id}`
              }
              data-testid="alert-incident"
              title={
                alert.incident
                  ? t("alst.detail.openIncidentTitle", { number: alert.incident.number })
                  : undefined
              }
              className="oi-hover"
              style={{ ...action, fontWeight: 600 }}
            >
              {t("alst.detail.openIncident")}
            </Link>
          )}
          {acts && firing && (
            <>
              <form action={snoozeAlert}>
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="minutes" value="60" />
                <button type="submit" className="oi-hover" style={action}>
                  {t("alt2.detail.mute")}
                </button>
              </form>
              <form action={resolveAlert}>
                <input type="hidden" name="id" value={a.id} />
                <button
                  type="submit"
                  data-testid="alert-resolve"
                  className="oi-hover-ok"
                  style={{ ...action, color: "var(--ok)", fontWeight: 600 }}
                >
                  {t("alt2.detail.resolve")}
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 310px",
          gap: 14,
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div
            style={{
              ...card,
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={eyebrow}>{t("alt2.detail.labels")}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {a.attributes.service &&
                (extra.serviceId ? (
                  <Link
                    href={`/app/services/${extra.serviceId}`}
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                      background: "var(--brand-t)",
                      color: "var(--brand)",
                      border: "1px solid var(--brand-b)",
                      borderRadius: 6,
                      padding: "3px 8px",
                      textDecoration: "none",
                    }}
                  >
                    service:{a.attributes.service}
                  </Link>
                ) : (
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                      background: "var(--sunk)",
                      borderRadius: 6,
                      padding: "3px 8px",
                    }}
                  >
                    service:{a.attributes.service}
                  </span>
                ))}
              {labels.map(([k, v]) => (
                <span
                  key={k}
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11.5,
                    background: "var(--sunk)",
                    borderRadius: 6,
                    padding: "3px 8px",
                  }}
                >
                  {k}:{v}
                </span>
              ))}
              {!a.attributes.service && labels.length === 0 && (
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {t("alt2.detail.labelsNone")}
                </span>
              )}
            </div>
            {teamFromOwner && (
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {t("alt2.detail.labelsOwner")}
              </div>
            )}
          </div>

          <div style={{ ...card, overflow: "hidden" }} data-testid="alert-notes">
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--line)",
                fontSize: 13.5,
                fontWeight: 600,
              }}
            >
              {t("alt2.detail.timeline")}
            </div>
            {entries.map((e) => (
              <div
                key={e.key}
                data-testid={e.note ? "alert-note" : "alert-event"}
                style={{
                  display: "grid",
                  gridTemplateColumns: e.note
                    ? "48px 14px minmax(0,1fr) auto"
                    : "48px 14px minmax(0,1fr)",
                  gap: 8,
                  padding: "9px 16px",
                  borderBottom: "1px solid var(--line-2)",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "var(--ink-3)",
                    paddingTop: 2,
                  }}
                >
                  {t.fmt.time(e.at, t.timeZone)}
                </span>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: e.ink,
                    marginTop: 5,
                  }}
                />
                <span style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                  {e.text}
                </span>
                {e.note && e.note.memberId === member.id && (
                  <form action={deleteAlertNote}>
                    <input type="hidden" name="id" value={e.note.id} />
                    <input type="hidden" name="alertId" value={a.id} />
                    <button
                      type="submit"
                      aria-label={t("common.delete")}
                      style={{
                        background: "none",
                        border: 0,
                        cursor: "pointer",
                        color: "var(--ink-3)",
                        fontSize: 12,
                      }}
                    >
                      ✕
                    </button>
                  </form>
                )}
              </div>
            ))}
            {acts && (
              <form
                action={addAlertNote}
                data-testid="alert-note-form"
                style={{ display: "flex", gap: 8, padding: "8px 16px", alignItems: "center" }}
              >
                <input type="hidden" name="id" value={a.id} />
                <input
                  name="body"
                  required
                  maxLength={4000}
                  placeholder={t("alt2.detail.notePlaceholder")}
                  aria-label={t("alt2.detail.notePlaceholder")}
                  style={{
                    flex: 1,
                    border: 0,
                    padding: "4px 0",
                    fontSize: 12.5,
                    background: "transparent",
                    fontFamily: "inherit",
                    outline: "none",
                    color: "inherit",
                  }}
                />
                <button
                  type="submit"
                  className="oi-link"
                  style={{
                    background: "none",
                    border: 0,
                    padding: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--brand)",
                    cursor: "pointer",
                  }}
                >
                  {t("alt2.detail.noteAdd")}
                </button>
              </form>
            )}
          </div>

          <Fold
            title={t("alt2.detail.payload")}
            showLabel={t("alt2.common.showRaw")}
            hideLabel={t("alt2.common.hide")}
            padding="12px 16px"
            testId="alert-payload"
          >
            <pre
              style={{
                margin: 0,
                padding: "14px 16px",
                borderTop: "1px solid var(--line)",
                background: "var(--sunk)",
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                lineHeight: 1.6,
                color: "var(--ink-2)",
                overflowX: "auto",
              }}
            >
              {JSON.stringify(a.payload, null, 2)}
            </pre>
          </Fold>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {paging && esc && (
            <div
              data-testid="escalation-card"
              style={{
                background: "var(--panel)",
                border: "1.5px solid rgba(192,52,43,.4)",
                borderRadius: "var(--radius-card)",
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "var(--dang)",
                    animation: "oi-pulse 1.6s infinite",
                  }}
                />
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>
                  {esc.levelMembers.length
                    ? t("alt2.detail.paging", { name: esc.levelMembers.join(", ") })
                    : t("alt2.detail.pagingNobody")}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
                {t(
                  esc.urgency === "high"
                    ? "alt2.detail.pagingDetailHigh"
                    : "alt2.detail.pagingDetailLow",
                  { path: esc.pathName, level: esc.level },
                )}
                {esc.nextTickAt &&
                  (() => {
                    const [before, after] = esc.isLast
                      ? t.parts("alt2.detail.lastLevelIn", "timer")
                      : esc.nextMembers?.length
                        ? t.parts("alst.detail.nextAfter", "timer", {
                            name: esc.nextMembers.join(", "),
                          })
                        : t.parts("alt2.detail.nextLevelIn", "timer");
                    return (
                      <>
                        {" "}
                        {before}
                        <Countdown until={esc.nextTickAt.toISOString()} />
                        {after}
                      </>
                    );
                  })()}
              </div>
              {acts && (
                <form action={acknowledgeAlert}>
                  <input type="hidden" name="id" value={a.id} />
                  <button
                    type="submit"
                    style={{
                      width: "100%",
                      height: 32,
                      borderRadius: 9,
                      background: "var(--dang)",
                      color: "var(--on-brand)",
                      border: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {esc.levelMembers.length === 1
                      ? t("alt2.detail.ackFor", { name: esc.levelMembers[0]! })
                      : t("alt2.detail.ack")}
                  </button>
                </form>
              )}
            </div>
          )}
          {acked && (
            <div
              data-testid="acked-card"
              style={{
                background: "var(--ok-t)",
                border: "1px solid rgba(14,122,88,.3)",
                borderRadius: "var(--radius-card)",
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ok)" }}>
                {t("alt2.detail.status.acked")}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                {a.ackedByMemberId === member.id
                  ? t("alst.detail.ackedByYou", {
                      when: a.ackedAt ? t.fmt.relative(a.ackedAt) : "",
                    })
                  : t("alt2.detail.ackedBy", {
                      name: alert.ackedByName ?? esc?.ackedByName ?? "—",
                      when: a.ackedAt ? t.fmt.relative(a.ackedAt) : "",
                    })}
                {acts && firing && (
                  <form action={unacknowledgeAlert} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={a.id} />{" "}
                    <button
                      type="submit"
                      data-testid="alert-unack"
                      className="oi-link"
                      style={{
                        background: "none",
                        border: 0,
                        padding: 0,
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "var(--ok)",
                        cursor: "pointer",
                      }}
                    >
                      {t("alst.detail.undo")}
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}

          <div
            data-testid="why-this-path"
            style={{
              ...card,
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={eyebrow}>{t("alt2.detail.why")}</div>
            <div style={{ fontSize: 13, lineHeight: 1.55 }}>{whySentence}</div>
            <Link
              href="/app/settings/rules"
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--brand)",
                textDecoration: "none",
              }}
            >
              {t("alt2.detail.addRule")}
            </Link>
          </div>

          <div
            style={{
              ...card,
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{
                ...eyebrow,
                color: "var(--viol)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              ✦ {t("alt2.detail.atlas")}
            </div>
            {!atlas ? (
              <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)" }}>
                {t("alt2.detail.atlasOff")}
              </div>
            ) : similar ? (
              <>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                  {rich(
                    t,
                    "alst.detail.atlasSimilar",
                    {
                      label: t("alst.detail.atlasSimilarLabel"),
                      number: similar.number,
                      month: similar.declaredAt.toLocaleDateString(t.locale.tag, {
                        month: "short",
                        timeZone: t.timeZone,
                      }),
                      name: similar.name,
                    },
                    ["label"],
                  )}
                </div>
                <Link
                  href={`/app/incidents/${similar.number}`}
                  data-testid="atlas-similar"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11,
                    color: "var(--ink-3)",
                    border: "1px solid var(--line)",
                    borderRadius: 7,
                    padding: "4px 8px",
                    width: "fit-content",
                    textDecoration: "none",
                  }}
                >
                  {t("alst.detail.atlasFrom", {
                    number: similar.number,
                    when: t.fmt.dateCompact(similar.declaredAt),
                  })}
                  <span style={{ color: "var(--brand)", fontWeight: 600 }}>
                    {t("alst.detail.atlasOpen")}
                  </span>
                </Link>
              </>
            ) : (
              <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)" }}>
                {t("alt2.detail.atlasNone")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
