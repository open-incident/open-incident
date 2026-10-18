import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { getIncident } from "@/lib/incidents";
import { renderMarkdown } from "@/lib/markdown";
import { documentTitle, sectionTitle } from "@/lib/post-mortem";
import { WhatAtlasDid } from "@/components/atlas/what-atlas-did";
import { AutoPrint, PrintButton } from "../pm-print";

/**
 * The post-mortem alone on a page, at the document's 780 px reading width:
 * what a reader gets when the link is shared, and what the browser prints —
 * "Export PDF" opens it with `?print=1` and the print dialog saves the PDF.
 * Read-only, and without the team's comments: those never leave the incident.
 */
export default async function PostMortemPage({
  params,
  searchParams,
}: {
  params: Promise<{ number: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const { tenant, workspace } = await requireMember();
  const t = await getT();
  const number = Number((await params).number);
  if (!Number.isInteger(number) || number <= 0) notFound();
  const inc = await withTenant(tenant.id, (tx) => getIncident(tx, tenant.id, number));
  if (!inc?.postMortem) notFound();
  const pm = inc.postMortem;
  const print = (await searchParams).print === "1";
  const decisions = inc.events.filter(
    (e) => e.kind === "note" && (e.payload as { system?: string })?.system === "decision",
  );
  const h2: React.CSSProperties = {
    margin: "0 0 8px",
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: "-.01em",
  };
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
          maxWidth: 780,
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
          style={{ padding: "36px 40px 48px" }}
          data-testid="pm-page"
        >
          {print && <AutoPrint />}
          <div className="oi-eyebrow">{term}</div>
          <h1
            style={{
              margin: "8px 0 0",
              fontFamily: "var(--title)",
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: "-.02em",
              lineHeight: 1.15,
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
              <h2 style={h2}>{sectionTitle(s, t)}</h2>
              {s.body.trim() ? (
                <div
                  className="oi-prose"
                  style={{ fontSize: 15, lineHeight: 1.7, maxWidth: "none" }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(s.body) }}
                />
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: "var(--ink-3)", fontStyle: "italic" }}>
                  {t("postMortem.emptySection")}
                </p>
              )}
            </section>
          ))}
          {decisions.length > 0 && (
            <section style={{ marginBottom: 22 }}>
              <h2 style={h2}>{t("incv2.pm.decisions")}</h2>
              {decisions.map((d) => {
                const p = d.payload as { title?: string; why?: string };
                return (
                  <div
                    key={d.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "52px minmax(0,1fr)",
                      gap: 12,
                      padding: "9px 0",
                      borderBottom: "1px solid var(--line-2)",
                    }}
                  >
                    <span
                      style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--ink-3)" }}
                    >
                      {t.fmt.time(d.occurredAt, t.timeZone)}
                    </span>
                    <div style={{ fontSize: 14.5, lineHeight: 1.6 }}>
                      <strong>{p.title}.</strong>{" "}
                      <span style={{ color: "var(--ink-2)" }}>
                        {d.actorName ?? "—"}
                        {p.why ? ` — ${p.why}` : ""}
                      </span>
                    </div>
                  </div>
                );
              })}
            </section>
          )}
          <div style={{ marginBottom: 22 }}>
            <WhatAtlasDid tenantId={tenant.id} incidentId={inc.row.id} />
          </div>
          {inc.followUps.length > 0 && (
            <section>
              <h2 style={h2}>{t("incident.tab.followUps")}</h2>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 20,
                  fontSize: 15,
                  color: "var(--ink)",
                  lineHeight: 1.7,
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
