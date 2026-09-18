import Link from "next/link";
import { eq } from "drizzle-orm";
import { investigations, withTenant } from "@openincident/db";
import { aiConfigured, runbooksForService } from "@openincident/ai";
import { getT } from "@/i18n/server";
import type { IncidentDetail } from "@/lib/incidents";
import { aiAllowance, recentChanges, relatedIncidents } from "@/lib/ai-capabilities";
import { onCallNow } from "@/lib/oncall";
import { listMonitors } from "@/lib/monitors";
import type { IncidentService } from "../services-of";

type Line = { text: string; source: string; when: string; href?: string };
type Card = {
  title: string;
  note: string;
  ai?: boolean;
  /** Set when the capability cannot run here: the card says so instead of guessing. */
  unavailable?: string;
  lines: Line[];
};

/**
 * The Context tab: everything the workspace holds about this incident, one
 * card per source, every line saying where it comes from. A card whose source
 * is not available on this instance says so — it never fills the space with
 * something it does not know.
 */
export async function ContextTab({
  inc,
  tenantId,
  services,
  serviceEntryId,
}: {
  inc: IncidentDetail;
  tenantId: string;
  services: IncidentService[];
  serviceEntryId: string | null;
}) {
  const t = await getT();
  const configured = aiConfigured();
  const { onCall, monitors, changes, runbooks } = await withTenant(tenantId, async (tx) => ({
    onCall: await onCallNow(tx, tenantId),
    monitors: await listMonitors(tx, tenantId),
    changes: await recentChanges(tx, tenantId, {
      serviceEntryId,
      declaredAt: inc.row.declaredAt,
      resolvedAt: inc.row.resolvedAt,
    }),
    runbooks: await runbooksForService(tx, tenantId, serviceEntryId),
  }));
  const keys = new Set(services.map((s) => s.key));
  const mine = monitors.filter((m) => m.serviceKey && keys.has(m.serviceKey));

  const relatedAllowed = await aiAllowance(tenantId, "related");
  const related = await relatedIncidents(tenantId, {
    id: inc.row.id,
    name: inc.row.name,
    summary: inc.summary,
  });
  const [inv] = await withTenant(tenantId, (tx) =>
    tx.select().from(investigations).where(eq(investigations.incidentId, inc.row.id)),
  );
  const top = inv?.hypotheses.find((h) => h.id === inv.summary?.topHypothesisId) ?? null;
  const pinned = inc.events.filter((e) => e.pinned);
  // A card the instance cannot fill says which obstacle it is — never a blank.
  const relatedBlocked = !configured
    ? t("inc2.ctx.unavailable")
    : relatedAllowed.ok
      ? null
      : relatedAllowed.reason === "unconfigured"
        ? t("inc2.ctx.unavailable")
        : t(`ai.refusal.${relatedAllowed.reason}`);

  const cards: Card[] = [
    {
      title: t("inc2.ctx.serviceOwner"),
      note: t("inc2.card.services"),
      lines: services.map((s) => ({
        text: s.ownerTeamName
          ? t("inc2.ctx.servicePolicy", { service: s.key, team: s.ownerTeamName })
          : t("inc2.ctx.serviceNoOwner", { service: s.key }),
        source: t("nav.services"),
        when: t("inc2.upd.always"),
        href: `/app/services/${s.id}`,
      })),
    },
    {
      title: t("inc2.ctx.onCall"),
      note: t("nav.onCall"),
      lines: onCall.map((s) => ({
        text: s.memberName
          ? t("inc2.ctx.onCallUntil", {
              name: s.memberName,
              schedule: s.scheduleName,
              until: t.fmt.time(s.until, t.timeZone),
            })
          : t("inc2.ctx.onCallNobody", { schedule: s.scheduleName }),
        source: t("nav.onCall"),
        when: t.fmt.time(s.until, t.timeZone),
        href: "/app/on-call",
      })),
    },
    {
      title: t("inc2.ctx.monitors"),
      note: t("nav.monitors"),
      lines: mine.map((m) => ({
        text: t("inc2.ctx.monitorState", {
          name: m.name,
          state: t(`monitors.state.${m.state}`),
        }),
        source: t("nav.monitors"),
        when: m.lastCheckAt ? t.fmt.relative(m.lastCheckAt) : "—",
        href: `/app/monitors/${m.id}`,
      })),
    },
    {
      title: t("inc2.ctx.changes"),
      note: t("ai.changes.title"),
      lines: changes.map((c) => ({
        text: `${c.title}${c.actorName ? ` · ${c.actorName}` : ""}`,
        source: t(`ai.changes.kind.${c.kind}`),
        when: t.fmt.dateTime(c.occurredAt, t.timeZone),
        ...(c.externalRef ? { href: c.externalRef } : {}),
      })),
    },
    {
      title: t("inc2.ctx.runbooks"),
      note: String(runbooks.length),
      lines: runbooks.map((r) => ({
        text: r.title,
        source: r.sourceUrl ? new URL(r.sourceUrl).host : t("ai.runbooks.pasted"),
        when: r.fetchedAt ? t.fmt.relative(r.fetchedAt) : "—",
        ...(r.sourceUrl ? { href: r.sourceUrl } : {}),
      })),
    },
    {
      title: t("inc2.ctx.similar"),
      note: String(related.items.length),
      ai: true,
      ...(relatedBlocked ? { unavailable: relatedBlocked } : {}),
      lines: related.items.map((r) => ({
        text: `INC-${r.number} — ${r.name}`,
        source: t(`incident.phase.${r.phase}`),
        when: t.fmt.relative(r.declaredAt),
        href: `/app/incidents/${r.number}`,
      })),
    },
    {
      title: t("inc2.ctx.rootCause"),
      note: top ? t(`ai.investigation.confidence.${top.confidence}`) : "—",
      ai: true,
      ...(configured ? {} : { unavailable: t("inc2.ctx.unavailable") }),
      lines:
        inv && top
          ? [
              {
                text: top.whatBroke,
                source: t("ai.investigation.title"),
                when: inv.completedAt ? t.fmt.relative(inv.completedAt) : "—",
                href: `/app/incidents/${inc.row.number}?tab=rca`,
              },
            ]
          : [],
    },
    {
      title: t("inc2.ctx.pinned"),
      note: String(pinned.length),
      lines: pinned.map((e) => ({
        text: typeof e.payload.message === "string" ? e.payload.message : e.kind,
        source: e.actorName ?? t("timeline.system"),
        when: t.fmt.dateTime(e.occurredAt, t.timeZone),
      })),
    },
  ];

  return (
    <div
      className="oi-rise-fast"
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
      data-testid="incident-context"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 12.5,
          color: "var(--ink-2)",
        }}
      >
        <span style={{ color: "var(--viol)" }}>✦</span>
        {t("inc2.ctx.lead")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12 }}>
        {cards.map((c) => (
          <div
            key={c.title}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-card)",
              boxShadow: "var(--shadow-card)",
              padding: "13px 15px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{c.title}</span>
              {c.ai && (
                <span style={{ fontSize: 10, color: "var(--viol)" }}>
                  ✦ {t("inc2.ctx.inference")}
                </span>
              )}
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{c.note}</span>
            </div>
            {c.unavailable ? (
              <div
                style={{
                  display: "flex",
                  gap: 9,
                  alignItems: "flex-start",
                  background: "var(--wait-t)",
                  borderRadius: 10,
                  padding: "10px 12px",
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "var(--wait)",
                    marginTop: 5,
                    flex: "none",
                  }}
                />
                <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                  {c.unavailable}{" "}
                  <Link
                    href="/app/settings/ai"
                    style={{ color: "var(--brand)", fontWeight: 600, textDecoration: "none" }}
                  >
                    {t("inc2.ctx.configure")}
                  </Link>
                </div>
              </div>
            ) : c.lines.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("inc2.ctx.none")}</div>
            ) : (
              c.lines.map((l, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{l.text}</div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 10.5,
                      color: "var(--ink-3)",
                      border: "1px solid var(--line)",
                      borderRadius: 6,
                      padding: "2px 7px",
                      width: "fit-content",
                    }}
                  >
                    {t("inc2.ctx.from", { source: l.source, when: l.when })}
                    {l.href && (
                      <>
                        ·{" "}
                        <Link
                          href={l.href}
                          style={{
                            color: "var(--brand)",
                            fontWeight: 600,
                            textDecoration: "none",
                          }}
                        >
                          {t("inc2.rca.open")}
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
