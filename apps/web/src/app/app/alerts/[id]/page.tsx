import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
import { getAlert } from "@/lib/alerts";
import { phaseTone, priorityTone } from "@/lib/tones";
import { Countdown } from "./countdown";
import { acknowledgeAlert, resolveAlert, snoozeAlert, unacknowledgeAlert } from "../actions";

/**
 * Alert detail: the header with its status, priority and the four actions,
 * the attributes bound to the catalog, the grouped alerts, the raw payload;
 * on the right the escalation card with its live timer, the route, the
 * incident and the history.
 */
export default async function AlertPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant, member } = await requireMember();
  const t = await getT();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const alert = await withTenant(tenant.id, (tx) => getAlert(tx, tenant.id, id));
  if (!alert) notFound();
  const acts = canRespond(member);
  const a = alert.row;
  const firing = a.status === "firing";
  const acked = Boolean(a.ackedAt);
  const pr = priorityTone(alert.priority?.rank ?? null);
  const esc = alert.escalation;
  const btn: React.CSSProperties = {
    height: 36,
    padding: "0 14px",
    border: "1px solid var(--line)",
    borderRadius: 9,
    background: "var(--panel)",
    display: "flex",
    alignItems: "center",
    fontSize: 13.5,
    fontWeight: 500,
    cursor: "pointer",
    color: "inherit",
    textDecoration: "none",
  };
  const attrs: Array<{ label: string; value: string; mono?: boolean; href?: string }> = [];
  if (a.attributes.service)
    attrs.push({
      label: t("alerts.attr.service"),
      value: a.attributes.service,
      mono: true,
      href: a.attributes.service_id
        ? `/app/catalog?type=service&entry=${a.attributes.service_id}`
        : undefined,
    });
  if (a.attributes.team)
    attrs.push({
      label: t("alerts.attr.team"),
      value: a.attributes.team,
      href: "/app/catalog?type=team",
    });
  if (a.attributes.environment)
    attrs.push({ label: t("alerts.attr.environment"), value: a.attributes.environment });
  attrs.push({ label: t("alerts.attr.priority"), value: alert.priority?.name ?? "—" });
  if (a.attributes.region)
    attrs.push({ label: t("alerts.attr.region"), value: a.attributes.region, mono: true });
  attrs.push({ label: t("alerts.attr.dedupKey"), value: a.dedupKey, mono: true });
  for (const [k, v] of Object.entries(a.attributes)) {
    if (
      [
        "service",
        "service_id",
        "team",
        "environment",
        "priority",
        "region",
        "source",
        "source_name",
      ].includes(k)
    )
      continue;
    attrs.push({ label: k, value: v, mono: true });
  }
  const eventText = (e: (typeof alert.events)[number]): string => {
    const p = e.payload as Record<string, unknown>;
    switch (e.kind) {
      case "triggered":
        return t("alerts.event.triggered", { priority: String(p.priority ?? "—") });
      case "routed":
        return p.route
          ? t("alerts.event.routed", { route: String(p.route) })
          : t("alerts.event.unrouted");
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
  };

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <header
        style={{
          flex: "none",
          background: "var(--panel)",
          borderBottom: "1px solid var(--line)",
          padding: "14px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 12px 4px 10px",
              borderRadius: 999,
              background: firing ? "var(--dang-t)" : "var(--ok-t)",
              color: firing ? "var(--dang)" : "var(--ok)",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <span
              style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }}
            />
            {firing
              ? acked
                ? t("alerts.status.firingAcked")
                : t("alerts.status.firing")
              : t("alerts.status.resolved")}
          </span>
          {alert.priority && (
            <span
              style={{
                padding: "2px 8px",
                borderRadius: 999,
                background: pr.bg,
                color: pr.ink,
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {alert.priority.name}
            </span>
          )}
          {a.testMode && (
            <span
              style={{
                padding: "2px 8px",
                borderRadius: 6,
                background: "var(--wait-t)",
                color: "var(--wait)",
                fontSize: 10.5,
                fontWeight: 700,
              }}
            >
              {t("alerts.testMode")}
            </span>
          )}
          <h1 className="oi-title" style={{ margin: 0, minWidth: 0 }}>
            {a.title}
          </h1>
          <span style={{ flex: 1 }} />
          {acts && firing && (
            <div style={{ display: "flex", gap: 8 }}>
              {!acked && (
                <form action={acknowledgeAlert}>
                  <input type="hidden" name="id" value={a.id} />
                  <button
                    type="submit"
                    data-testid="alert-ack"
                    style={{
                      ...btn,
                      background: "var(--brand)",
                      color: "#fff",
                      border: 0,
                      fontWeight: 600,
                    }}
                  >
                    {t("alerts.ack")}
                  </button>
                </form>
              )}
              {!alert.incident && (
                <Link href={`/app/incidents/new?alert=${a.id}`} className="oi-hover" style={btn}>
                  {t("alerts.createIncident")}
                </Link>
              )}
              <form action={snoozeAlert}>
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="minutes" value="30" />
                <button type="submit" className="oi-hover" style={btn}>
                  {t("alerts.snooze")}
                </button>
              </form>
              <form action={resolveAlert}>
                <input type="hidden" name="id" value={a.id} />
                <button type="submit" data-testid="alert-resolve" className="oi-hover" style={btn}>
                  {t("alerts.resolve")}
                </button>
              </form>
            </div>
          )}
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
          <span
            style={{
              padding: "2px 9px",
              borderRadius: 999,
              background: "var(--sunk)",
              color: "var(--ink-2)",
              fontSize: 11.5,
              fontWeight: 600,
            }}
          >
            {alert.source.name}
          </span>
          <span>
            {t("alerts.firstSeen", { when: t.fmt.dateTime(a.firstAt) })}
            {a.externalUrl && (
              <>
                {" · "}
                <a
                  href={a.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="oi-link"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
                >
                  {new URL(a.externalUrl).host}
                </a>
              </>
            )}
          </span>
          {a.snoozedUntil && a.snoozedUntil > new Date() && (
            <span style={{ color: "var(--wait)", fontWeight: 600 }}>
              {t("alerts.snoozedUntil", { when: t.fmt.time(a.snoozedUntil) })}
            </span>
          )}
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <main style={{ flex: 1, minWidth: 0, padding: "20px 22px 28px", overflow: "auto" }}>
          <div style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 14 }}>
            <section
              className="oi-panel"
              style={{ padding: "15px 18px", display: "flex", flexDirection: "column", gap: 10 }}
            >
              <div className="oi-eyebrow">
                {t("alerts.attributes")}{" "}
                <span style={{ fontWeight: 400 }}>· {t("alerts.attributesNote")}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {attrs.map((x) => (
                  <div
                    key={x.label}
                    style={{
                      border: "1px solid var(--line)",
                      borderRadius: 10,
                      padding: "9px 12px",
                    }}
                  >
                    <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{x.label}</div>
                    {x.href ? (
                      <Link
                        href={x.href}
                        className="oi-link"
                        style={{
                          fontSize: x.mono ? 12.5 : 13,
                          fontWeight: 600,
                          fontFamily: x.mono ? "var(--font-mono)" : undefined,
                        }}
                      >
                        {x.value}
                      </Link>
                    ) : (
                      <div
                        style={{
                          fontSize: x.mono ? 11.5 : 13,
                          fontWeight: x.mono ? 500 : 600,
                          fontFamily: x.mono ? "var(--font-mono)" : undefined,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {x.value}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
            <section className="oi-panel">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "12px 18px",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  {t("alerts.groupedTitle", { count: alert.grouped.length + 1 })}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {t("alerts.groupWindow")}
                </span>
              </div>
              {[
                { id: a.id, title: a.title, firstAt: a.firstAt, status: a.status },
                ...alert.grouped,
              ].map((g) => (
                <div
                  key={g.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 18px",
                    borderBottom: "1px solid var(--line-2)",
                    fontSize: 13,
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: g.status === "firing" ? "var(--dang)" : "var(--ok)",
                      flex: "none",
                    }}
                  />
                  <span
                    style={{
                      fontWeight: 500,
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {g.title}
                  </span>
                  <span
                    style={{ color: "var(--ink-3)", fontSize: 12, fontFamily: "var(--font-mono)" }}
                  >
                    {t.fmt.time(g.firstAt)}
                  </span>
                </div>
              ))}
            </section>
            <section className="oi-panel" style={{ overflow: "hidden" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "12px 18px",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 600 }}>{t("alerts.payload")}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {t("alerts.payloadNote")}
                </span>
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: "16px 18px",
                  background: "var(--topbar-dark)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: "var(--code-blue)",
                  overflowX: "auto",
                  maxHeight: 360,
                }}
              >
                {JSON.stringify(a.payload, null, 2)}
              </pre>
            </section>
          </div>
        </main>

        <aside
          aria-label={t("alerts.sideLabel")}
          style={{
            width: 304,
            flex: "none",
            borderLeft: "1px solid var(--line)",
            background: "var(--panel)",
            padding: "16px 16px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            overflow: "auto",
          }}
        >
          {esc && esc.status === "pending" && (
            <div
              data-testid="escalation-card"
              style={{
                border: "1.5px solid var(--dang)",
                background: "var(--dang-t)",
                borderRadius: 14,
                padding: "13px 15px",
                display: "flex",
                flexDirection: "column",
                gap: 9,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--dang)" }}
                />
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {t("alerts.escalation.pending")}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
                {t("alerts.escalation.level", { level: esc.level })} —{" "}
                <strong>{esc.levelMembers.join(", ") || t("alerts.escalation.nobody")}</strong>{" "}
                {esc.enteredAt
                  ? t("alerts.escalation.pagedAgo", { when: t.fmt.relative(esc.enteredAt) })
                  : ""}{" "}
                ·{" "}
                {esc.urgency === "high"
                  ? t("alerts.escalation.urgencyHigh")
                  : t("alerts.escalation.urgencyLow")}
              </div>
              {esc.nextTickAt && (
                <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                  {esc.isLast
                    ? t("alerts.escalation.exhaustIn")
                    : t("alerts.escalation.nextLevelIn")}{" "}
                  <Countdown until={esc.nextTickAt.toISOString()} />
                </div>
              )}
              {acts && !acked && (
                <form action={acknowledgeAlert}>
                  <input type="hidden" name="id" value={a.id} />
                  <button
                    type="submit"
                    style={{
                      width: "100%",
                      height: 34,
                      borderRadius: 8,
                      background: "var(--dang)",
                      color: "#fff",
                      border: 0,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {t("alerts.ackNow")}
                  </button>
                </form>
              )}
            </div>
          )}
          {acked && firing && (
            <div
              data-testid="acked-card"
              style={{
                border: "1px solid var(--ok)",
                background: "var(--ok-t)",
                borderRadius: 14,
                padding: "13px 15px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: "var(--ok)",
                    color: "#fff",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  ✓
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ok)" }}>
                  {t("alerts.status.acked")}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
                {t("alerts.ackedBy", {
                  by: alert.ackedByName ?? esc?.ackedByName ?? "—",
                  when: a.ackedAt ? t.fmt.relative(a.ackedAt) : "",
                })}
                {alert.incident ? ` ${t("alerts.ackedJoined")}` : ""}
              </div>
              {acts && (
                <form action={unacknowledgeAlert}>
                  <input type="hidden" name="id" value={a.id} />
                  <button
                    type="submit"
                    className="oi-hover"
                    style={{
                      width: "100%",
                      height: 30,
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      background: "var(--panel)",
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {t("alerts.unack")}
                  </button>
                </form>
              )}
            </div>
          )}
          {esc && esc.status !== "pending" && !acked && (
            <div
              style={{
                border: "1px solid var(--line)",
                borderRadius: 14,
                padding: "11px 15px",
                fontSize: 12.5,
                color: "var(--ink-2)",
              }}
            >
              {t(
                `alerts.escalation.ended.${esc.status as "acked" | "resolved" | "exhausted" | "cancelled"}`,
              )}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="oi-eyebrow">{t("alerts.route")}</div>
            {alert.route ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{alert.route.name}</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
                  {alert.route.escalationMode === "dynamic" && (
                    <>
                      {t("alerts.routeDynamic")} <strong>{t("alerts.routeDynamically")}</strong> :{" "}
                      {String(
                        (
                          alert.events.find((e) => e.kind === "routed")?.payload as
                            Record<string, unknown> | undefined
                        )?.via ?? t("alerts.routeChain"),
                      )}
                    </>
                  )}
                  {alert.route.escalationMode === "static" &&
                    `${t("alerts.routeStatic")} · ${esc?.pathName ?? ""}`}
                  {alert.route.escalationMode === "none" && t("alerts.routeNone")}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                  {t(`alerts.routeIncident.${alert.route.incidentMode}`)}
                </div>
                <Link
                  href={`/app/settings/alert-routes?route=${alert.route.id}`}
                  className="oi-link"
                  style={{ fontSize: 12.5, fontWeight: 600 }}
                >
                  {t("alerts.editRoute")}
                </Link>
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("alerts.noRoute")}</div>
            )}
          </div>
          <div style={{ height: 1, background: "var(--line-2)" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="oi-eyebrow">{t("alerts.incident")}</div>
            {alert.incident ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11.5,
                      color: "var(--ink-2)",
                    }}
                  >
                    INC-{alert.incident.number}
                  </span>
                  {(() => {
                    const tone = phaseTone(alert.incident.phase);
                    return (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "3px 10px 3px 8px",
                          borderRadius: 999,
                          background: tone.bg,
                          color: tone.ink,
                          fontSize: 11.5,
                          fontWeight: 600,
                        }}
                      >
                        <span
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: "50%",
                            background: "currentColor",
                          }}
                        />
                        {t(`incident.phase.${alert.incident.phase}`)}
                      </span>
                    );
                  })()}
                </div>
                <Link
                  href={`/app/incidents/${alert.incident.number}`}
                  className="oi-link"
                  style={{ fontSize: 12.5, fontWeight: 600 }}
                >
                  {t("alerts.openIncident")}
                </Link>
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("alerts.noIncident")}</div>
            )}
          </div>
          <div style={{ height: 1, background: "var(--line-2)" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div className="oi-eyebrow">{t("alerts.history")}</div>
            {alert.events.map((e) => (
              <div
                key={e.id}
                style={{ display: "flex", gap: 8, fontSize: 12.5, color: "var(--ink-2)" }}
              >
                <span
                  style={{
                    color: "var(--ink-3)",
                    flex: "none",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    paddingTop: 2,
                  }}
                >
                  {t.fmt.time(e.occurredAt)}
                </span>
                <span>{eventText(e)}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
