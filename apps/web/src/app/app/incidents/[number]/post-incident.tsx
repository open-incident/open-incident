import Link from "next/link";
import { withTenant, type PostMortemTemplateSection } from "@openincident/db";
import { getT } from "@/i18n/server";
import type { IncidentDetail } from "@/lib/incidents";
import {
  contributors,
  documentMarkdown,
  documentTitle,
  followUpsMarkdown,
  impactMarkdown,
  loadHistory,
  sectionHint,
  sectionTitle,
  timelineMarkdown,
} from "@/lib/post-mortem";
import { listAtlasActions } from "@/lib/atlas/queries";
import { WhatAtlasDid } from "@/components/atlas/what-atlas-did";
import { avatarTone, initials } from "@/lib/avatar";
import { priorityTone } from "@/lib/tones";
import { toggleFollowUp } from "../follow-up-actions";
import { ExportFollowUp } from "../export-follow-up";
import { toggleTask } from "./actions";
import { AddFollowUp } from "./add-follow-up";
import { draftPostMortemAction, setPostMortemStatus } from "./ai-actions";
import { exportPostMortemAction } from "./docs-actions";
import { restorePostMortemRevision, reviewPostMortemAction, startPostMortem } from "./pm-actions";
import {
  CommentScope,
  PmBlock,
  ScopeCommentButton,
  ScopeNotes,
  SectionEditor,
  type SectionComment,
} from "./section-editor";
import { PmTitle } from "./pm-title";
import { PmSide } from "./pm-side";
import { PmCopy } from "./pm-copy";
import { ReadingNow } from "./reading-now";
import { AddDecision, AddSection } from "./pm-add";

const btn: React.CSSProperties = {
  height: 30,
  padding: "0 12px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--panel)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  color: "inherit",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  whiteSpace: "nowrap",
};
const btnAi: React.CSSProperties = { ...btn, borderColor: "var(--viol)", color: "var(--viol)" };
const btnPrimary: React.CSSProperties = {
  ...btn,
  background: "var(--brand)",
  borderColor: "var(--brand)",
  color: "var(--on-brand)",
};
const link: React.CSSProperties = {
  background: "none",
  border: 0,
  padding: 0,
  cursor: "pointer",
  color: "var(--brand)",
  fontWeight: 600,
  fontSize: 12,
  textDecoration: "none",
};
const menuItem: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  background: "none",
  border: 0,
  padding: "7px 10px",
  fontSize: 12.5,
  cursor: "pointer",
  color: "var(--ink)",
  borderRadius: 7,
  textDecoration: "none",
};
const strip: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
  padding: "10px 16px",
};
const muted: React.CSSProperties = { fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 };

/** Hover affordances of the document: the editing tools and "Resolve" show where the pointer is. */
const CSS = `.oi-pm-sec .oi-pm-tools,.oi-pm-note .oi-pm-resolve{opacity:0;transition:opacity .12s}
.oi-pm-sec:hover .oi-pm-tools,.oi-pm-sec:focus-within .oi-pm-tools,.oi-pm-note:hover .oi-pm-resolve,.oi-pm-note:focus-within .oi-pm-resolve{opacity:1}
.oi-pm-comment:hover{color:var(--brand)!important}
.oi-pm-body>:last-child{margin-bottom:0}
.oi-phase>summary::-webkit-details-marker{display:none}`;

/**
 * IN-04 — the post-incident tab, as the design draws it: one strip with the
 * three phases (documenting, reviewing, then learning — sharing the published
 * document), who is reading, Share, the team's comments and the publish step;
 * then the document alone at a 780 px reading width. Each section shows one
 * control — "＋ Comment" — and the team's notes under it; the editing tools
 * appear on the section the pointer is on. The decisions taken during the
 * incident, what Atlas did and the follow-ups are read off the incident.
 * Comments can be left at any time, on a document Atlas wrote entirely too;
 * they stay with the team and never reach the published page.
 */
