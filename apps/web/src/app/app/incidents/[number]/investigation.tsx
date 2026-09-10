import Link from "next/link";
import { eq } from "drizzle-orm";
import {
  investigations,
  members,
  withTenant,
  type Citation,
  type Confidence,
  type Hypothesis,
} from "@openincident/db";
import { getT } from "@/i18n/server";
import type { Translate } from "@/i18n/server";
import type { IncidentDetail } from "@/lib/incidents";
import type { InvestigationAccess } from "@/lib/investigations";
import { AiBadge } from "@/components/ai-badge";
import { InvestigationLive } from "./investigation-live";
import {
  addInvestigationNote,
  gradeInvestigation,
  investigationToPostMortem,
  rerunInvestigation,
  toggleInvestigationPause,
} from "./investigation-actions";

const CONFIDENCE: Confidence[] = ["speculation", "plausible", "likely", "strong", "validated"];
const CONFIDENCE_INK: Record<Confidence, string> = {
  speculation: "var(--ink-3)",
  plausible: "var(--wait)",
  likely: "var(--brand)",
  strong: "var(--ok)",
  validated: "var(--ok)",
};

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 13,
  padding: "16px 18px",
  boxShadow: "var(--shadow-card)",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
const muted: React.CSSProperties = { fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5 };
const body: React.CSSProperties = {
  margin: 0,
  fontSize: 13.5,
  lineHeight: 1.55,
  color: "var(--ink-2)",
  textWrap: "pretty",
};
const btn: React.CSSProperties = {
  height: 34,
  padding: "0 13px",
  border: "1px solid var(--line)",
  borderRadius: 9,
  background: "var(--panel)",
  fontSize: 13,
  fontWeight: 500,
  color: "inherit",
  cursor: "pointer",
};
const btnPrimary: React.CSSProperties = {
  ...btn,
  background: "var(--brand)",
  borderColor: "var(--brand)",
  color: "#fff",
  fontWeight: 600,
};
const chip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  padding: "1px 7px",
  borderRadius: 6,
  border: "1px solid var(--line)",
  background: "var(--sunk)",
  color: "var(--ink-2)",
  textDecoration: "none",
  maxWidth: 260,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

function ConfidenceMeter({ value, t }: { value: Confidence; t: Translate }) {
  const rank = CONFIDENCE.indexOf(value);
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
      title={t("ai.investigation.confidenceLabel")}
    >
      <span style={{ display: "inline-flex", gap: 2 }} aria-hidden="true">
        {CONFIDENCE.map((c, i) => (
          <span
            key={c}
            style={{
              width: 12,
              height: 6,
              borderRadius: 2,
              background: i <= rank ? CONFIDENCE_INK[value] : "var(--line)",
            }}
          />
        ))}
      </span>
      <span style={{ fontSize: 12, fontWeight: 600, color: CONFIDENCE_INK[value] }}>
        {t(`ai.investigation.confidence.${value}`)}
      </span>
    </span>
  );
}

function CitationChip({ id, cite }: { id: string; cite: Map<string, Citation> }) {
  const c = cite.get(id);
  const label = c ? `${id} · ${c.label}` : id;
  if (c?.url)
    return (
      <a href={c.url} target="_blank" rel="noreferrer" style={chip} title={label}>
        {label}
      </a>
    );
  return (
    <span style={chip} title={label}>
      {label}
    </span>
  );
}

function StateBadge({ h, t }: { h: Hypothesis; t: Translate }) {
  if (h.state === "open") return null;
  const contradicted = h.state === "contradicted";
  const label = contradicted
    ? t("ai.investigation.state.contradicted")
    : h.findings.length === 0
      ? t("ai.investigation.state.unsupported")
      : t("ai.investigation.state.flagged");
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: ".04em",
        padding: "1px 7px",
        borderRadius: 999,
        background: contradicted ? "var(--dang-t)" : "var(--wait-t)",
        color: contradicted ? "var(--dang)" : "var(--wait)",
      }}
    >
      {label}
    </span>
  );
}

