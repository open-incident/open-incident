import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { incidents, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import type { IncidentDetail } from "@/lib/incidents";
import { aiAllowance, recentChanges, relatedIncidents } from "@/lib/ai-capabilities";
import { runbooksForService } from "@openincident/ai";
import { AiBadge } from "@/components/ai-badge";
import { regenerateSummary } from "./ai-actions";

/**
 * The side panel's three assistant sections, in the design's idiom: an AI
 * summary with its draft label, the incidents that look like this one, and
 * the changes recorded around it. Each says when it has nothing, and why.
 */
export async function AiPanel({
  inc,
  tenantId,
  number,
  canAct,
}: {
  inc: IncidentDetail;
  tenantId: string;
  number: number;
  canAct: boolean;
}) {
  const t = await getT();
  const [summaryRow] = await withTenant(tenantId, (tx) =>
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
  const related = await relatedIncidents(tenantId, {
    id: inc.row.id,
    name: inc.row.name,
    summary: inc.summary,
  });
  const runbooks = await withTenant(tenantId, (tx) =>
    runbooksForService(tx, tenantId, summaryRow?.serviceEntryId ?? null),
  );
  const changes = await withTenant(tenantId, (tx) =>
    recentChanges(tx, tenantId, {
      serviceEntryId: summaryRow?.serviceEntryId ?? null,
      declaredAt: inc.row.declaredAt,
      resolvedAt: inc.row.resolvedAt,
    }),
  );
  const head: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--ink-3)",
    letterSpacing: ".02em",
    display: "flex",
    alignItems: "center",
    gap: 8,
  };
  const section: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    paddingTop: 12,
    borderTop: "1px solid var(--line-2)",
  };
  const muted: React.CSSProperties = { fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 };
  const kindTone: Record<string, { bg: string; ink: string }> = {
    deploy: { bg: "var(--open-t)", ink: "var(--open)" },
    flag: { bg: "var(--viol-t)", ink: "var(--viol)" },
    config: { bg: "var(--wait-t)", ink: "var(--wait)" },
    other: { bg: "var(--sunk)", ink: "var(--ink-2)" },
  };
  return (
    <>
      <div style={section} data-testid="ai-summary">
        <div style={head}>
          {t("ai.summary.title")}
          <AiBadge />
          <span style={{ flex: 1 }} />
          {canAct && summaryAllowed.ok && (
            <form action={regenerateSummary} style={{ display: "contents" }}>
              <input type="hidden" name="number" value={number} />
              <button
                type="submit"
                className="oi-link"
                data-testid="ai-summary-generate"
                style={{
                  background: "none",
                  border: 0,
                  padding: 0,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  color: "var(--brand)",
                }}
              >
                {summaryRow?.aiSummary ? t("ai.regenerate") : t("ai.generate")}
              </button>
            </form>
          )}
        </div>
        {summaryRow?.aiSummary ? (
          <>
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                lineHeight: 1.55,
                color: "var(--ink-2)",
                textWrap: "pretty",
              }}
            >
              {summaryRow.aiSummary}
            </p>
            {summaryRow.aiSummaryAt && (
              <div style={muted}>
                {t("ai.summary.generatedAt", { when: t.fmt.relative(summaryRow.aiSummaryAt) })}
              </div>
            )}
          </>
        ) : (
          <div style={muted}>
            {summaryAllowed.ok ? t("ai.summary.empty") : t(`ai.refusal.${summaryAllowed.reason}`)}
          </div>
        )}
      </div>
      <div style={section} data-testid="ai-related">
        <div style={head}>
          {t("ai.related.title")}
          <span style={{ flex: 1 }} />
          <span style={{ fontWeight: 500 }}>
            {related.method === "embeddings"
              ? t("ai.related.byEmbeddings")
              : related.method === "text"
                ? t("ai.related.byText")
                : ""}
          </span>
        </div>
        {related.items.length === 0 ? (
          <div style={muted}>
            {related.method === "off" ? t("ai.refusal.capability_off") : t("ai.related.empty")}
          </div>
        ) : (
          related.items.map((r) => (
            <Link
              key={r.number}
              href={`/app/incidents/${r.number}`}
              className="oi-hover"
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                padding: "6px 8px",
                margin: "0 -8px",
                borderRadius: 8,
                textDecoration: "none",
                color: "inherit",
                fontSize: 12.5,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--ink-3)",
                  flex: "none",
                }}
              >
                INC-{r.number}
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontWeight: 500,
                }}
              >
                {r.name}
              </span>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  padding: "1px 7px",
                  borderRadius: 999,
                  background:
                    r.phase === "active" || r.phase === "triage" ? "var(--open-t)" : "var(--ok-t)",
                  color: r.phase === "active" || r.phase === "triage" ? "var(--open)" : "var(--ok)",
                  flex: "none",
                }}
              >
                {t(`incident.phase.${r.phase}`)}
              </span>
            </Link>
          ))
        )}
      </div>
      {runbooks.length > 0 && (
        <div style={section} data-testid="ai-runbooks">
          <div style={head}>{t("ai.runbooks.title")}</div>
          {runbooks.map((r) => (
            <div
              key={r.id}
              style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5 }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--brand)",
                  flex: "none",
                  marginTop: 6,
                }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                {r.sourceUrl ? (
                  <a
                    href={r.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="oi-link"
                    style={{ fontWeight: 500, display: "block" }}
                  >
                    {r.title}
                  </a>
                ) : (
                  <span style={{ fontWeight: 500, display: "block" }}>{r.title}</span>
                )}
                <span style={muted}>
                  {r.fetchError
                    ? t("ai.runbooks.fetchError")
                    : r.fetchedAt
                      ? t("ai.runbooks.fetchedAt", { when: t.fmt.relative(r.fetchedAt) })
                      : t("ai.runbooks.pasted")}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
      <div style={section} data-testid="ai-changes">
        <div style={head}>{t("ai.changes.title")}</div>
        {changes.length === 0 ? (
          <div style={muted}>{t("ai.changes.empty")}</div>
        ) : (
          changes.map((c) => {
            const tone = kindTone[c.kind] ?? kindTone.other!;
            return (
              <div
                key={c.id}
                style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5 }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: 5,
                    background: tone.bg,
                    color: tone.ink,
                    flex: "none",
                    marginTop: 2,
                    letterSpacing: ".04em",
                  }}
                >
                  {t(`ai.changes.kind.${c.kind}`)}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {c.externalRef ? (
                    <a
                      href={c.externalRef}
                      target="_blank"
                      rel="noreferrer"
                      className="oi-link"
                      style={{ fontWeight: 500, display: "block" }}
                    >
                      {c.title}
                    </a>
                  ) : (
                    <span style={{ fontWeight: 500, display: "block" }}>{c.title}</span>
                  )}
                  <span style={muted}>
                    {t.fmt.dateTime(c.occurredAt, t.timeZone)}
                    {c.actorName ? ` · ${c.actorName}` : ""}
                    {c.serviceName ? ` · ${c.serviceName}` : ""}
                  </span>
                </span>
              </div>
            );
          })
        )}
        <div style={{ ...muted, fontSize: 11.5 }}>{t("ai.changes.hint")}</div>
      </div>
    </>
  );
}
