import Link from "next/link";
import { getT } from "@/i18n/server";
import type { IncidentDetail } from "@/lib/incidents";
import { avatarTone, initials } from "@/lib/avatar";
import { priorityTone, severityInk } from "@/lib/tones";
import { AssignRole } from "./assign-role";

/**
 * The 304 px details panel of the design: Details (status, severity, type, mode,
 * service, custom fields), Roles with avatars and the participant counts, the
 * post-incident progress, the follow-ups digest, then the escalations and the
 * linked alerts (`extra`). The status page section lands with its milestone.
 */
export async function SidePanel({
  inc,
  number,
  canAct,
  extra,
}: {
  inc: IncidentDetail;
  number: number;
  canAct: boolean;
  /** Sections rendered by the page below the built-in ones (alerts, escalations). */
  extra?: React.ReactNode;
}) {
  const t = await getT();
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
      <span style={{ color: "var(--ink-3)", flex: "none" }}>{label}</span>
      <span
        style={{
          textAlign: "right",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {children}
      </span>
    </div>
  );
  const Sep = () => <div style={{ height: 1, background: "var(--line-2)" }} />;
  const tasksDone = inc.tasks.filter((x) => x.completedAt || x.skippedAt).length;
  const openFu = inc.followUps.filter((f) => f.status === "open");

  return (
    <aside
      aria-label={t("incident.detailsLabel")}
      style={{
        width: 304,
        flex: "none",
        borderLeft: "1px solid var(--line)",
        background: "var(--panel)",
        overflow: "auto",
        padding: "16px 16px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="oi-eyebrow">{t("incident.details")}</div>
        <Row label={t("incident.field.status")}>
          <span style={{ fontWeight: 600 }}>
            {inc.row.phase === "active"
              ? (inc.row.statusName ?? "—")
              : t(`incident.phase.${inc.row.phase}`)}
          </span>
        </Row>
        <Row label={t("incident.field.severity")}>
          <span style={{ fontWeight: 600 }}>
            <span style={{ color: severityInk(inc.row.severityRank) }}>
              {inc.row.severityName ?? "—"}
            </span>
            {inc.severityDescription
              ? ` — ${inc.severityDescription.split(" — ")[0]?.toLowerCase()}`
              : ""}
          </span>
        </Row>
        <Row label={t("incident.field.type")}>{inc.typeName}</Row>
        <Row label={t("incident.field.mode")}>{t(`incident.mode.${inc.row.mode}`)}</Row>
        <Row label={t("incident.field.service")}>
          {inc.row.serviceName ? (
            <Link
              href={`/app/catalog?entry=${encodeURIComponent(inc.row.serviceName)}`}
              className="oi-link"
              style={{ fontWeight: 600, fontFamily: "var(--font-mono)", fontSize: 12 }}
            >
              {inc.row.serviceName}
            </Link>
          ) : (
            "—"
          )}
        </Row>
        {inc.customFields.map((f) => (
          <Row key={f.key} label={f.label}>
            <span
              style={{
                fontFamily:
                  /^[a-z_]+$/.test(f.key) && /^[a-z0-9-]+$/.test(f.value)
                    ? "var(--font-mono)"
                    : undefined,
                fontSize: /^[a-z0-9-]+$/.test(f.value) ? 12 : 13,
              }}
            >
              {f.value}
            </span>
          </Row>
        ))}
      </div>

      <Sep />
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span className="oi-eyebrow">{t("incident.roles")}</span>
          <span style={{ flex: 1 }} />
          {canAct && <AssignRole number={number} roles={inc.roles} />}
        </div>
        {inc.roles.map((r) => {
          const tone = r.memberName
            ? avatarTone(r.memberName)
            : { bg: "var(--sunk)", ink: "var(--ink-3)" };
          return (
            <div key={r.roleId} style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span
                aria-hidden
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: tone.bg,
                  color: tone.ink,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 10,
                  fontWeight: 700,
                  border:
                    r.isLead && r.memberName ? "1px solid var(--brand-b)" : "1px solid transparent",
                  flex: "none",
                }}
              >
                {r.memberName ? initials(r.memberName) : "?"}
              </span>
              <span style={{ lineHeight: 1.25, minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 600,
                    color: r.memberName ? "var(--ink)" : "var(--ink-3)",
                  }}
                >
                  {r.memberName ?? t("incident.roleUnassigned")}
                </span>
                <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)" }}>
                  {r.roleName}
                </span>
              </span>
            </div>
          );
        })}
        {(inc.participants.participants > 0 || inc.participants.observers > 0) && (
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {t("incident.participants", { count: inc.participants.participants })} ·{" "}
            {t("incident.observers", { count: inc.participants.observers })}
          </div>
        )}
      </div>

      {(inc.tasks.length > 0 || inc.row.phase === "post_incident") && (
        <>
          <Sep />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="oi-eyebrow">{t("incident.tab.postIncident")}</div>
            {inc.tasks.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <div
                  style={{
                    flex: 1,
                    height: 7,
                    borderRadius: 4,
                    background: "var(--sunk)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.round((tasksDone / inc.tasks.length) * 100)}%`,
                      height: "100%",
                      background: "var(--brand)",
                      borderRadius: 4,
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--ink-2)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {tasksDone}/{inc.tasks.length}
                </span>
              </div>
            )}
            <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
              {[
                inc.postMortem ? t(`postMortem.status.${inc.postMortem.status}`) : null,
                inc.debrief
                  ? t("incident.debriefOn", {
                      date: t.fmt.dateShort(inc.debrief.scheduledAt),
                      time: t.fmt.time(inc.debrief.scheduledAt, t.timeZone),
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
            <Link
              href={`/app/incidents/${number}?tab=post-incident`}
              className="oi-hover-edge-fill"
              style={{
                height: 32,
                border: "1px solid var(--line)",
                borderRadius: 8,
                background: "var(--panel)",
                display: "grid",
                placeItems: "center",
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--brand)",
                textDecoration: "none",
              }}
            >
              {t("incident.openPostIncident")}
            </Link>
          </div>
        </>
      )}

      {inc.followUps.length > 0 && (
        <>
          <Sep />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span className="oi-eyebrow">
                {t("incident.followUpsCount", { count: inc.followUps.length })}
              </span>
              <span style={{ flex: 1 }} />
              <Link
                href={`/app/incidents/${number}?tab=follow-ups`}
                className="oi-link"
                style={{ fontSize: 12, fontWeight: 600 }}
              >
                {t("common.seeAll")}
              </Link>
            </div>
            {[...openFu, ...inc.followUps.filter((f) => f.status !== "open")]
              .slice(0, 4)
              .map((f) => {
                const done = f.status === "done";
                const prio = priorityTone(
                  f.priorityName === "P1" ? 0 : f.priorityName === "P2" ? 1 : 2,
                );
                return (
                  <div
                    key={f.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
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
                    <span
                      style={{
                        padding: "1px 7px",
                        borderRadius: 999,
                        background: prio.bg,
                        color: prio.ink,
                        fontSize: 10.5,
                        fontWeight: 700,
                      }}
                    >
                      {f.priorityName ?? "—"}
                    </span>
                  </div>
                );
              })}
          </div>
        </>
      )}
      {extra}
    </aside>
  );
}
