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
import { getT, type Translate } from "@/i18n/server";
import type { IncidentDetail } from "@/lib/incidents";
import type { InvestigationAccess } from "@/lib/investigations";
import { listAtlasActions, type AtlasActionRow } from "@/lib/atlas/queries";
import { memberNames } from "@/components/atlas/data";
import { approverOf, fixName } from "@/components/atlas/words";
import { InvestigationLive } from "./investigation-live";
import { investigationToPostMortem, rerunInvestigation } from "./investigation-actions";
import { AtlasRcaReject } from "./atlas-rca-reject";

const CONFIDENCE_TONE: Record<Confidence, { bg: string; ink: string }> = {
  speculation: { bg: "var(--sunk)", ink: "var(--ink-3)" },
  plausible: { bg: "var(--wait-t)", ink: "var(--wait)" },
  likely: { bg: "var(--open-t)", ink: "var(--open)" },
  strong: { bg: "var(--ok-t)", ink: "var(--ok)" },
  validated: { bg: "var(--ok-t)", ink: "var(--ok)" },
};

const panel: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};
const eyebrow: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};
const btn: React.CSSProperties = {
  height: 34,
  padding: "0 13px",
  border: "1px solid var(--line)",
  borderRadius: 9,
  background: "var(--panel)",
  display: "flex",
  alignItems: "center",
  fontSize: 13,
  fontWeight: 600,
  color: "inherit",
  cursor: "pointer",
  fontFamily: "inherit",
};
const cite: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 10.5,
  color: "var(--ink-3)",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "2px 7px",
  textDecoration: "none",
  maxWidth: "100%",
};

/** One chip per piece of evidence: "from E1 · deploy CHG-84 · open". */
function Citations({ ids, map, t }: { ids: string[]; map: Map<string, Citation>; t: Translate }) {
  return (
    <>
      {ids.map((id) => {
        const c = map.get(id);
        const label = c ? `${id} · ${c.label}` : id;
        return (
          <span key={id} style={cite}>
            {t("atlas.ui.rca.from")}{" "}
            <span
              title={label}
              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {label}
            </span>
            {c?.url && (
              <>
                ·{" "}
                <a
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--brand)", fontWeight: 600, textDecoration: "none" }}
                >
                  {t("inc2.rca.open")}
                </a>
              </>
            )}
          </span>
        );
      })}
    </>
  );
}

function setAsideWhy(h: Hypothesis, t: Translate): string {
  return h.state === "contradicted"
    ? t("ai.investigation.state.contradicted")
    : h.findings.length === 0
      ? t("ai.investigation.state.unsupported")
      : t("ai.investigation.state.flagged");
}

/**
 * "H1 guided the run." — what the leading hypothesis led Atlas to do, read off
 * the journal: the system action it drove, who approved it or that Atlas ran
 * it alone, and the verification that confirmed it.
 */
function guidedSentence(
  t: Translate,
  actions: AtlasActionRow[],
  names: Map<string, string>,
): string | null {
  if (actions.length === 0) return null;
  const sys =
    actions.find((a) => a.kind === "system" && a.executedAt) ??
    actions.find((a) => a.kind === "system") ??
    null;
  const time = (d: Date) => t.fmt.time(d, t.timeZone);
  if (!sys) return t("atlas.ui.rca.guidedSteps", { count: actions.length });
  const approver = approverOf(actions, sys, names);
  let s =
    sys.approvalState === "waiting"
      ? t("atlas.ui.rca.guidedWaiting", { title: fixName(sys), time: time(sys.at) })
      : approver
        ? t("atlas.ui.rca.guidedApproved", {
            title: fixName(sys),
            time: time(sys.at),
            name: approver,
          })
        : sys.autonomous
          ? t("atlas.ui.rca.guidedAlone", {
              title: fixName(sys),
              time: time(sys.executedAt ?? sys.at),
            })
          : t("atlas.ui.rca.guided", { title: fixName(sys), time: time(sys.at) });
  const verified = actions.find((a) => a.verifiedAt)?.verifiedAt;
  if (verified) s += ` ${t("atlas.ui.rca.verified", { time: time(verified) })}`;
  return s;
}

