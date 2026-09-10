import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { getIncident } from "@/lib/incidents";
import { renderMarkdown } from "@/lib/markdown";
import { documentTitle, sectionTitle } from "@/lib/post-mortem";
import { PrintButton } from "../pm-print";

/**
 * The post-mortem alone on a page: what a reader gets when the link is shared,
 * and what the browser prints. Read-only — the editing happens on the incident.
 */
export default async function PostMortemPage({ params }: { params: Promise<{ number: string }> }) {
  const { tenant, workspace } = await requireMember();
  const t = await getT();
  const number = Number((await params).number);
  if (!Number.isInteger(number) || number <= 0) notFound();
  const inc = await withTenant(tenant.id, (tx) => getIncident(tx, tenant.id, number));
  if (!inc?.postMortem) notFound();
  const pm = inc.postMortem;
  const term = workspace.postMortemTerm ?? t("postMortem.title");
  const btn: React.CSSProperties = {
    height: 32,
    padding: "0 12px",
    border: "1px solid var(--line)",
    borderRadius: 8,
    background: "var(--panel)",
    fontSize: 12.5,
    fontWeight: 500,
    cursor: "pointer",
    color: "inherit",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
  };
  return (
    <section style={{ flex: 1, minWidth: 0, overflow: "auto", padding: "24px 22px 40px" }}>
      <style>{`@media print { body * { visibility: hidden; } #pm-doc, #pm-doc * { visibility: visible; } #pm-doc { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none; border: 0; } }`}</style>
      <div
        style={{
          maxWidth: 820,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href={`/app/incidents/${number}?tab=post-incident`} style={btn}>
            ← INC-{number}
          </Link>
          <span style={{ flex: 1 }} />
          <a href={`/app/incidents/${number}/post-mortem/markdown`} style={btn}>
            {t("postMortem.export.download")}
          </a>
          <PrintButton style={btn} />
        </div>
        <article
          id="pm-doc"
          className="oi-panel"
          style={{ padding: "34px 40px" }}
          data-testid="pm-page"
        >
          <div className="oi-eyebrow">{term}</div>
          <h1
            style={{
              margin: "6px 0 0",
              fontFamily: "var(--font-title)",
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: "-.02em",
            }}
          >
            {documentTitle(inc, pm)}
          </h1>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", margin: "8px 0 24px" }}>
            {[
              inc.row.severityName,
              t.fmt.dateShort(inc.row.declaredAt),
              inc.row.resolvedAt
                ? t("postMortem.detectionToResolution", {
                    duration: t.fmt.duration(
                      (inc.row.resolvedAt.getTime() - inc.row.declaredAt.getTime()) / 60_000,
                    ),
                  })
                : null,
              inc.row.serviceName,
              pm.ownerName ? t("postMortem.ownedBy", { name: pm.ownerName }) : null,
              t(`postMortem.status.${pm.status}`),
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
          {pm.sections.map((s) => (
            <section key={s.key} style={{ marginBottom: 22 }}>
              <h2
                style={{
                  margin: "0 0 6px",
                  fontFamily: "var(--font-title)",
                  fontSize: 18,
                  fontWeight: 600,
                }}
              >
                {sectionTitle(s, t)}
              </h2>
              {s.body.trim() ? (
                <div
                  className="oi-prose"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(s.body) }}
                />
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: "var(--ink-3)", fontStyle: "italic" }}>
                  {t("postMortem.emptySection")}
                </p>
              )}
            </section>
          ))}
          {inc.followUps.length > 0 && (
            <section>
              <h2
                style={{
                  margin: "0 0 6px",
                  fontFamily: "var(--font-title)",
                  fontSize: 18,
                  fontWeight: 600,
                }}
              >
                {t("incident.tab.followUps")}
              </h2>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 20,
                  fontSize: 13.5,
                  color: "var(--ink-2)",
                  lineHeight: 1.65,
                }}
              >
                {inc.followUps.map((f) => (
                  <li key={f.id}>
                    {f.title} — <strong>{f.priorityName ?? "—"}</strong>,{" "}
                    {t(`followUp.status.${f.status}`).toLowerCase()}
                    {f.assigneeName ? ` · ${f.assigneeName}` : ""}
                    {f.externalRef ? ` (${f.externalRef.key})` : ""}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {pm.aiDrafted && (
            <p style={{ marginTop: 26, fontSize: 11.5, color: "var(--ink-3)" }}>
              {t("postMortem.aiDraftNote")}
            </p>
          )}
        </article>
      </div>
    </section>
  );
}
