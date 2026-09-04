import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import {
  severities,
  statusPageIncidentUpdates,
  statusPageIncidents,
  statusPages,
  withTenant,
} from "@openincident/db";
import { statusPageUrl } from "@openincident/statuspages";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";

/** The side panel's status page section: what is published, or the invitation to publish when the severity qualifies. */
export async function IncidentStatusPage({
  incidentId,
  number,
  severityRank,
  phase,
  canAct,
}: {
  incidentId: string;
  number: number;
  severityRank: number | null;
  phase: string;
  canAct: boolean;
}) {
  const { tenant } = await requireMember();
  const t = await getT();
  const data = await withTenant(tenant.id, async (tx) => {
    const [page] = await tx
      .select()
      .from(statusPages)
      .where(eq(statusPages.tenantId, tenant.id))
      .limit(1);
    if (!page) return null;
    const [pub] = await tx
      .select()
      .from(statusPageIncidents)
      .where(
        and(
          eq(statusPageIncidents.tenantId, tenant.id),
          eq(statusPageIncidents.incidentId, incidentId),
        ),
      );
    const [stats] = pub
      ? await tx
          .select({
            n: sql<number>`count(*)`.mapWith(Number),
            notified:
              sql<number>`coalesce(sum(${statusPageIncidentUpdates.notifiedCount}), 0)`.mapWith(
                Number,
              ),
          })
          .from(statusPageIncidentUpdates)
          .where(eq(statusPageIncidentUpdates.statusPageIncidentId, pub.id))
      : [];
    void severities;
    return { page, pub: pub ?? null, updates: stats?.n ?? 0, notified: stats?.notified ?? 0 };
  });
  if (!data) return null;
  const eligible = severityRank !== null && severityRank <= data.page.minSeverityRank;
  return (
    <>
      <div style={{ height: 1, background: "var(--line-2)" }} />
      <div
        data-testid="status-page-section"
        style={{ display: "flex", flexDirection: "column", gap: 7 }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <span className="oi-eyebrow">{t("incident.statusPage")}</span>
          <span style={{ flex: 1 }} />
          {data.pub && (
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: data.pub.status === "resolved" ? "var(--ok)" : "var(--wait)",
              }}
            >
              {t("incident.statusPagePublished", {
                status: t(`statusPages.publicStatus.${data.pub.status}`),
              })}
            </span>
          )}
        </div>
        {data.pub ? (
          <>
            <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.45 }}>
              {data.page.name} — « {data.pub.title} »
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {t("incident.statusPageStats", { count: data.updates, notified: data.notified })}
            </div>
            <a
              href={statusPageUrl(data.page)}
              target="_blank"
              rel="noreferrer"
              className="oi-link"
              style={{ fontSize: 12.5, fontWeight: 600 }}
            >
              {t("statusPages.viewPublic")}
            </a>
          </>
        ) : eligible && canAct && phase !== "closed" && phase !== "triage" ? (
          <>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
              {t("incident.statusPageEligible", { page: data.page.name })}
            </div>
            <Link
              href={`/app/incidents/${number}?update=1&publish=1`}
              data-testid="status-page-publish"
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
              {t("incident.statusPagePublish", { page: data.page.name })}
            </Link>
          </>
        ) : (
          <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
            {t("incident.statusPageNotEligible", { page: data.page.name })}
          </div>
        )}
      </div>
    </>
  );
}