export async function PostIncident({
  inc,
  number,
  canAct,
  tenantId,
  me,
  postMortemTerm = null,
  template,
  aiAllowed = false,
  docs = [],
  trackers = [],
  exportError = null,
}: {
  inc: IncidentDetail;
  number: number;
  canAct: boolean;
  tenantId: string;
  /** The reader, for the avatar of the comment composer. */
  me: { id: string; name: string };
  postMortemTerm?: string | null;
  template: PostMortemTemplateSection[];
  aiAllowed?: boolean;
  docs?: Array<{ kind: "confluence" | "notion"; label: string }>;
  trackers?: Array<{ kind: "github" | "gitlab" | "jira" | "linear"; label: string }>;
  exportError?: string | null;
}) {
  const t = await getT();
  const pm = inc.postMortem;
  const term = postMortemTerm ?? t("postMortem.title");
  const inPostIncident = inc.row.phase === "closed" || inc.row.phase === "post_incident";

  const history = pm
    ? await withTenant(tenantId, (tx) => loadHistory(tx, pm.id))
    : { revisions: [], comments: [] };
  const humanRevisions = history.revisions.filter((r) => !r.kind.startsWith("ai_"));
  const people = contributors(humanRevisions);
  const openComments = history.comments.filter((c) => !c.resolvedAt);
  const reviewByKey = new Map((pm?.reviewNotes ?? []).map((n) => [n.key, n]));
  const gaps = (pm?.reviewNotes ?? []).filter((n) => n.verdict === "gap").length;
  const contradictions = (pm?.reviewNotes ?? []).filter(
    (n) => n.verdict === "contradiction",
  ).length;
  const blocks = {
    timeline: timelineMarkdown(inc, t),
    followUps: followUpsMarkdown(inc, t),
    impact: impactMarkdown(inc, t),
  };
  const templateKeys = new Set(template.map((s) => s.key));
  const commentsFor = (key: string): SectionComment[] =>
    history.comments
      .filter((c) => c.sectionKey === key)
      .map((c) => ({
        id: c.id,
        body: c.body,
        memberName: c.memberName,
        createdAt: c.createdAt.toISOString(),
        resolvedAt: c.resolvedAt?.toISOString() ?? null,
        resolvedByName: c.resolvedByName,
      }))
      .reverse();
  // A section Atlas wrote and nobody has edited by hand since reads "draft · Atlas".
  const editedByHand = new Set(
    humanRevisions.filter((r) => r.kind === "edit").map((r) => r.sectionKey ?? ""),
  );
  const isDraft = (key: string, body: string) =>
    Boolean(pm?.aiDrafted) && body.trim() !== "" && !editedByHand.has(key);
  const pmNext: Record<string, "in_review" | "completed" | null> = {
    in_progress: "in_review",
    in_review: "completed",
    completed: null,
  };
  const statusTone: Record<string, { bg: string; ink: string }> = {
    in_progress: { bg: "var(--wait-t)", ink: "var(--wait)" },
    in_review: { bg: "var(--open-t)", ink: "var(--open)" },
    completed: { bg: "var(--ok-t)", ink: "var(--ok)" },
  };
  const decisions = inc.events.filter(
    (e) => e.kind === "note" && (e.payload as { system?: string })?.system === "decision",
  );
  const atlasActed = (await listAtlasActions(tenantId, inc.row.id)).length > 0;
  const sectionName = (key: string | null) => {
    if (!key) return null;
    if (key === "decisions") return t("incv2.pm.decisions");
    if (key === "atlas") return t("incv2.pm.whatAtlasDid");
    if (key === "follow_ups") return t("incident.tab.followUps");
    const sec = pm?.sections.find((s) => s.key === key);
    return sec ? sectionTitle(sec, t) : null;
  };

  /* ——— The phase strip: documenting, reviewing, then learning ——— */
  type Task = { id: string | null; title: string; done: boolean; meta: string };
  const taskOf = (x: IncidentDetail["tasks"][number]): Task => ({
    id: x.id,
    title: x.title,
    done: Boolean(x.completedAt || x.skippedAt),
    meta: [
      x.assigneeName,
      x.skippedAt
        ? t("postIncident.skipped", { reason: x.skipReason ?? "" })
        : x.completedAt
          ? t("postIncident.doneOn", { date: t.fmt.dateShort(x.completedAt) })
          : x.dueAt
            ? t("postIncident.dueOn", { date: t.fmt.dateShort(x.dueAt) })
            : null,
    ]
      .filter(Boolean)
      .join(" · "),
  });
  const phases: Array<{ key: string; label: string; tasks: Task[] }> = [
    {
      key: "documenting",
      label: t("inc2.pi.phase.documenting"),
      tasks: inc.tasks.filter((x) => x.phase === "documenting").map(taskOf),
    },
    {
      key: "reviewing",
      label: t("inc2.pi.phase.reviewing"),
      tasks: inc.tasks.filter((x) => x.phase === "reviewing").map(taskOf),
    },
    {
      // Learning is the document reaching the team: done when it is published.
      key: "learning",
      label: t("incv2.pi.learning"),
      tasks: [
        {
          id: null,
          title: t("incv2.pi.sharePm"),
          done: pm?.status === "completed",
          meta: pm?.publishedAt
            ? t("postIncident.doneOn", { date: t.fmt.dateShort(pm.publishedAt) })
            : "",
        },
      ],
    },
  ];
  const showPhases = inc.tasks.length > 0 || Boolean(pm);
  const complete = (p: (typeof phases)[number]) =>
    p.tasks.length > 0 && p.tasks.every((x) => x.done);
  const phaseStrip = phases.map((phase, i) => {
    const done = phase.tasks.filter((x) => x.done).length;
    const full = complete(phase);
    const current = !full && phases.slice(0, i).every(complete);
    return (
      <div key={phase.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <details className="oi-phase" style={{ position: "relative" }} data-testid="pm-phase">
          <summary
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              listStyle: "none",
              cursor: "pointer",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: full ? "var(--ok)" : "var(--panel)",
                color: full ? "#fff" : "var(--brand)",
                border: full
                  ? "none"
                  : current
                    ? "2px solid var(--brand)"
                    : "1.5px solid var(--line)",
                display: "grid",
                placeItems: "center",
                fontSize: 9,
                fontWeight: 800,
                boxSizing: "border-box",
              }}
            >
              {full ? "✓" : ""}
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{phase.label}</span>
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
              {done}/{phase.tasks.length}
            </span>
          </summary>
          <div
            data-testid="pm-tasks"
            style={{
              position: "absolute",
              left: -8,
              top: "calc(100% + 8px)",
              zIndex: 20,
              width: 280,
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              boxShadow: "var(--shadow-pop)",
              padding: 10,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {phase.tasks.length === 0 && <span style={muted}>{t("incv2.pi.noTask")}</span>}
            {phase.tasks.map((task, k) => (
              <div
                key={task.id ?? `${phase.key}-${k}`}
                style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5 }}
              >
                {task.id ? (
                  <form action={toggleTask} style={{ display: "contents" }}>
                    <input type="hidden" name="id" value={task.id} />
                    <input type="hidden" name="number" value={number} />
                    <button
                      type="submit"
                      disabled={!canAct}
                      aria-pressed={task.done}
                      aria-label={task.title}
                      style={taskBox(task.done, canAct)}
                    >
                      {task.done ? "✓" : ""}
                    </button>
                  </form>
                ) : (
                  <span aria-hidden style={taskBox(task.done, false)}>
                    {task.done ? "✓" : ""}
                  </span>
                )}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontWeight: 500,
                      textDecoration: task.done ? "line-through" : "none",
                      color: task.done ? "var(--ink-3)" : "var(--ink)",
                    }}
                  >
                    {task.title}
                  </span>
                  {task.meta && (
                    <span style={{ display: "block", ...muted, fontSize: 11 }}>{task.meta}</span>
                  )}
                </span>
              </div>
            ))}
            {phase.key === "reviewing" && inc.debrief && (
              <div style={{ ...muted, fontSize: 11 }}>
                {t("postIncident.debrief", {
                  date: t.fmt.dateShort(inc.debrief.scheduledAt),
                  from: t.fmt.time(inc.debrief.scheduledAt, t.timeZone),
                  to: t.fmt.time(
                    new Date(
                      inc.debrief.scheduledAt.getTime() + inc.debrief.durationMinutes * 60_000,
                    ),
                    t.timeZone,
                  ),
                })}{" "}
                {t("postIncident.debriefGuests", { count: inc.debrief.attendees.length })}
              </div>
            )}
          </div>
        </details>
        {i < phases.length - 1 && (
          <span aria-hidden style={{ width: 18, height: 1, background: "var(--line-2)" }} />
        )}
      </div>
    );
  });

  if (!pm)
    return (
      <div className="oi-rise-fast" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <style>{CSS}</style>
        {showPhases && <div style={strip}>{phaseStrip}</div>}
        <div
          style={{
            padding: 28,
            border: "1.5px dashed var(--line)",
            borderRadius: "var(--radius-card)",
            textAlign: "center",
            color: "var(--ink-3)",
            fontSize: 13.5,
            background: "var(--panel)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span>{inPostIncident ? t("postIncident.noneYet") : t("postIncident.notStarted")}</span>
          {canAct && inPostIncident && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <form action={startPostMortem}>
                <input type="hidden" name="number" value={number} />
                <button type="submit" data-testid="pm-start" style={btnPrimary}>
                  {t("postMortem.start")}
                </button>
              </form>
              {aiAllowed && (
                <form action={draftPostMortemAction}>
                  <input type="hidden" name="number" value={number} />
                  <button type="submit" data-testid="pm-draft" style={btnAi}>
                    ✦ {t("incv2.pm.draftWithAtlas")}
                  </button>
                </form>
              )}
            </div>
          )}
          <span style={{ ...muted, maxWidth: 420 }}>{t("postMortem.startNote")}</span>
        </div>
      </div>
    );

  const tone = statusTone[pm.status] ?? statusTone.in_progress!;
  const openFu = inc.followUps.filter((f) => f.status === "open").length;
  const meta = [
    inc.row.severityName,
    inc.row.resolvedAt
      ? t("inc2.window", {
          start: t.fmt.dateTime(inc.row.declaredAt, t.timeZone).replace(" · ", ", "),
          end: t.fmt.time(inc.row.resolvedAt, t.timeZone),
          duration: t.fmt.duration(
            (inc.row.resolvedAt.getTime() - inc.row.declaredAt.getTime()) / 60_000,
          ),
        })
      : t.fmt.dateTime(inc.row.declaredAt, t.timeZone),
    pm.ownerName ? t("incv2.pm.owner", { name: pm.ownerName }) : null,
    inc.followUps.length
      ? t("incv2.pm.followUpsMeta", { count: inc.followUps.length, open: openFu })
      : null,
  ].filter(Boolean);
  const empty = pm.sections.every((sec) => sec.body.trim() === "");

  return (
    <div className="oi-rise-fast" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <style>{CSS}</style>
      <div style={strip}>
        {showPhases && phaseStrip}
        <span style={{ flex: 1 }} />
        <ReadingNow incidentId={inc.row.id} />
        <PmSide count={openComments.length}>
          <div
            data-testid="pm-open-comments"
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            {history.comments.length === 0 && (
              <span style={muted}>{t("postMortem.comments.none")}</span>
            )}
            {[...history.comments].reverse().map((c) => {
              const on = sectionName(c.sectionKey);
              const av = avatarTone(c.memberName);
              return (
                <div
                  key={c.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    borderBottom: "1px solid var(--line-2)",
                    paddingBottom: 10,
                    opacity: c.resolvedAt ? 0.6 : 1,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span
                      aria-hidden
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        background: av.bg,
                        color: av.ink,
                        display: "grid",
                        placeItems: "center",
                        fontSize: 8,
                        fontWeight: 700,
                      }}
                    >
                      {initials(c.memberName)}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{c.memberName}</span>
                    <span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
                      {t.fmt.messageTime(c.createdAt)}
                    </span>
                  </div>
                  {on && (
                    <a
                      href={`#pm-${c.sectionKey}`}
                      style={{
                        fontSize: 10.5,
                        fontWeight: 600,
                        color: "var(--brand)",
                        textDecoration: "none",
                      }}
                    >
                      {t("inc2.pi.commentsOn", { section: on })}
                    </a>
                  )}
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                    {c.body}
                  </div>
                  {c.resolvedAt && (
                    <div style={{ fontSize: 10.5, color: "var(--ok)", fontWeight: 600 }}>
                      {t("postMortem.comments.resolvedBy", { name: c.resolvedByName ?? "" })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <details data-testid="pm-history-panel" style={{ order: 2 }}>
            <summary
              data-testid="pm-history-toggle"
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: "var(--ink-3)",
                cursor: "pointer",
              }}
            >
              {t("postMortem.historyTitle")} · {history.revisions.length}
            </summary>
            <div
              data-testid="pm-history"
              style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}
            >
              {history.revisions.length === 0 && (
                <span style={muted}>{t("postMortem.history.none")}</span>
              )}
              {history.revisions.slice(0, 14).map((r, i) => {
                const section = r.sectionKey
                  ? pm.sections.find((s) => s.key === r.sectionKey)
                  : null;
                return (
                  <div
                    key={r.id}
                    style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12 }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        marginTop: 5,
                        flex: "none",
                        background: r.kind.startsWith("ai_")
                          ? "var(--viol)"
                          : i === 0
                            ? "var(--brand)"
                            : "var(--line)",
                      }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 600 }}>{r.actorName ?? "—"}</span>{" "}
                      <span style={{ color: "var(--ink-2)" }}>
                        {t(`postMortem.history.${r.kind}`)}
                        {section ? ` · ${sectionTitle(section, t)}` : ""}
                      </span>
                      <span style={{ display: "block", ...muted, fontSize: 11 }}>
                        {t.fmt.relative(r.createdAt)}
                      </span>
                    </span>
                    {canAct && i > 0 && (
                      <form action={restorePostMortemRevision}>
                        <input type="hidden" name="number" value={number} />
                        <input type="hidden" name="id" value={r.id} />
                        <button
                          type="submit"
                          className="oi-link"
                          data-testid="pm-restore"
                          style={{ ...link, fontSize: 11 }}
                        >
                          {t("postMortem.restore")}
                        </button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        </PmSide>
        {canAct && pmNext[pm.status] && (
          <form action={setPostMortemStatus} style={{ display: "contents" }}>
            <input type="hidden" name="number" value={number} />
            <input type="hidden" name="status" value={pmNext[pm.status]!} />
            <button
              type="submit"
              data-testid="pm-publish"
              className="oi-hover-brand-2"
              style={btnPrimary}
            >
              {pm.status === "in_progress" ? t("inc2.pi.sendToReview") : t("incv2.pi.publish")}
            </button>
          </form>
        )}
      </div>

      <div
        data-testid="pm-document"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-card)",
          overflow: "hidden",
        }}
      >
        {exportError && (
          <div
            role="alert"
            style={{
              padding: "8px 18px",
              fontSize: 12.5,
              color: "var(--dang)",
              borderBottom: "1px solid var(--line)",
            }}
          >
            {exportError}
          </div>
        )}
        {pm.reviewedAt && (
          <div
            data-testid="pm-review-summary"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "8px 18px",
              borderBottom: "1px solid var(--line)",
              fontSize: 12.5,
              color: contradictions ? "var(--dang)" : gaps ? "var(--wait)" : "var(--ok)",
              background: contradictions ? "var(--dang-t)" : gaps ? "var(--wait-t)" : "var(--ok-t)",
            }}
          >
            {t("postMortem.review.summary", {
              when: t.fmt.relative(pm.reviewedAt),
              gaps,
              contradictions,
            })}
          </div>
        )}
        <div
          style={{
            maxWidth: 780,
            margin: "0 auto",
            padding: "36px 40px 48px",
            display: "flex",
            flexDirection: "column",
            gap: 22,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: "var(--ink-3)",
                }}
              >
                {term}
              </span>
              <span
                data-testid="pm-status"
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  borderRadius: 999,
                  padding: "2px 8px",
                  background: tone.bg,
                  color: tone.ink,
                }}
              >
                {t(`postMortem.status.${pm.status}`)}
              </span>
              {pm.aiDrafted ? (
                <span
                  title={t("postMortem.aiDraftNote")}
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: "var(--viol)",
                    background: "var(--viol-t)",
                    borderRadius: 5,
                    padding: "2px 7px",
                  }}
                >
                  {people.length > 0
                    ? t("incv2.pm.generatedEdited", { count: people.length })
                    : t("incv2.pm.generated")}
                </span>
              ) : (
                people.length > 0 && (
                  <span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
                    {t("inc2.pi.editedBy", { count: people.length })}
                  </span>
                )
              )}
            </div>
            <PmTitle
              number={number}
              title={pm.title}
              fallback={documentTitle(inc, { title: null })}
              canAct={canAct}
            />
            <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{meta.join(" · ")}</div>
          </div>

          {empty && canAct && aiAllowed && (
            <form
              action={draftPostMortemAction}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "var(--viol-t)",
                borderRadius: 12,
                padding: "10px 14px",
              }}
            >
              <input type="hidden" name="number" value={number} />
              <span style={{ color: "var(--viol)" }}>✦</span>
              <span style={{ flex: 1, fontSize: 12.5, lineHeight: 1.5 }}>
                {t("incv2.pm.draftLead")}
              </span>
              <button type="submit" data-testid="pm-draft" style={btnAi}>
                {t("incv2.pm.draftWithAtlas")}
              </button>
            </form>
          )}

          {pm.sections.map((sec, i) => (
            <SectionEditor
              key={sec.key}
              number={number}
              section={sec}
              title={sectionTitle(sec, t)}
              hint={sectionHint(sec, template, t)}
              index={i}
              count={pm.sections.length}
              canAct={canAct}
              aiAllowed={aiAllowed}
              removable={!templateKeys.has(sec.key)}
              blocks={blocks}
              review={reviewByKey.get(sec.key) ?? null}
              comments={commentsFor(sec.key)}
              draft={isDraft(sec.key, sec.body)}
              fromRca={sec.key === "root_cause" && isDraft(sec.key, sec.body)}
              me={me.name}
            />
          ))}

          {(decisions.length > 0 || canAct) && (
            <PmBlock
              number={number}
              sectionKey="decisions"
              title={t("incv2.pm.decisions")}
              canAct={canAct}
              comments={commentsFor("decisions")}
              me={me.name}
              testid="pm-decisions"
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {decisions.map((d) => {
                  const p = d.payload as { title?: string; why?: string };
                  return (
                    <div
                      key={d.id}
                      data-testid="pm-decision"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "52px minmax(0,1fr)",
                        gap: 12,
                        padding: "9px 0",
                        borderBottom: "1px solid var(--line-2)",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 11.5,
                          color: "var(--ink-3)",
                          paddingTop: 2,
                        }}
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
                {decisions.length === 0 && (
                  <div style={{ fontSize: 14, color: "var(--ink-3)", fontStyle: "italic" }}>
                    {t("incv2.pm.noDecision")}
                  </div>
                )}
                {canAct && <AddDecision number={number} />}
              </div>
            </PmBlock>
          )}

          {atlasActed && (
            <section
              id="pm-atlas"
              data-testid="pm-atlas"
              className="oi-pm-sec"
              style={{ display: "flex", flexDirection: "column", gap: 8, scrollMarginTop: 80 }}
            >
              <CommentScope>
                <WhatAtlasDid
                  tenantId={tenantId}
                  incidentId={inc.row.id}
                  aside={
                    canAct ? (
                      <ScopeCommentButton
                        count={commentsFor("atlas").filter((c) => !c.resolvedAt).length}
                      />
                    ) : undefined
                  }
                />
                <ScopeNotes
                  number={number}
                  sectionKey="atlas"
                  comments={commentsFor("atlas")}
                  canAct={canAct}
                  me={me.name}
                />
              </CommentScope>
            </section>
          )}

          <PmBlock
            number={number}
            sectionKey="follow_ups"
            title={t("incident.tab.followUps")}
            canAct={canAct}
            comments={commentsFor("follow_ups")}
            me={me.name}
            testid="pm-follow-ups"
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {inc.followUps.length === 0 && (
                <div style={{ fontSize: 14, color: "var(--ink-3)", fontStyle: "italic" }}>
                  {t("incident.followUps.none")}
                </div>
              )}
              {inc.followUps.map((f) => {
                const done = f.status === "done";
                const prio = priorityTone(
                  f.priorityName === "P1" ? 0 : f.priorityName === "P2" ? 1 : 2,
                );
                return (
                  <div
                    key={f.id}
                    data-testid="pm-follow-up"
                    className="oi-pm-note"
                    style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "3px 0" }}
                  >
                    <form action={toggleFollowUp} style={{ display: "contents" }}>
                      <input type="hidden" name="id" value={f.id} />
                      <button
                        type="submit"
                        disabled={!canAct}
                        aria-label={done ? t("followUp.reopen") : t("followUp.complete")}
                        aria-pressed={done}
                        style={{ ...taskBox(done, canAct), marginTop: 5 }}
                      >
                        {done ? "✓" : ""}
                      </button>
                    </form>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 15, lineHeight: 1.7 }}>
                      <span
                        style={{
                          textDecoration: done ? "line-through" : "none",
                          color: done ? "var(--ink-3)" : "var(--ink)",
                        }}
                      >
                        {f.title}
                      </span>
                      <span style={{ color: "var(--ink-2)" }}>
                        {" — "}
                        {f.priorityName && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              background: prio.bg,
                              color: prio.ink,
                              borderRadius: 5,
                              padding: "1px 5px",
                              verticalAlign: 2,
                              marginRight: 5,
                            }}
                          >
                            {f.priorityName}
                          </span>
                        )}
                        {t(`followUp.status.${f.status}`)}
                        {f.assigneeName ? ` · ${f.assigneeName}` : ""}
                        {f.overdue && f.dueAt ? (
                          <span style={{ color: "var(--dang)", fontWeight: 600 }}>
                            {` · ${t("followUp.overdue", { date: t.fmt.dateShort(f.dueAt) })}`}
                          </span>
                        ) : null}
                        {f.externalRef ? (
                          <>
                            {" · "}
                            {f.externalRef.url ? (
                              <a
                                href={f.externalRef.url}
                                target="_blank"
                                rel="noreferrer"
                                className="oi-link"
                              >
                                {trackerName(f.externalRef.tracker)} · {f.externalRef.key}
                              </a>
                            ) : (
                              `${f.externalRef.tracker} · ${f.externalRef.key}`
                            )}
                          </>
                        ) : null}
                      </span>
                    </span>
                    {!f.externalRef && canAct && !done && trackers.length > 0 && (
                      <span className="oi-pm-resolve" style={{ marginTop: 3 }}>
                        <ExportFollowUp id={f.id} trackers={trackers} />
                      </span>
                    )}
                  </div>
                );
              })}
              {canAct && (
                <div style={{ marginTop: 6 }}>
                  <AddFollowUp number={number} />
                </div>
              )}
            </div>
          </PmBlock>

          {canAct && <AddSection number={number} />}

          <div
            style={{
              borderTop: "1px solid var(--line)",
              paddingTop: 16,
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              fontSize: 12,
              color: "var(--ink-3)",
            }}
          >
            <span style={{ flex: "1 1 320px", lineHeight: 1.5 }}>
              {pm.aiDrafted ? t("incv2.pm.footerGenerated") : t("inc2.pi.footer")}
            </span>
            {canAct && aiAllowed && !empty && (
              <form action={reviewPostMortemAction} style={{ display: "contents" }}>
                <input type="hidden" name="number" value={number} />
                <button
                  type="submit"
                  data-testid="pm-review"
                  title={t("postMortem.review.note")}
                  style={{ ...link, color: "var(--viol)" }}
                >
                  ✦ {pm.reviewedAt ? t("postMortem.review.rerun") : t("postMortem.review.run")}
                </button>
              </form>
            )}
            <a
              href={`/app/incidents/${number}/post-mortem?print=1`}
              target="_blank"
              rel="noreferrer"
              data-testid="pm-export-pdf"
              style={link}
            >
              {t("incv2.pm.exportPdf")}
            </a>
            <details style={{ position: "relative" }}>
              <summary
                data-testid="pm-export-menu"
                aria-label={t("postMortem.export.menu")}
                title={t("postMortem.export.menu")}
                style={{ ...link, color: "var(--ink-3)", listStyle: "none" }}
              >
                ···
              </summary>
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  bottom: "calc(100% + 4px)",
                  zIndex: 5,
                  minWidth: 240,
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  boxShadow: "var(--shadow-pop)",
                  padding: 4,
                }}
              >
                {canAct &&
                  !empty &&
                  docs.map((d) => (
                    <form key={d.kind} action={exportPostMortemAction}>
                      <input type="hidden" name="number" value={number} />
                      <input type="hidden" name="kind" value={d.kind} />
                      <button
                        type="submit"
                        data-testid={`pm-export-${d.kind}`}
                        className="oi-hover"
                        style={menuItem}
                      >
                        {t("postMortem.exportTo", { tool: d.label })}
                      </button>
                    </form>
                  ))}
                <a
                  href={`/app/incidents/${number}/post-mortem/markdown`}
                  className="oi-hover"
                  style={menuItem}
                  data-testid="pm-export-md"
                >
                  {t("postMortem.export.download")}
                </a>
                <PmCopy markdown={documentMarkdown(inc, pm, t, term)} style={menuItem} />
                <a
                  href={`/app/incidents/${number}/post-mortem`}
                  target="_blank"
                  rel="noreferrer"
                  className="oi-hover"
                  style={menuItem}
                >
                  {t("postMortem.export.fullPage")} ↗
                </a>
                {pm.externalUrl && (
                  <a
                    href={pm.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="oi-hover"
                    style={menuItem}
                    data-testid="pm-external-link"
                  >
                    {t("postMortem.exported")} ↗
                  </a>
                )}
                <Link href="/app/incidents?view=follow-ups" className="oi-hover" style={menuItem}>
                  {t("incv2.pm.allFollowUps")}
                </Link>
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}

function taskBox(done: boolean, active: boolean): React.CSSProperties {
  return {
    width: 15,
    height: 15,
    flex: "none",
    marginTop: 2,
    borderRadius: 5,
    border: `1.5px solid ${done ? "var(--ok)" : "var(--line)"}`,
    background: done ? "var(--ok)" : "var(--panel)",
    display: "grid",
    placeItems: "center",
    color: "#fff",
    fontSize: 9,
    fontWeight: 700,
    cursor: active ? "pointer" : "default",
    padding: 0,
    boxSizing: "border-box",
  };
}

function trackerName(tracker: string): string {
  return tracker === "jira"
    ? "Jira"
    : tracker === "github"
      ? "GitHub"
      : tracker === "gitlab"
        ? "GitLab"
        : tracker === "linear"
          ? "Linear"
          : tracker;
}
