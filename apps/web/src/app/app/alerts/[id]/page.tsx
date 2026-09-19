import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { alertNotes, services, withTenant } from "@openincident/db";
import { aiConfigured } from "@openincident/ai";
import { getT, type Translate } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
import { getAlert, type AlertDetail } from "@/lib/alerts";
import { relatedIncidents } from "@/lib/ai-capabilities";
import { phaseTone } from "@/lib/tones";
import { sharedRoute, sourceChoices } from "../sources/choices";
import { priorityChip } from "../tone";
import { Fold } from "../fold";
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

/** What one alert event says, in words — the vocabulary the first design already had. */
function eventText(t: Translate, e: AlertDetail["events"][number]): string {
  const p = e.payload as Record<string, unknown>;
  switch (e.kind) {
    case "triggered":
      return t("alerts.event.triggered", { priority: String(p.priority ?? "—") });
    case "routed": {
      if (p.warning === "path_unpublished") return t("alerts.event.pathUnpublished");
      if (!p.route) return t("alerts.event.unrouted");
      const esc = Array.isArray(p.escalation)
        ? (p.escalation as Array<{
            path: string | null;
            via: string | null;
            skipped: string | null;
          }>)
        : [];
      const paged = esc
        .filter((x) => x.path && !x.skipped)
        .map((x) => x.path)
        .join(", ");
      const skipped = esc.filter((x) => x.skipped).length;
      const missing = Array.isArray(p.missing) ? (p.missing as string[]) : [];
      return [
        t("alerts.event.routed", { route: String(p.route) }),
        paged
          ? t("alerts.event.routedPages", { paths: paged })
          : esc.length
            ? ""
            : t("alerts.event.routedNobody"),
        skipped ? t("alerts.event.routedSkipped", { count: skipped }) : "",
        missing.length ? t("alerts.event.routedMissing", { keys: missing.join(", ") }) : "",
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "escalated":
      return t("alerts.event.escalated", {
        members: Array.isArray(p.members) ? (p.members as string[]).join(", ") : "—",
      });
    case "incident_created":
      return t("alerts.event.incidentCreated", { number: `INC-${String(p.number)}` });
    case "incident_linked":
      return t("alerts.event.incidentLinked", { number: `INC-${String(p.number)}` });
    case "grouped":
      return t("alerts.event.grouped", { title: String(p.title ?? p.leaderTitle ?? "") });
    case "acknowledged":
      return t("alerts.event.acknowledged", {
        by: e.actorName ?? "—",
        channel: String(p.channel ?? "web"),
      });
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
 * and not another, and what the history says about alerts like it.
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

  const statusTone = firing
    ? acked
      ? { bg: "var(--ok-t)", ink: "var(--ok)", label: t("alt2.detail.status.acked") }
      : { bg: "var(--dang-t)", ink: "var(--dang)", label: t("alt2.detail.status.firing") }
    : { bg: "var(--ok-t)", ink: "var(--ok)", label: t("alt2.detail.status.resolved") };

  // The labels: the service first, then the rest of the attributes the
  // pipeline bound, minus the bookkeeping keys nobody wants on a chip.
  const hidden = new Set(["service", "service_id", "team_id", "priority", "source", "source_name"]);
  const labels = Object.entries(a.attributes).filter(([k, v]) => !hidden.has(k) && v);
  const teamFromOwner = Boolean(a.attributes.team_id && a.attributes.service);

  // The timeline: what the pipeline recorded and what people wrote, in order.
  const entries = [
    ...alert.events.map((e) => ({
      key: e.id,
      at: e.occurredAt,
      ink: eventInk(e.kind),
      text: eventText(t, e),
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

  // "Why this path": read back from the routing decision the ingest stored.
  const routed = alert.events.find((e) => e.kind === "routed")?.payload as
    Record<string, unknown> | undefined;
  const decided = Array.isArray(routed?.escalation)
    ? (routed!.escalation as Array<{
        path: string | null;
        via: string | null;
        skipped: string | null;
      }>)
    : [];
  const taken = decided.find((d) => d.path && !d.skipped) ?? null;
  const blocked = decided.find((d) => d.skipped) ?? null;
  // Who decided: a rule if the alert points at anything but the shared one,
  // the source's own three choices otherwise.
  const byRule = Boolean(alert.route && alert.route.id !== extra.governing.shared?.id);
  const ownRoute = !byRule && extra.governing.choices.own;

  // Atlas: only when the instance has a provider — otherwise the card says so.
  const atlas = aiConfigured()
    ? await relatedIncidents(tenant.id, { id: a.id, name: a.title, summary: null }, 1)
    : null;
  const similar = atlas?.items[0] ?? null;

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
                when: t.fmt.time(a.lastAt),
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
              className="oi-hover"
              style={{ ...action, fontWeight: 600 }}
            >
              {alert.incident
                ? t("alt2.detail.openIncident", { number: alert.incident.number })
                : t("alt2.detail.createIncident")}
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
                data-testid={e.note ? "alert-note" : undefined}
                style={{
                  display: "grid",
                  gridTemplateColumns: "48px 14px minmax(0,1fr) auto",
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
                  {t.fmt.time(e.at)}
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
                style={{ display: "flex", gap: 8, padding: "10px 16px", alignItems: "flex-start" }}
              >
                <input type="hidden" name="id" value={a.id} />
                <textarea
                  name="body"
                  required
                  rows={1}
                  maxLength={4000}
                  placeholder={t("alt2.detail.notePlaceholder")}
                  className="oi-field"
                  style={{
                    flex: 1,
                    border: "1px solid var(--line)",
                    borderRadius: 9,
                    padding: "7px 10px",
                    fontSize: 12.5,
                    background: "var(--panel)",
                    resize: "vertical",
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                />
                <button
                  type="submit"
                  className="oi-hover"
                  style={{ ...action, height: 32, fontSize: 12.5, fontWeight: 600 }}
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
                border: "1.5px solid color-mix(in srgb, var(--dang) 40%, transparent)",
                borderRadius: "var(--radius-card)",
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  className="oi-pulse"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "var(--dang)",
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
              </div>
              {esc.nextTickAt && (
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
                  {(() => {
                    const [before, after] = t.parts(
                      esc.isLast ? "alt2.detail.lastLevelIn" : "alt2.detail.nextLevelIn",
                      "timer",
                    );
                    return (
                      <>
                        {before}
                        <Countdown until={esc.nextTickAt.toISOString()} />
                        {after}
                      </>
                    );
                  })()}
                </div>
              )}
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
                border: "1px solid color-mix(in srgb, var(--ok) 30%, transparent)",
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
                {t("alt2.detail.ackedBy", {
                  name: alert.ackedByName ?? esc?.ackedByName ?? "—",
                  when: a.ackedAt ? t.fmt.relative(a.ackedAt) : "",
                })}
              </div>
              {acts && firing && (
                <form action={unacknowledgeAlert} style={{ marginTop: 4 }}>
                  <input type="hidden" name="id" value={a.id} />
                  <button
                    type="submit"
                    className="oi-hover"
                    style={{
                      width: "100%",
                      height: 30,
                      border: "1px solid var(--line)",
                      borderRadius: 9,
                      background: "var(--panel)",
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {t("alt2.detail.unack")}
                  </button>
                </form>
              )}
            </div>
          )}

          <div
            style={{
              ...card,
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={eyebrow}>{t("alt2.detail.why")}</div>
            <div style={{ fontSize: 13, lineHeight: 1.55 }}>
              {ownRoute
                ? t("alt2.detail.whySource", { source: alert.source.name })
                : alert.route
                  ? t("alt2.detail.whyRule", {
                      rule: alert.route.name,
                      source: alert.source.name,
                    })
                  : t("alt2.detail.whyNoRoute")}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--ink-2)" }}>
              {taken
                ? taken.via
                  ? t("alt2.detail.whyPagedVia", { path: taken.path!, via: taken.via })
                  : t("alt2.detail.whyPaged", { path: taken.path! })
                : blocked?.skipped === "unpublished"
                  ? t("alt2.detail.whyUnpublished", { path: blocked.path ?? "—" })
                  : blocked
                    ? t("alt2.detail.whyUnresolved")
                    : t("alt2.detail.whyNobody")}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--ink-2)" }}>
              {alert.incident
                ? t("alt2.detail.whyIncident", { number: alert.incident.number })
                : t("alt2.detail.whyNoIncident")}
            </div>
            <Link
              href="/app/settings/alert-routes"
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
                  {t("alt2.detail.atlasSimilar", {
                    number: similar.number,
                    name: similar.name,
                  })}
                </div>
                <Link
                  href={`/app/incidents/${similar.number}`}
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
                  {t("alt2.detail.atlasFrom", {
                    number: similar.number,
                    when: t.fmt.dateCompact(similar.declaredAt),
                  })}
                  <span style={{ color: phaseTone(similar.phase).ink, fontWeight: 600 }}>
                    {t(`incident.phase.${similar.phase}`)}
                  </span>
                </Link>
                <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
                  {t(
                    atlas.method === "embeddings"
                      ? "alt2.detail.atlasByMeaning"
                      : "alt2.detail.atlasByTitle",
                  )}
                </div>
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
