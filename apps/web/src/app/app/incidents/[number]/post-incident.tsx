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
import { avatarTone, initials } from "@/lib/avatar";
import { FollowUpRowView } from "../follow-up-row";
import { toggleTask } from "./actions";
import { AddFollowUp } from "./add-follow-up";
import { draftPostMortemAction, setPostMortemStatus } from "./ai-actions";
import { exportPostMortemAction } from "./docs-actions";
import {
  addPostMortemSection,
  restorePostMortemRevision,
  reviewPostMortemAction,
  startPostMortem,
} from "./pm-actions";
import { SectionEditor, type SectionComment } from "./section-editor";
import { PmTitle } from "./pm-title";
import { PmCopy } from "./pm-copy";
import { PmSide } from "./pm-side";

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

/**
 * IN-04 — the post-incident tab: the phase strip of what is left to do, the
 * document itself on a page of its own width, and the team's comments and the
 * document's history in a drawer beside it. The assistant drafts and reworks a
 * section at a time; a person publishes.
 */
export async function PostIncident({
  inc,
  number,
  canAct,
  tenantId,
  postMortemTerm = null,
  template,
  aiAllowed = false,
  docs = [],
  trackers = [],
  exportError = null,
  slackChannel = null,
}: {
  inc: IncidentDetail;
  number: number;
  canAct: boolean;
  tenantId: string;
  postMortemTerm?: string | null;
  template: PostMortemTemplateSection[];
  aiAllowed?: boolean;
  docs?: Array<{ kind: "confluence" | "notion"; label: string }>;
  trackers?: Array<{ kind: "github" | "gitlab" | "jira" | "linear"; label: string }>;
  exportError?: string | null;
  slackChannel?: string | null;
}) {
  const t = await getT();
  const pm = inc.postMortem;
  const term = postMortemTerm ?? t("postMortem.title");
  const inPostIncident = inc.row.phase === "closed" || inc.row.phase === "post_incident";
  const phases = ["documenting", "reviewing"] as const;

  const history = pm
    ? await withTenant(tenantId, (tx) => loadHistory(tx, pm.id))
    : { revisions: [], comments: [] };
  const people = contributors(history.revisions);
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
  const markdown = pm ? documentMarkdown(inc, pm, t, term) : "";
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
      }));
  const pmNext: Record<string, "in_review" | "completed" | null> = {
    in_progress: "in_review",
    in_review: "completed",
    completed: null,
  };
  const statusTone: Record<string, { bg: string; ink: string }> = {
    in_progress: { bg: "var(--open-t)", ink: "var(--open)" },
    in_review: { bg: "var(--wait-t)", ink: "var(--wait)" },
    completed: { bg: "var(--ok-t)", ink: "var(--ok)" },
  };
  const doneTasks = inc.tasks.filter((x) => x.completedAt || x.skippedAt).length;

  /* ——— The phase strip: the two phases the workspace defines, in order ——— */
  const phaseStrip = (
    <>
      {phases.map((phase, i) => {
        const tasks = inc.tasks.filter((x) => x.phase === phase);
        const done = tasks.filter((x) => x.completedAt || x.skippedAt).length;
        const complete = tasks.length > 0 && done === tasks.length;
        const current =
          !complete &&
          (i === 0 ||
            phases.slice(0, i).every((p) => {
              const before = inc.tasks.filter((x) => x.phase === p);
              return before.length > 0 && before.every((x) => x.completedAt || x.skippedAt);
            }));
        return (
          <div key={phase} style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span
              aria-hidden
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: complete ? "var(--ok)" : "var(--panel)",
                color: complete ? "var(--on-brand)" : "var(--brand)",
                border: complete
                  ? "none"
                  : current
                    ? "2px solid var(--brand)"
                    : "1.5px solid var(--line)",
                display: "grid",
                placeItems: "center",
                fontSize: 9,
                fontWeight: 800,
              }}
            >
              {complete ? "✓" : ""}
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t(`inc2.pi.phase.${phase}`)}</span>
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
              {done}/{tasks.length}
            </span>
            {i < phases.length - 1 && (
              <span
                aria-hidden
                style={{ width: 18, height: 1, background: "var(--line-2)", marginLeft: 3 }}
              />
            )}
          </div>
        );
      })}
    </>
  );

  /* ——— The tasks themselves, under the strip: each one is a real transition ——— */
  const tasksCard =
    inc.tasks.length === 0 ? null : (
      <details
        data-testid="pm-tasks"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-card)",
          padding: "10px 16px",
        }}
      >
        <summary style={{ fontSize: 12.5, fontWeight: 600, cursor: "pointer", listStyle: "none" }}>
          {t("inc2.pi.tasks", { done: doneTasks, total: inc.tasks.length })}
        </summary>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 8,
            marginTop: 10,
          }}
        >
          {inc.tasks.map((task) => {
            const isDone = Boolean(task.completedAt || task.skippedAt);
            const meta = [
              task.assigneeName,
              task.skippedAt
                ? t("postIncident.skipped", { reason: task.skipReason ?? "" })
                : task.completedAt
                  ? t("postIncident.doneOn", { date: t.fmt.dateShort(task.completedAt) })
                  : task.dueAt
                    ? t("postIncident.dueOn", { date: t.fmt.dateShort(task.dueAt) })
                    : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <div
                key={task.id}
                style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5 }}
              >
                <form action={toggleTask} style={{ display: "contents" }}>
                  <input type="hidden" name="id" value={task.id} />
                  <input type="hidden" name="number" value={number} />
                  <button
                    type="submit"
                    disabled={!canAct}
                    aria-pressed={isDone}
                    aria-label={task.title}
                    style={{
                      width: 15,
                      height: 15,
                      flex: "none",
                      marginTop: 2,
                      borderRadius: 5,
                      border: `1.5px solid ${isDone ? "var(--ok)" : "var(--line)"}`,
                      background: isDone ? "var(--ok)" : "var(--panel)",
                      display: "grid",
                      placeItems: "center",
                      color: "var(--on-brand)",
                      fontSize: 9,
                      fontWeight: 700,
                      cursor: canAct ? "pointer" : "default",
                      padding: 0,
                    }}
                  >
                    {isDone ? "✓" : ""}
                  </button>
                </form>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontWeight: 500,
                      textDecoration: isDone ? "line-through" : "none",
                      color: isDone ? "var(--ink-3)" : "var(--ink)",
                    }}
                  >
                    {task.title}
                  </span>
                  {meta && <span style={{ display: "block", ...muted, fontSize: 11 }}>{meta}</span>}
                </span>
              </div>
            );
          })}
        </div>
        {inc.debrief && (
          <div style={{ ...muted, marginTop: 8 }}>
            {t("postIncident.debrief", {
              date: t.fmt.dateShort(inc.debrief.scheduledAt),
              from: t.fmt.time(inc.debrief.scheduledAt, t.timeZone),
              to: t.fmt.time(
                new Date(inc.debrief.scheduledAt.getTime() + inc.debrief.durationMinutes * 60_000),
                t.timeZone,
              ),
            })}{" "}
            {t("postIncident.debriefGuests", { count: inc.debrief.attendees.length })}
            {inc.debrief.invitationSentAt ? ` ${t("postIncident.invitationSent")}` : ""}
          </div>
        )}
      </details>
    );

  if (!pm)
    return (
      <div className="oi-rise-fast" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {inc.tasks.length > 0 && <div style={strip}>{phaseStrip}</div>}
        {tasksCard}
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
                    ✦ {t("postMortem.draftWithAi")}
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
    `${t.fmt.dateShort(inc.row.declaredAt)} · ${t.fmt.time(inc.row.declaredAt, t.timeZone)}`,
    inc.row.resolvedAt
      ? t("postMortem.detectionToResolution", {
          duration: t.fmt.duration(
            (inc.row.resolvedAt.getTime() - inc.row.declaredAt.getTime()) / 60_000,
          ),
        })
      : null,
    inc.row.leadName ? `${t("postMortem.meta.lead")} ${inc.row.leadName}` : null,
    pm.ownerName ? t("postMortem.ownedBy", { name: pm.ownerName }) : null,
    inc.followUps.length
      ? t("incident.metric.followUpsValue", { count: inc.followUps.length, open: openFu })
      : null,
  ].filter(Boolean);

  return (
    <div className="oi-rise-fast" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={strip}>
        {inc.tasks.length > 0 && phaseStrip}
        <span style={{ flex: 1 }} />
        {slackChannel && (
          <span style={{ ...btn, cursor: "default", fontFamily: "var(--mono)", fontWeight: 500 }}>
            #{slackChannel}
          </span>
        )}
        <PmSide count={openComments.length}>
          <div
            data-testid="pm-open-comments"
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            {history.comments.length === 0 && (
              <span style={muted}>{t("postMortem.comments.none")}</span>
            )}
            {history.comments.slice(0, 20).map((c) => {
              const section = c.sectionKey ? pm.sections.find((s) => s.key === c.sectionKey) : null;
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
                      {t.fmt.relative(c.createdAt)}
                    </span>
                  </div>
                  {section && (
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--brand)" }}>
                      {t("inc2.pi.commentsOn", { section: sectionTitle(section, t) })}
                    </div>
                  )}
                  <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{c.body}</div>
                </div>
              );
            })}
          </div>
          <div
            data-testid="pm-history"
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
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
              {t("postMortem.historyTitle")}
            </div>
            {history.revisions.length === 0 && (
              <span style={muted}>{t("postMortem.history.none")}</span>
            )}
            {history.revisions.slice(0, 14).map((r, i) => {
              const section = r.sectionKey ? pm.sections.find((s) => s.key === r.sectionKey) : null;
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
                        style={{
                          background: "none",
                          border: 0,
                          padding: 0,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                          color: "var(--brand)",
                        }}
                      >
                        {t("postMortem.restore")}
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </PmSide>
        {canAct && pmNext[pm.status] && (
          <form action={setPostMortemStatus} style={{ display: "contents" }}>
            <input type="hidden" name="number" value={number} />
            <input type="hidden" name="status" value={pmNext[pm.status]!} />
            <button type="submit" className="oi-hover-brand-2" style={btnPrimary}>
              {pm.status === "in_progress" ? t("inc2.pi.sendToReview") : t("inc2.pi.publish")}
            </button>
          </form>
        )}
      </div>

      {tasksCard}

      <div
        data-testid="pm-document"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-card)",
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
              {pm.aiDrafted && (
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
                  {t("atlas.draftLabel")}
                </span>
              )}
              {people.length > 0 && (
                <span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
                  {t("inc2.pi.editedBy", { count: people.length })}
                </span>
              )}
              <span style={{ flex: 1 }} />
              {canAct && aiAllowed && pm.sections.every((sec) => sec.body.trim() === "") && (
                <form action={draftPostMortemAction} style={{ display: "contents" }}>
                  <input type="hidden" name="number" value={number} />
                  <button type="submit" data-testid="pm-draft" style={btnAi}>
                    ✦ {t("postMortem.draftWithAi")}
                  </button>
                </form>
              )}
              {canAct && aiAllowed && pm.sections.some((sec) => sec.body.trim() !== "") && (
                <form action={reviewPostMortemAction} style={{ display: "contents" }}>
                  <input type="hidden" name="number" value={number} />
                  <button
                    type="submit"
                    data-testid="pm-review"
                    style={btnAi}
                    title={t("postMortem.review.note")}
                  >
                    ✦ {pm.reviewedAt ? t("postMortem.review.rerun") : t("postMortem.review.run")}
                  </button>
                </form>
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
            />
          ))}

          {canAct && (
            <form
              action={addPostMortemSection}
              style={{ display: "flex", gap: 8, alignItems: "center" }}
              data-testid="pm-add-section"
            >
              <input type="hidden" name="number" value={number} />
              <input
                name="title"
                required
                maxLength={120}
                placeholder={t("postMortem.addSectionPlaceholder")}
                className="oi-field"
                style={{
                  flex: 1,
                  height: 32,
                  padding: "0 11px",
                  border: "1px dashed var(--line)",
                  borderRadius: 8,
                  fontSize: 13,
                  background: "var(--panel)",
                  outline: "none",
                }}
              />
              <button type="submit" style={btn}>
                + {t("postMortem.addSection")}
              </button>
            </form>
          )}

          <div
            style={{
              borderTop: "1px solid var(--line-2)",
              paddingTop: 16,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: 16,
                  fontWeight: 700,
                  letterSpacing: "-.01em",
                }}
              >
                {t("incident.tab.followUps")}
              </h3>
              <span style={{ flex: 1 }} />
              {canAct && <AddFollowUp number={number} />}
            </div>
            {inc.followUps.length === 0 && <div style={muted}>{t("incident.followUps.none")}</div>}
            {inc.followUps.map((f) => (
              <FollowUpRowView key={f.id} row={f} canAct={canAct} trackers={trackers} />
            ))}
            <div style={{ ...muted, fontSize: 11.5 }}>{t("incident.followUps.exportNote")}</div>
          </div>

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
            <span>{t("inc2.pi.footer")}</span>
            <span style={{ flex: 1 }} />
            <details style={{ position: "relative" }}>
              <summary style={{ ...btn, listStyle: "none" }} data-testid="pm-export-menu">
                {t("postMortem.export.menu")} ▾
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
                  pm.sections.some((sec) => sec.body.trim() !== "") &&
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
                <PmCopy markdown={markdown} style={menuItem} />
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
              </div>
            </details>
            <Link
              href={`/app/incidents?view=follow-ups`}
              className="oi-link"
              style={{ fontSize: 12, fontWeight: 600 }}
            >
              {t("common.seeAll")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