/**
 * The Root cause analysis tab: the surviving hypothesis in full, the findings
 * that hold it up with their citations, and what the adversarial pass could
 * not break. Above it, when Atlas acted, what that hypothesis led it to do.
 * Three things a person does here — accept it into the post-mortem, reject it
 * with a reason (the reason becomes cited evidence and the analysis runs
 * again), or ask for another pass. The grade after closure lives on the
 * Atlas tab, with the run it judges.
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
  const citations = new Map<string, Citation>((inv?.citations ?? []).map((c) => [c.id, c]));
  const top = inv?.hypotheses.find((h) => h.id === inv.summary?.topHypothesisId) ?? null;
  const others = (inv?.hypotheses ?? []).filter((h) => h.id !== top?.id);
  // Every finding, the ones holding up the leading hypothesis first. Filtering
  // to that hypothesis hid the rest — and the one a responder's own steering
  // note produced is attached to no hypothesis, so the reader lost exactly the
  // finding they had asked for.
  const findings = inv
    ? [...inv.findings].sort((a, b) => {
        const supports = (f: (typeof inv.findings)[number]) =>
          top && top.findings.includes(f.id) ? 0 : 1;
        return supports(a) - supports(b);
      })
    : [];
  const challenges = (inv?.hypotheses ?? []).filter((h) => h.challenge);
  const objections = (inv?.hypotheses ?? []).filter((h) => h.state === "contradicted").length;
  const rcaSection = inc.postMortem?.sections.find((s) => s.key === "root_cause");
  const written = Boolean(rcaSection?.body.trim());
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

  if (!access.ok || !inv || inv.runs === 0)
    return (
      <div
        data-testid="rca"
        style={{
          ...panel,
          padding: "18px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          animation: "oi-rise .16s ease backwards",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={eyebrow}>✦ {t("ai.investigation.title")}</span>
          {/*
            Here too, not only once an assessment exists. This is the card
            someone is looking at when they ask for the first one, and without
            the live refresh the answer lands in the database while the screen
            still says there is nothing.
          */}
          {access.ok && (
            <InvestigationLive
              incidentId={inc.row.id}
              lastEventId={inc.events.at(-1)?.id ?? ""}
              running={running}
              label={t("ai.investigation.refreshing")}
            />
          )}
          <span style={{ flex: 1 }} />
          {acts && (
            <form action={rerunInvestigation} style={{ display: "contents" }}>
              <input type="hidden" name="number" value={number} />
              <button
                type="submit"
                data-testid="rca-rerun"
                className="oi-hover-brand-2"
                style={{
                  ...btn,
                  background: "var(--viol)",
                  borderColor: "var(--viol)",
                  color: "var(--on-brand)",
                }}
              >
                {t("ai.investigation.start")}
              </button>
            </form>
          )}
        </div>
        <p
          style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-2)" }}
          data-testid={access.ok ? undefined : "rca-unavailable"}
        >
          {!access.ok
            ? access.reason === "edition"
              ? t("ai.investigation.unavailableEdition")
              : t(`ai.refusal.${access.reason}`)
            : running
              ? t("ai.investigation.status.running")
              : t("ai.investigation.empty")}
        </p>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: "var(--ink-3)" }}>
          {t("ai.investigation.lead")}
        </p>
      </div>
    );

  const journal = await listAtlasActions(tenantId, inc.row.id);
  const names = await memberNames(
    tenantId,
    journal.map((a) => a.approvedByMemberId),
  );
  const guided = top ? guidedSentence(t, journal, names) : null;

  return (
    <div
      data-testid="rca"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 14,
        alignItems: "flex-start",
        animation: "oi-rise .16s ease backwards",
      }}
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
        {top && guided && (
          <Link
            href={`/app/incidents/${number}?tab=atlas`}
            data-testid="rca-guided"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              background: "var(--viol-t)",
              borderRadius: 12,
              padding: "10px 14px",
              cursor: "pointer",
              color: "var(--ink)",
              textDecoration: "none",
            }}
          >
            <span style={{ color: "var(--viol)" }}>✦</span>
            <span style={{ flex: "1 1 300px", fontSize: 12.5, lineHeight: 1.5 }}>
              <strong>{t("atlas.ui.rca.guidedLead", { id: top.id })}</strong> {guided}
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--viol)",
                whiteSpace: "nowrap",
              }}
            >
              {t("atlas.ui.rca.toAtlas")}
            </span>
          </Link>
        )}
        <div
          data-testid="rca-summary"
          style={{
            background: "var(--panel)",
            border: "1.5px solid var(--viol)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-card-hover)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 18px",
              borderBottom: "1px solid var(--line)",
              background: "var(--viol-t)",
              flexWrap: "wrap",
            }}
          >
            <span style={{ ...eyebrow, color: "var(--viol)" }}>
              ✦ {top ? t("inc2.rca.hypothesis", { id: top.id }) : t("ai.investigation.title")}
            </span>
            {top && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  borderRadius: 5,
                  padding: "1px 6px",
                  background: CONFIDENCE_TONE[top.confidence].bg,
                  color: CONFIDENCE_TONE[top.confidence].ink,
                }}
              >
                {t("inc2.rca.confidence", {
                  level: t(`ai.investigation.confidence.${top.confidence}`),
                })}
              </span>
            )}
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "var(--ink-2)",
                background: "var(--panel)",
                borderRadius: 5,
                padding: "1px 6px",
              }}
            >
              {t("inc2.rca.gradeAfter", {
                grade: inv.grade
                  ? t(`ai.investigation.grade.${inv.grade}`).toLowerCase()
                  : t("inc2.rca.notGraded"),
              })}
            </span>
            <span style={{ flex: 1 }} />
            {(running || inv.paused || inv.status === "failed") && (
              <span
                data-testid="rca-status"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: statusInk,
                }}
              >
                <span
                  aria-hidden
                  style={{ width: 6, height: 6, borderRadius: "50%", background: statusInk }}
                />
                {inv.paused && !running
                  ? t("ai.investigation.paused")
                  : t(`ai.investigation.status.${inv.status}`)}
              </span>
            )}
            <InvestigationLive
              incidentId={inc.row.id}
              lastEventId={inc.events.at(-1)?.id ?? ""}
              running={running}
              label={t("ai.investigation.refreshing")}
            />
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              {t("inc2.rca.at", {
                when: inv.completedAt ? t.fmt.dateTime(inv.completedAt, t.timeZone) : "—",
              })}
            </span>
          </div>
          <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div
              style={{
                fontFamily: "var(--title)",
                fontSize: 18,
                fontWeight: 600,
                letterSpacing: "-.01em",
                lineHeight: 1.35,
              }}
            >
              {top?.whatBroke ?? t("ai.investigation.noCause")}
            </div>
            {top?.why && (
              <div style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--ink-2)" }}>
                {top.why}
              </div>
            )}
            {inv.error && (
              <div style={{ fontSize: 13, color: "var(--dang)" }}>
                {t("ai.investigation.error", { error: inv.error })}
              </div>
            )}
            {written && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: "var(--ok-t)",
                  borderRadius: 10,
                  padding: "9px 12px",
                  fontSize: 12.5,
                  color: "var(--ok)",
                  fontWeight: 600,
                }}
              >
                <span
                  style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--ok)" }}
                />
                {t("atlas.ui.rca.accepted")}
              </div>
            )}
            {/*
              Accepting the cause into the post-mortem used to take every
              control with it, "another pass" included: an assessment written
              once was frozen, and evidence arriving afterwards had nowhere to
              go. The banner says it was written; asking for another pass is
              still allowed.
            */}
            {acts && (
              <AtlasRcaReject
                number={number}
                hasTop={Boolean(top)}
                labels={{
                  reject: t("atlas.ui.rca.reject"),
                  placeholder: t("ai.investigation.steerPlaceholder"),
                  hint: t("ai.investigation.steerHint"),
                  submit: t("ai.investigation.steerSubmit"),
                }}
              >
                {top && afterResolution && !written && (
                  <form action={investigationToPostMortem} style={{ display: "contents" }}>
                    <input type="hidden" name="number" value={number} />
                    <button
                      type="submit"
                      data-testid="rca-to-pm"
                      style={{
                        ...btn,
                        padding: "0 15px",
                        border: 0,
                        background: "var(--viol)",
                        color: "#fff",
                      }}
                    >
                      {t("atlas.ui.rca.accept")}
                    </button>
                  </form>
                )}
              </AtlasRcaReject>
            )}
          </div>
        </div>

        <div style={{ ...panel, overflow: "hidden" }} data-testid="rca-findings">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 18px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t("ai.investigation.findings")}</span>
            <span style={{ fontSize: 11.5, color: "var(--ink-3)", marginLeft: 10 }}>
              {t("inc2.rca.findingsHint")}
            </span>
          </div>
          {findings.length === 0 && (
            <div style={{ padding: "12px 18px", fontSize: 12.5, color: "var(--ink-3)" }}>
              {t("ai.investigation.findingsNone")}
            </div>
          )}
          {findings.map((f) => (
            <div
              key={f.id}
              data-testid="rca-finding"
              style={{
                display: "grid",
                gridTemplateColumns: "34px minmax(0,1fr)",
                gap: 12,
                padding: "12px 18px",
                borderBottom: "1px solid var(--line-2)",
              }}
            >
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: "var(--viol-t)",
                  color: "var(--viol)",
                  display: "grid",
                  placeItems: "center",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {f.id}
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, lineHeight: 1.5 }}>
                  {f.statement}
                </span>
                <span
                  style={{
                    display: "flex",
                    gap: 5,
                    flexWrap: "wrap",
                    marginTop: 6,
                    alignItems: "center",
                  }}
                >
                  {f.citations.length === 0 ? (
                    <span style={cite}>
                      {t("inc2.rca.from", { source: t(`ai.investigation.check.${f.check}`) })}
                    </span>
                  ) : (
                    <Citations ids={f.citations} map={citations} t={t} />
                  )}
                </span>
              </span>
            </div>
          ))}
        </div>

        <div
          style={{
            ...panel,
            padding: "14px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t("inc2.rca.challenger")}</span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                borderRadius: 5,
                padding: "1px 6px",
                background: objections ? "var(--wait-t)" : "var(--ok-t)",
                color: objections ? "var(--wait)" : "var(--ok)",
              }}
            >
              {objections
                ? t("inc2.rca.objections", { count: objections })
                : t("inc2.rca.noObjection")}
            </span>
          </div>
          {challenges.length === 0 ? (
            <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--ink-2)" }}>
              {t("inc2.rca.challengerNone")}
            </div>
          ) : (
            challenges.map((h) => (
              <div
                key={h.id}
                data-testid="rca-review"
                style={{ fontSize: 13, lineHeight: 1.6, color: "var(--ink-2)" }}
              >
                <span style={{ fontWeight: 600, color: "var(--ink)" }}>{h.id}</span> {h.challenge}
                {h.challengeCitations.length > 0 && (
                  <span style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 5 }}>
                    <Citations ids={h.challengeCitations} map={citations} t={t} />
                  </span>
                )}
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
            gap: 9,
          }}
          data-testid="rca-grade"
        >
          <div style={eyebrow}>{t("inc2.rca.howToRead")}</div>
          <Row
            k={t("ai.investigation.confidenceLabel")}
            v={
              top
                ? t("inc2.rca.findingsAgree", {
                    level: t(`ai.investigation.confidence.${top.confidence}`),
                    count: findings.filter((f) => top.findings.includes(f.id)).length,
                  })
                : "—"
            }
          />
          <Row
            k={t("atlas.ui.rca.challengerShort")}
            v={
              objections
                ? t("atlas.ui.rca.rejectedCount", { count: objections })
                : t("inc2.rca.noObjection")
            }
          />
          <Row
            k={t("atlas.ui.rca.gradeShort")}
            v={
              inv.grade
                ? `${t(`ai.investigation.grade.${inv.grade}`).toLowerCase()}${
                    inv.gradeNote
                      ? ` — ${inv.gradeNote}`
                      : row?.graderName
                        ? ` · ${row.graderName}`
                        : ""
                  }`
                : t("inc2.rca.notGraded")
            }
          />
          <div
            style={{
              fontSize: 11.5,
              color: "var(--ink-3)",
              lineHeight: 1.5,
              borderTop: "1px solid var(--line-2)",
              paddingTop: 8,
            }}
          >
            {t("atlas.ui.rca.gradeNote")}
          </div>
        </div>

        {others.length > 0 && (
          <div
            style={{
              ...panel,
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={eyebrow}>{t("atlas.ui.rca.rejected")}</div>
            {others.map((h) => (
              <div key={h.id} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                <span style={{ fontWeight: 600 }}>{h.id}</span> {h.whatBroke}{" "}
                {h.state !== "open" && (
                  <span style={{ color: "var(--ink-3)" }}>· {setAsideWhy(h, t)}</span>
                )}
              </div>
            ))}
          </div>
        )}

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
          {t("atlas.ui.rca.footer")}
          {written && (
            <>
              {" "}
              <Link
                href={`/app/incidents/${number}?tab=post-incident`}
                className="oi-link"
                style={{ fontWeight: 600 }}
              >
                {t("inc2.postMortemLink")}
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
      <span style={{ color: "var(--ink-2)" }}>{k}</span>
      <span style={{ fontWeight: 600, textAlign: "right" }}>{v}</span>
    </div>
  );
}
