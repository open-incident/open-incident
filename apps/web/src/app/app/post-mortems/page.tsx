import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  followUps,
  incidents,
  members,
  postMortemComments,
  postMortems,
  severities,
  withTenant,
} from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { severityInk } from "@/lib/tones";

const FILTERS = ["all", "in_progress", "in_review", "completed", "missing"] as const;
type Filter = (typeof FILTERS)[number];

/**
 * Every post-incident document in one place: which incidents have reached the
 * post-incident phase, where their post-mortem stands, who owns it, what is
 * still open under it. Filtered by status; each row opens the document.
 */
export default async function PostMortemsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { tenant, workspace } = await requireMember();
  const t = await getT();
  const { status: raw } = await searchParams;
  const filter: Filter = (FILTERS as readonly string[]).includes(raw ?? "")
    ? (raw as Filter)
    : "all";
  if (raw && raw !== filter) redirect("/app/post-mortems");

  const rows = await withTenant(tenant.id, async (tx) => {
    const base = await tx
      .select({
        id: incidents.id,
        number: incidents.number,
        name: incidents.name,
        phase: incidents.phase,
        severityName: severities.name,
        severityRank: severities.rank,
        lastActivityAt: incidents.lastActivityAt,
        pmId: postMortems.id,
        pmTitle: postMortems.title,
        pmStatus: postMortems.status,
        pmUpdatedAt: postMortems.updatedAt,
        pmUpdatedBy: postMortems.updatedByName,
        ownerName: members.name,
        aiDrafted: postMortems.aiDrafted,
      })
      .from(incidents)
      .leftJoin(severities, eq(severities.id, incidents.severityId))
      .leftJoin(postMortems, eq(postMortems.incidentId, incidents.id))
      .leftJoin(members, eq(members.id, postMortems.ownerMemberId))
      .where(
        and(
          eq(incidents.tenantId, tenant.id),
          inArray(incidents.phase, ["post_incident", "closed"]),
          ne(incidents.mode, "test"),
          isNull(incidents.mergedIntoId),
        ),
      )
      .orderBy(desc(incidents.lastActivityAt))
      .limit(200);
    const ids = base.map((r) => r.id);
    const pmIds = base.map((r) => r.pmId).filter((x): x is string => Boolean(x));
    const openFu = ids.length
      ? await tx
          .select({ incidentId: followUps.incidentId, n: sql<number>`count(*)::int` })
          .from(followUps)
          .where(and(inArray(followUps.incidentId, ids), eq(followUps.status, "open")))
          .groupBy(followUps.incidentId)
      : [];
    const openComments = pmIds.length
      ? await tx
          .select({ pmId: postMortemComments.postMortemId, n: sql<number>`count(*)::int` })
          .from(postMortemComments)
          .where(
            and(
              inArray(postMortemComments.postMortemId, pmIds),
              isNull(postMortemComments.resolvedAt),
            ),
          )
          .groupBy(postMortemComments.postMortemId)
      : [];
    const fuMap = new Map(openFu.map((r) => [r.incidentId, r.n]));
    const cMap = new Map(openComments.map((r) => [r.pmId, r.n]));
    return base.map((r) => ({
      ...r,
      openFollowUps: fuMap.get(r.id) ?? 0,
      openComments: r.pmId ? (cMap.get(r.pmId) ?? 0) : 0,
    }));
  });

  const counts: Record<Filter, number> = {
    all: rows.length,
    in_progress: rows.filter((r) => r.pmStatus === "in_progress").length,
    in_review: rows.filter((r) => r.pmStatus === "in_review").length,
    completed: rows.filter((r) => r.pmStatus === "completed").length,
    missing: rows.filter((r) => !r.pmId).length,
  };
  const shown = rows.filter((r) =>
    filter === "all" ? true : filter === "missing" ? !r.pmId : r.pmStatus === filter,
  );
  const tone: Record<string, { bg: string; ink: string }> = {
    in_progress: { bg: "var(--open-t)", ink: "var(--open)" },
    in_review: { bg: "var(--wait-t)", ink: "var(--wait)" },
    completed: { bg: "var(--ok-t)", ink: "var(--ok)" },
    missing: { bg: "var(--sunk)", ink: "var(--ink-3)" },
  };
  const term = workspace.postMortemTerm ?? t("postMortems.title");

  return (
    <section style={{ flex: 1, minWidth: 0, overflow: "auto", padding: "22px 22px 30px" }}>
      <div
        className="oi-rise"
        style={{ maxWidth: 1080, display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 className="oi-title" style={{ margin: 0 }}>
            {term}
          </h1>
          <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("postMortems.subtitle")}</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
            {t("postMortems.count", { count: shown.length })}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} data-testid="pm-filters">
          {FILTERS.map((f) => {
            const active = f === filter;
            return (
              <Link
                key={f}
                href={f === "all" ? "/app/post-mortems" : `/app/post-mortems?status=${f}`}
                aria-current={active ? "page" : undefined}
                style={{
                  height: 30,
                  padding: "0 12px",
                  borderRadius: 999,
                  border: `1px solid ${active ? "var(--brand)" : "var(--line)"}`,
                  background: active ? "var(--brand-t)" : "var(--panel)",
                  color: active ? "var(--brand)" : "var(--ink-2)",
                  fontSize: 12.5,
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  textDecoration: "none",
                }}
              >
                {t(`postMortems.filter.${f}`)}
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, opacity: 0.8 }}>
                  {counts[f]}
                </span>
              </Link>
            );
          })}
        </div>
        <div className="oi-panel" style={{ overflow: "hidden" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 3fr) 90px 130px 150px 130px 110px 110px",
              gap: 10,
              padding: "9px 16px",
              borderBottom: "1px solid var(--line)",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--ink-3)",
              letterSpacing: ".02em",
            }}
          >
            <span>{t("postMortems.col.incident")}</span>
            <span>{t("postMortem.meta.severity")}</span>
            <span>{t("postMortems.col.status")}</span>
            <span>{t("postMortems.col.owner")}</span>
            <span>{t("postMortems.col.updated")}</span>
            <span style={{ textAlign: "right" }}>{t("postMortems.col.followUps")}</span>
            <span style={{ textAlign: "right" }}>{t("postMortems.col.comments")}</span>
          </div>
          {shown.length === 0 && (
            <div style={{ padding: "22px 16px", fontSize: 13, color: "var(--ink-3)" }}>
              {t("postMortems.empty")}
            </div>
          )}
          {shown.map((r) => {
            const status = r.pmStatus ?? "missing";
            const tn = tone[status] ?? tone.missing!;
            return (
              <Link
                key={r.id}
                href={`/app/incidents/${r.number}?tab=post-incident`}
                className="oi-hover"
                data-testid="pm-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 3fr) 90px 130px 150px 130px 110px 110px",
                  gap: 10,
                  padding: "11px 16px",
                  borderBottom: "1px solid var(--line-2)",
                  alignItems: "center",
                  fontSize: 13,
                  color: "inherit",
                  textDecoration: "none",
                }}
              >
                <span style={{ minWidth: 0, display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      flex: "none",
                    }}
                  >
                    INC-{r.number}
                  </span>
                  <span
                    style={{
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.pmTitle?.trim() || r.name}
                  </span>
                  {r.aiDrafted && (
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: 9.5,
                        letterSpacing: ".08em",
                        color: "var(--viol)",
                        background: "var(--viol-t)",
                        borderRadius: 5,
                        padding: "1px 5px",
                        flex: "none",
                      }}
                    >
                      {t("postMortem.aiDraftTag")}
                    </span>
                  )}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    fontWeight: 500,
                    color: severityInk(r.severityRank),
                  }}
                >
                  {r.severityName ?? "—"}
                </span>
                <span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "2px 9px 2px 7px",
                      borderRadius: 999,
                      background: tn.bg,
                      color: tn.ink,
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
                    {status === "missing"
                      ? t("postMortems.missing")
                      : t(`postMortem.status.${status}`)}
                  </span>
                </span>
                <span
                  style={{
                    color: "var(--ink-2)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.ownerName ?? "—"}
                </span>
                <span style={{ color: "var(--ink-3)", fontSize: 12 }}>
                  {r.pmUpdatedAt ? t.fmt.relative(r.pmUpdatedAt) : t.fmt.relative(r.lastActivityAt)}
                </span>
                <span
                  style={{
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    color: r.openFollowUps ? "var(--ink)" : "var(--ink-3)",
                  }}
                >
                  {r.openFollowUps || "—"}
                </span>
                <span
                  style={{
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    color: r.openComments ? "var(--brand)" : "var(--ink-3)",
                  }}
                >
                  {r.openComments || "—"}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