/**
 * The root cause analysis (RCA) tab: what is going on, what caused it, what to
 * do — then the hypotheses with their confidence and the reviewer's objections,
 * the findings and the evidence they cite, the checks that ran, and the three
 * things a person does here: steer, grade, and send the cause to the post-mortem.
 */
export async function Investigation({
  tenantId,
  inc,
  number,
  canAct,
  access,
}: {
  tenantId: string;
  inc: IncidentDetail;
  number: number;
  canAct: boolean;
  access: InvestigationAccess;
}) {
  const t = await getT();
  const row = await withTenant(tenantId, async (tx) => {
    const [r] = await tx
      .select({ inv: investigations, graderName: members.name })
      .from(investigations)
      .leftJoin(members, eq(members.id, investigations.gradedByMemberId))
      .where(eq(investigations.incidentId, inc.row.id));
    return r ?? null;
  });
  const inv = row?.inv ?? null;
  const running = inv?.status === "queued" || inv?.status === "running";
  const lastEventId = inc.events.at(-1)?.id ?? "";
  const cite = new Map<string, Citation>((inv?.citations ?? []).map((c) => [c.id, c]));
  const top = inv?.hypotheses.find((h) => h.id === inv.summary?.topHypothesisId) ?? null;
  const rcaSection = inc.postMortem?.sections.find((s) => s.key === "root_cause");
  const afterResolution = inc.row.phase === "post_incident" || inc.row.phase === "closed";
  const acts = canAct && access.ok;

  const statusInk =
    inv?.status === "failed"
      ? "var(--dang)"
      : running
        ? "var(--viol)"
        : inv?.paused
          ? "var(--ink-3)"
          : "var(--ok)";

  return (
    <div
      className="oi-rise"
      style={{ maxWidth: 860, display: "flex", flexDirection: "column", gap: 14 }}
      data-testid="rca"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-title)",
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: "-.01em",
          }}
        >
          {t("ai.investigation.title")}
        </h2>
        <AiBadge />
        {inv && (
          <span
            data-testid="rca-status"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              color: statusInk,
            }}
          >
            <span
              style={{ width: 7, height: 7, borderRadius: "50%", background: statusInk }}
              aria-hidden="true"
            />
            {inv.paused && !running
              ? t("ai.investigation.paused")
              : t(`ai.investigation.status.${inv.status}`)}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {inv && (
          <InvestigationLive
            incidentId={inc.row.id}
            lastEventId={lastEventId}
            running={running}
            label={t("ai.investigation.refreshing")}
          />
        )}
        {acts && inv && inv.runs > 0 && (
          <form action={toggleInvestigationPause} style={{ display: "contents" }}>
            <input type="hidden" name="number" value={number} />
            <input type="hidden" name="paused" value={inv.paused ? "0" : "1"} />
            <button type="submit" style={btn} data-testid="rca-pause">
              {inv.paused ? t("ai.investigation.resume") : t("ai.investigation.pause")}
            </button>
          </form>
        )}
        {acts && !running && (
          <form action={rerunInvestigation} style={{ display: "contents" }}>
            <input type="hidden" name="number" value={number} />
            <button type="submit" style={btnPrimary} data-testid="rca-rerun">
              {inv && inv.runs > 0 ? t("ai.investigation.rerun") : t("ai.investigation.start")}
            </button>
          </form>
        )}
      </div>
      <p style={{ ...body, fontSize: 13, color: "var(--ink-3)" }}>{t("ai.investigation.lead")}</p>

      {!access.ok && (
        <div style={card} data-testid="rca-unavailable">
          <p style={body}>
            {access.reason === "edition"
              ? t("ai.investigation.unavailableEdition")
              : t(`ai.refusal.${access.reason}`)}
          </p>
        </div>
      )}

      {access.ok && !inv && (
        <div style={card}>
          <p style={body}>{t("ai.investigation.empty")}</p>
        </div>
      )}

      {inv && (
        <div style={{ ...muted, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span>{t("ai.investigation.runs", { count: inv.runs })}</span>
          <span>·</span>
          <span>{t(`ai.investigation.trigger.${inv.trigger}`)}</span>
          {inv.completedAt && (
            <>
              <span>·</span>
              <span>
                {t("ai.investigation.updatedAt", { when: t.fmt.relative(inv.completedAt) })}
              </span>
            </>
          )}
        </div>
      )}

      {inv?.error && (
        <div style={{ ...card, borderColor: "var(--dang)", color: "var(--dang)" }}>
          <span style={{ fontSize: 13 }}>{t("ai.investigation.error", { error: inv.error })}</span>
        </div>
      )}

      {inv && inv.runs > 0 && (
        <>
          {inv.triage && (
            <div
              style={{ ...card, flexDirection: "row", gap: 24, flexWrap: "wrap" }}
              data-testid="rca-triage"
            >
              <div style={{ minWidth: 120 }}>
                <div className="oi-eyebrow">{t("ai.investigation.triage.severityHint")}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, marginTop: 3 }}>
                  {inv.triage.severityHint ?? "—"}
                </div>
              </div>
              <div style={{ minWidth: 140 }}>
                <div className="oi-eyebrow">{t("ai.investigation.triage.escalate")}</div>
                <div
                  style={{
                    fontSize: 13,
                    marginTop: 3,
                    fontWeight: 600,
                    color: inv.triage.escalate ? "var(--dang)" : "var(--ok)",
                  }}
                >
                  {inv.triage.escalate
                    ? t("ai.investigation.triage.escalateYes")
                    : t("ai.investigation.triage.escalateNo")}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div className="oi-eyebrow">{t("ai.investigation.triage.scope")}</div>
                <div style={{ fontSize: 13, marginTop: 3, color: "var(--ink-2)" }}>
                  {inv.triage.scope || "—"}
                  {inv.triage.rationale ? ` — ${inv.triage.rationale}` : ""}
                </div>
              </div>
            </div>
          )}

          <div style={card} data-testid="rca-summary">
            <div>
              <div className="oi-eyebrow">{t("ai.investigation.whatsGoingOn")}</div>
              <p style={{ ...body, marginTop: 4, fontSize: 14, color: "var(--ink)" }}>
                {inv.summary?.whatsGoingOn || inc.row.name}
              </p>
            </div>
            <div>
              <div className="oi-eyebrow">{t("ai.investigation.whatCaused")}</div>
              {inv.summary?.whatCaused && top ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                  <p style={{ ...body, fontSize: 14, color: "var(--ink)" }}>
                    {inv.summary.whatCaused}
                  </p>
                  <ConfidenceMeter value={top.confidence} t={t} />
                </div>
              ) : (
                <p style={{ ...body, marginTop: 4 }}>{t("ai.investigation.noCause")}</p>
              )}
            </div>
            <div>
              <div className="oi-eyebrow">{t("ai.investigation.nextSteps")}</div>
              {inv.summary?.nextSteps.length ? (
                <ul style={{ margin: "4px 0 0", paddingLeft: 18, ...body }}>
                  {inv.summary.nextSteps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              ) : (
                <p style={{ ...body, marginTop: 4 }}>—</p>
              )}
            </div>
            {inv.blastRadius && (
              <div>
                <div className="oi-eyebrow">{t("ai.investigation.blastRadius")}</div>
                <p style={{ ...body, marginTop: 4 }}>{inv.blastRadius}</p>
              </div>
            )}
          </div>

          <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{t("ai.investigation.hypotheses")}</div>
            {inv.hypotheses.length === 0 && <p style={muted}>{t("ai.investigation.noCause")}</p>}
            {inv.hypotheses.map((h) => (
              <article
                key={h.id}
                data-testid="rca-hypothesis"
                style={{
                  ...card,
                  opacity: h.state === "contradicted" ? 0.72 : 1,
                  borderColor:
                    h.id === top?.id ? "var(--brand-border, var(--line))" : "var(--line)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span
                    style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)" }}
                  >
                    {h.id}
                  </span>
                  <ConfidenceMeter value={h.confidence} t={t} />
                  <StateBadge h={h} t={t} />
                </div>
                <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.005em" }}>
                  {h.whatBroke}
                </div>
                <p style={body}>{h.why}</p>
                {h.findings.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={muted}>{t("ai.investigation.restsOn")}</span>
                    {h.findings.map((fid) => {
                      const f = inv.findings.find((x) => x.id === fid);
                      return (
                        <span key={fid} style={chip} title={f?.statement ?? fid}>
                          {fid}
                        </span>
                      );
                    })}
                  </div>
                )}
                {h.challenge && (
                  <blockquote
                    style={{
                      margin: 0,
                      padding: "8px 12px",
                      borderLeft: `3px solid ${h.state === "contradicted" ? "var(--dang)" : "var(--wait)"}`,
                      background: "var(--sunk)",
                      borderRadius: "0 8px 8px 0",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: ".04em",
                        color: "var(--ink-3)",
                      }}
                    >
                      {t("ai.investigation.challenge")}
                    </span>
                    <span style={{ ...body, fontSize: 13 }}>{h.challenge}</span>
                    {h.challengeCitations.length > 0 && (
                      <span style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {h.challengeCitations.map((id) => (
                          <CitationChip key={id} id={id} cite={cite} />
                        ))}
                      </span>
                    )}
                  </blockquote>
                )}
                {h.nextSteps.length > 0 && (
                  <ul style={{ margin: 0, paddingLeft: 18, ...body, fontSize: 13 }}>
                    {h.nextSteps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </section>

          <section style={{ ...card, gap: 8 }} data-testid="rca-findings">
            <div style={{ fontSize: 13, fontWeight: 600 }}>{t("ai.investigation.findings")}</div>
            {inv.findings.length === 0 && <p style={muted}>{t("ai.investigation.findingsNone")}</p>}
            {inv.findings.map((f) => (
              <div
                key={f.id}
                data-testid="rca-finding"
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  paddingTop: 8,
                  borderTop: "1px solid var(--line-2)",
                }}
              >
                <span style={{ ...chip, flex: "none" }}>{f.id}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--ink-3)",
                      letterSpacing: ".02em",
                    }}
                  >
                    {t(`ai.investigation.check.${f.check}`)}
                  </span>
                  <span style={{ ...body, fontSize: 13 }}>{f.statement}</span>
                  <span style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ ...muted, fontSize: 11.5 }}>{t("ai.investigation.cites")}</span>
                    {f.citations.map((id) => (
                      <CitationChip key={id} id={id} cite={cite} />
                    ))}
                  </span>
                </div>
              </div>
            ))}
          </section>

          <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-3)" }}>
              {t("ai.investigation.checks")}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {inv.checks.map((c) => (
                <span
                  key={c.kind}
                  title={c.note ?? undefined}
                  style={{
                    ...chip,
                    fontFamily: "inherit",
                    fontSize: 12,
                    color:
                      c.status === "failed"
                        ? "var(--dang)"
                        : c.status === "skipped"
                          ? "var(--ink-3)"
                          : "var(--ink-2)",
                    textDecoration: c.status === "skipped" ? "line-through" : "none",
                  }}
                >
                  {t(`ai.investigation.check.${c.kind}`)} ·{" "}
                  {c.status === "done"
                    ? t("ai.investigation.checkStatus.done", { count: c.count })
                    : t(`ai.investigation.checkStatus.${c.status}`)}
                </span>
              ))}
            </div>
          </section>
        </>
      )}

      {acts && inv && (
        <section style={card} data-testid="rca-steer">
          <div style={{ fontSize: 13, fontWeight: 600 }}>{t("ai.investigation.steer")}</div>
          <p style={muted}>{t("ai.investigation.steerHint")}</p>
          {inv.notes.length > 0 && (
            <ul
              style={{
                margin: 0,
                paddingLeft: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {inv.notes.slice(-5).map((n) => (
                <li key={n.id} style={{ ...body, fontSize: 12.5 }}>
                  <span style={{ fontWeight: 600 }}>{n.memberName}</span>
                  <span style={{ color: "var(--ink-3)" }}>
                    {" "}
                    · {t.fmt.relative(new Date(n.at))} —{" "}
                  </span>
                  {n.body}
                </li>
              ))}
            </ul>
          )}
          <form
            action={addInvestigationNote}
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
            data-testid="rca-note-form"
          >
            <input type="hidden" name="number" value={number} />
            <textarea
              name="body"
              required
              minLength={3}
              maxLength={2000}
              rows={2}
              placeholder={t("ai.investigation.steerPlaceholder")}
              style={{
                width: "100%",
                boxSizing: "border-box",
                border: "1px solid var(--line)",
                borderRadius: 9,
                padding: "8px 10px",
                fontSize: 13,
                fontFamily: "inherit",
                background: "var(--panel)",
                color: "inherit",
                resize: "vertical",
              }}
            />
            <div>
              <button type="submit" style={btn} disabled={running}>
                {t("ai.investigation.steerSubmit")}
              </button>
            </div>
          </form>
        </section>
      )}

      {acts && inv && top && afterResolution && (
        <section
          style={{ ...card, flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}
        >
          {rcaSection?.body.trim() ? (
            <span style={muted}>{t("ai.investigation.toPostMortemDone")}</span>
          ) : (
            <>
              <form action={investigationToPostMortem} style={{ display: "contents" }}>
                <input type="hidden" name="number" value={number} />
                <button type="submit" style={btn} data-testid="rca-to-pm">
                  {t("ai.investigation.toPostMortem")}
                </button>
              </form>
              <span style={muted}>{t("ai.investigation.toPostMortemNote")}</span>
            </>
          )}
          <span style={{ flex: 1 }} />
          <Link
            href={`/app/incidents/${number}?tab=post-incident`}
            className="oi-link"
            style={{ fontSize: 12.5 }}
          >
            {t("incident.tab.postIncident")} →
          </Link>
        </section>
      )}

      {acts && inv && inv.runs > 0 && afterResolution && (
        <section style={card} data-testid="rca-grade">
          <div style={{ fontSize: 13, fontWeight: 600 }}>{t("ai.investigation.grade")}</div>
          {inv.grade ? (
            <p style={body}>
              {t("ai.investigation.gradedBy", {
                grade: t(`ai.investigation.grade.${inv.grade}`),
                actor: row?.graderName ?? "—",
                when: inv.gradedAt ? t.fmt.relative(inv.gradedAt) : "",
              })}
              {inv.gradeNote ? ` — ${inv.gradeNote}` : ""}
            </p>
          ) : (
            <>
              <p style={muted}>{t("ai.investigation.gradeHint")}</p>
              <form
                action={gradeInvestigation}
                style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
              >
                <input type="hidden" name="number" value={number} />
                <input
                  name="note"
                  maxLength={1000}
                  placeholder={t("ai.investigation.gradeNotePlaceholder")}
                  style={{
                    flex: "1 1 220px",
                    height: 34,
                    border: "1px solid var(--line)",
                    borderRadius: 9,
                    padding: "0 10px",
                    fontSize: 13,
                    background: "var(--panel)",
                    color: "inherit",
                  }}
                />
                {(["bullseye", "on_target", "miss", "nowhere_near"] as const).map((g) => (
                  <button key={g} type="submit" name="grade" value={g} style={btn}>
                    {t(`ai.investigation.grade.${g}`)}
                  </button>
                ))}
              </form>
            </>
          )}
        </section>
      )}

      {inv && inv.runs > 0 && (
        <p style={{ ...muted, fontSize: 12 }}>
          {t("ai.investigation.footer", {
            model: inv.model ?? "—",
            provider: inv.provider ?? "—",
          })}
        </p>
      )}
    </div>
  );
}
