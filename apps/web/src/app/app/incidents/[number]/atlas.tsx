import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { incidents, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import type { IncidentDetail } from "@/lib/incidents";
import { aiAllowance, recentChanges, relatedIncidents } from "@/lib/ai-capabilities";
import { regenerateSummary } from "./ai-actions";
import { SuggestFollowUps } from "./suggest-follow-ups";

const panel: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};
const chip: React.CSSProperties = {
  fontSize: 10.5,
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "2px 7px",
  color: "var(--ink-3)",
};

/**
 * The Atlas tab: what the assistant has to say about this incident, and
 * nothing it cannot back. The summary is a draft a person can turn into an
 * update; the incidents that look like this one and the changes recorded
 * around it come from the workspace's own rows.
 */
export async function AtlasTab({
  inc,
  tenantId,
  number,
  canAct,
  alerts,
}: {
  inc: IncidentDetail;
  tenantId: string;
  number: number;
  canAct: boolean;
  alerts: number;
}) {
  const t = await getT();
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select({
        aiSummary: incidents.aiSummary,
        aiSummaryAt: incidents.aiSummaryAt,
        serviceEntryId: incidents.serviceEntryId,
      })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, inc.row.id))),
  );
  const summaryAllowed = await aiAllowance(tenantId, "summary");
  const followUpsAllowed = await aiAllowance(tenantId, "follow_ups");
  const related = await relatedIncidents(tenantId, {
    id: inc.row.id,
    name: inc.row.name,
    summary: inc.summary,
  });
  const changes = await withTenant(tenantId, (tx) =>
    recentChanges(tx, tenantId, {
      serviceEntryId: row?.serviceEntryId ?? null,
      declaredAt: inc.row.declaredAt,
      resolvedAt: inc.row.resolvedAt,
    }),
  );

  return (
    <div
      className="oi-rise-fast"
      style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-start" }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          minWidth: 0,
          flex: "10 1 460px",
        }}
      >
        <div
          style={{
            ...panel,
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
          data-testid="ai-summary"
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t("inc2.atlas.summary")}</span>
            {row?.aiSummary && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "var(--viol)",
                  background: "var(--viol-t)",
                  borderRadius: 5,
                  padding: "1px 6px",
                }}
              >
                {t("atlas.draftLabel")}
              </span>
            )}
            <span style={{ flex: 1 }} />
            {canAct && summaryAllowed.ok && (
              <form action={regenerateSummary} style={{ display: "contents" }}>
                <input type="hidden" name="number" value={number} />
                <button
                  type="submit"
                  data-testid="ai-summary-generate"
                  style={{
                    background: "none",
                    border: 0,
                    padding: 0,
                    fontSize: 11.5,
                    color: "var(--viol)",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  ✦ {row?.aiSummary ? t("ai.regenerate") : t("ai.generate")}
                </button>
              </form>
            )}
            {row?.aiSummary && canAct && (
              <Link
                href={`/app/incidents/${number}?update=1&use=summary`}
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--brand)",
                  textDecoration: "none",
                }}
              >
                {t("inc2.atlas.useAsUpdate")}
              </Link>
            )}
          </div>
          <div
            style={{
              fontSize: 14,
              lineHeight: 1.65,
              color: row?.aiSummary ? "var(--ink)" : "var(--ink-3)",
              textWrap: "pretty",
            }}
          >
            {row?.aiSummary ??
              (summaryAllowed.ok
                ? t("ai.summary.empty")
                : t(`ai.refusal.${summaryAllowed.reason}`))}
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <span style={chip}>{t("inc2.atlas.events", { count: inc.events.length })}</span>
            <span style={chip}>{t("inc2.atlas.alertsChip", { count: alerts })}</span>
            <span style={chip}>{t("inc2.atlas.changesChip", { count: changes.length })}</span>
            {row?.aiSummaryAt && (
              <span style={chip}>
                {t("ai.summary.generatedAt", { when: t.fmt.relative(row.aiSummaryAt) })}
              </span>
            )}
          </div>
        </div>

        <div style={{ ...panel, overflow: "hidden" }} data-testid="ai-related">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 18px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t("inc2.atlas.similar")}</span>
            <span style={{ fontSize: 11.5, color: "var(--ink-3)", marginLeft: 10 }}>
              {related.method === "embeddings"
                ? t("ai.related.byEmbeddings")
                : related.method === "text"
                  ? t("ai.related.byText")
                  : t("inc2.atlas.similarHint")}
            </span>
          </div>
          {related.items.length === 0 ? (
            <div style={{ padding: "12px 18px", fontSize: 12.5, color: "var(--ink-3)" }}>
              {related.method === "off" ? t("ai.refusal.capability_off") : t("ai.related.empty")}
            </div>
          ) : (
            related.items.map((r, i) => (
              <Link
                key={r.number}
                href={`/app/incidents/${r.number}`}
                className="oi-hover"
                style={{
                  display: "grid",
                  gridTemplateColumns: "70px minmax(0,1fr) 120px",
                  gap: 12,
                  alignItems: "center",
                  padding: "11px 18px",
                  borderBottom: i === related.items.length - 1 ? 0 : "1px solid var(--line-2)",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "var(--brand)",
                  }}
                >
                  INC-{r.number}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{r.name}</span>
                  <span
                    style={{
                      display: "block",
                      fontSize: 12,
                      color: "var(--ink-2)",
                      marginTop: 1,
                    }}
                  >
                    {t(`incident.phase.${r.phase}`)}
                  </span>
                </span>
                <span style={{ fontSize: 11.5, color: "var(--ink-3)", textAlign: "right" }}>
                  {t.fmt.relative(r.declaredAt)}
                </span>
              </Link>
            ))
          )}
        </div>

        <div style={{ ...panel, overflow: "hidden" }} data-testid="ai-changes">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 18px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t("inc2.atlas.changes")}</span>
            <span style={{ fontSize: 11.5, color: "var(--ink-3)", marginLeft: 10 }}>
              {t("inc2.atlas.changesHint")}
            </span>
          </div>
          {changes.length === 0 ? (
            <div style={{ padding: "12px 18px", fontSize: 12.5, color: "var(--ink-3)" }}>
              {t("ai.changes.empty")}
            </div>
          ) : (
            changes.map((c, i) => (
              <div
                key={c.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "70px minmax(0,1fr) 90px",
                  gap: 12,
                  alignItems: "center",
                  padding: "11px 18px",
                  borderBottom: i === changes.length - 1 ? 0 : "1px solid var(--line-2)",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "var(--viol)",
                  }}
                >
                  {t(`ai.changes.kind.${c.kind}`)}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>
                    {c.externalRef ? (
                      <a href={c.externalRef} target="_blank" rel="noreferrer" className="oi-link">
                        {c.title}
                      </a>
                    ) : (
                      c.title
                    )}
                  </span>
                  <span
                    style={{ display: "block", fontSize: 12, color: "var(--ink-2)", marginTop: 1 }}
                  >
                    {[c.actorName, c.serviceName].filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
                <span style={{ fontSize: 11.5, color: "var(--ink-3)", textAlign: "right" }}>
                  {t.fmt.time(c.occurredAt, t.timeZone)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          flex: "1 1 280px",
          maxWidth: 340,
          minWidth: 260,
        }}
      >
        <div
          style={{
            ...panel,
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
            }}
          >
            {t("inc2.atlas.suggested")}
          </div>
          {canAct && followUpsAllowed.ok ? (
            <SuggestFollowUps number={number} />
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
              {followUpsAllowed.ok
                ? t("ai.followUps.note")
                : t(`ai.refusal.${followUpsAllowed.reason}`)}
            </div>
          )}
        </div>
        <div
          style={{
            background: "var(--sunk)",
            borderRadius: "var(--radius-card)",
            padding: "12px 14px",
            fontSize: 12,
            color: "var(--ink-2)",
            lineHeight: 1.55,
          }}
        >
          {t("inc2.atlas.note")}
        </div>
      </div>
    </div>
  );
}
