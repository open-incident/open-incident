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
import { toggleTask } from "./actions";
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
  gap: 6,
  whiteSpace: "nowrap",
};
const btnAi: React.CSSProperties = {
  ...btn,
  borderColor: "var(--viol)",
  color: "var(--viol)",
  fontWeight: 600,
};
const btnPrimary: React.CSSProperties = {
  ...btn,
  background: "var(--brand)",
  borderColor: "var(--brand)",
  color: "#fff",
  fontWeight: 600,
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
const railCard: React.CSSProperties = {
  padding: "12px 14px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};
const muted: React.CSSProperties = { fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 };

/**
 * IN-04 — the post-incident flow as a document. Left: the contents, the two
 * phases' checklists, the debrief. Centre: the post-mortem itself — title,
 * incident metadata, sections rendered from markdown and edited in place,
 * comments under each, the follow-ups. Right: the history of every change and
 * the open comments. The assistant drafts, reworks one section at a time and
 * checks the whole against the facts; a person publishes.
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
  exportError = null,
  slackChannel = null,
}: {
  inc: IncidentDetail;
  number: number;
  canAct: boolean;
  tenantId: string;
  /** The workspace's own word for its post-mortem; the product's when unset. */
  postMortemTerm?: string | null;
  template: PostMortemTemplateSection[];
  /** Whether the assistant may draft the post-mortem for this workspace. */
  aiAllowed?: boolean;
  /** Documentation tools connected to the workspace — where the post-mortem can be exported. */
  docs?: Array<{ kind: "confluence" | "notion"; label: string }>;
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

  const tasksRail = (
    <>
      {phases.map((phase) => {
        const tasks = inc.tasks.filter((x) => x.phase === phase);
        if (tasks.length === 0) return null;
        const done = tasks.filter((x) => x.completedAt || x.skippedAt).length;
        const complete = done === tasks.length;
        return (
          <div key={phase} className="oi-panel" style={railCard}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: complete ? "var(--ok)" : "transparent",
                  border: complete ? 0 : "2px solid var(--brand)",
                  color: "#fff",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 9,
                  fontWeight: 700,
                }}
              >
                {complete ? "✓" : ""}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {t(`postIncident.phase.${phase}`)}
              </span>
              <span style={{ flex: 1 }} />
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: complete ? "var(--ok)" : "var(--ink-2)",
                }}
              >
                {done}/{tasks.length}
              </span>
            </div>
            {tasks.map((task) => {
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
                        color: "#fff",
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
                    {meta && (
                      <span style={{ display: "block", ...muted, fontSize: 11 }}>{meta}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
      {inc.debrief && (
        <div
          style={{
            background: "var(--sunk)",
            borderRadius: 12,
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>
            {t("postIncident.debrief", {
              date: t.fmt.dateShort(inc.debrief.scheduledAt),
              from: t.fmt.time(inc.debrief.scheduledAt, t.timeZone),
              to: t.fmt.time(
                new Date(inc.debrief.scheduledAt.getTime() + inc.debrief.durationMinutes * 60_000),
                t.timeZone,
              ),
            })}
          </div>
          <div style={muted}>
            {t("postIncident.debriefGuests", { count: inc.debrief.attendees.length })}
            {inc.debrief.invitationSentAt ? ` ${t("postIncident.invitationSent")}` : ""}
          </div>
        </div>
      )}
    </>
  );

  if (!pm) {
    const empty = (
      <div
        className="oi-rise"
        style={{
          padding: 28,
          border: "1.5px dashed var(--line)",
          borderRadius: 14,
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
    );
    if (inc.tasks.length === 0) return <div style={{ maxWidth: 760 }}>{empty}</div>;
    return (
      <div
        className="oi-rise"
        style={{
          display: "grid",
          gridTemplateColumns: "260px minmax(0, 1fr)",
          gap: 16,
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{tasksRail}</div>
        <div style={{ maxWidth: 760 }}>{empty}</div>
      </div>
    );
  }

  const tone = statusTone[pm.status] ?? statusTone.in_progress!;
  const metrics: Array<[string, string]> = [
    [t("incident.metric.detected"), t.fmt.dateTime(inc.row.declaredAt, t.timeZone)],
    [
      t("incident.metric.acknowledged"),
      inc.acknowledgedAt
        ? t("incident.metric.tta", {
            duration: t.fmt.duration(
              (inc.acknowledgedAt.getTime() - inc.row.declaredAt.getTime()) / 60_000,
            ),
          })
        : "—",
    ],
    [
      t("incident.metric.resolved"),
      inc.row.resolvedAt
        ? t("incident.metric.ttr", {
            duration: t.fmt.duration(
              (inc.row.resolvedAt.getTime() - inc.row.declaredAt.getTime()) / 60_000,
            ),
          })
        : "—",
    ],
    [
      t("incident.metric.followUps"),
      inc.followUps.length
        ? t("incident.metric.followUpsValue", {
            count: inc.followUps.length,
            open: inc.followUps.filter((f) => f.status === "open").length,
          })
        : "—",
    ],
  ];

  return (
    <div
      className="oi-rise"
      style={{
        display: "grid",
        gridTemplateColumns: "240px minmax(0, 1fr) 280px",
        gap: 16,
        alignItems: "start",
      }}
    >
      {/* ——— Left rail: contents, checklists, debrief ——— */}
      <div
        style={{ display: "flex", flexDirection: "column", gap: 10, position: "sticky", top: 0 }}
      >
        <div className="oi-panel" style={railCard} data-testid="pm-toc">
          <div className="oi-eyebrow">{t("postMortem.toc")}</div>
          {pm.sections.map((s) => {
            const review = reviewByKey.get(s.key);
            const dot =
              review?.verdict === "contradiction"
                ? "var(--dang)"
                : review?.verdict === "gap"
                  ? "var(--wait)"
                  : s.body.trim()
                    ? "var(--ok)"
                    : "var(--line)";
            const open = history.comments.filter(
              (c) => c.sectionKey === s.key && !c.resolvedAt,
            ).length;
            return (
              <a
                key={s.key}
                href={`#pm-${s.key}`}
                className="oi-hover"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12.5,
                  color: s.body.trim() ? "var(--ink)" : "var(--ink-3)",
                  textDecoration: "none",
                  padding: "3px 6px",
                  margin: "0 -6px",
                  borderRadius: 6,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: dot,
                    flex: "none",
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {sectionTitle(s, t)}
                </span>
                {open > 0 && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--brand)" }}>
                    {open}
                  </span>
                )}
              </a>
            );
          })}
        </div>
        {tasksRail}
      </div>

      {/* ——— The document ——— */}
      <div className="oi-panel" style={{ overflow: "visible" }} data-testid="pm-document">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "11px 18px",
            borderBottom: "1px solid var(--line)",
            flexWrap: "wrap",
            position: "sticky",
            top: 0,
            background: "var(--panel)",
            zIndex: 2,
            borderRadius: "13px 13px 0 0",
          }}
        >
          <span style={{ fontFamily: "var(--font-title)", fontSize: 14.5, fontWeight: 600 }}>
            {term}
          </span>
          <span
            data-testid="pm-status"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 10px 3px 8px",
              borderRadius: 999,
              background: tone.bg,
              color: tone.ink,
              fontSize: 11.5,
              fontWeight: 600,
            }}
          >
            <span
              style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }}
            />
            {t(`postMortem.status.${pm.status}`)}
          </span>
          {pm.aiDrafted && (
            <span
              title={t("postMortem.aiDraftNote")}
              style={{
                fontWeight: 700,
                fontSize: 10,
                letterSpacing: ".08em",
                color: "var(--viol)",
                background: "var(--viol-t)",
                borderRadius: 6,
                padding: "1px 6px",
              }}
            >
              {t("postMortem.aiDraftTag")}
            </span>
          )}
          <span style={{ flex: 1 }} />
          {slackChannel && (
            <span
              style={{ ...btn, cursor: "default", fontFamily: "var(--font-mono)", fontSize: 12 }}
            >
              #{slackChannel}
            </span>
          )}
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
          <details style={{ position: "relative" }}>
            <summary style={{ ...btn, listStyle: "none" }} data-testid="pm-export-menu">
              {t("postMortem.export.menu")} ▾
            </summary>
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "calc(100% + 4px)",
                zIndex: 5,
                minWidth: 240,
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: 10,
                boxShadow: "var(--shadow-card)",
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
          {canAct && pmNext[pm.status] && (
            <form action={setPostMortemStatus} style={{ display: "contents" }}>
              <input type="hidden" name="number" value={number} />
              <input type="hidden" name="status" value={pmNext[pm.status]!} />
              <button type="submit" style={btnPrimary}>
                {pm.status === "in_progress"
                  ? t("postMortem.sendToReview")
                  : t("postMortem.markCompleted")}
              </button>
            </form>
          )}
        </div>
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

        <div style={{ padding: "24px 30px 30px", maxWidth: 780 }}>
          <PmTitle
            number={number}
            title={pm.title}
            fallback={documentTitle(inc, { title: null })}
            canAct={canAct}
          />
          <div
            style={{
              ...muted,
              margin: "8px 0 0",
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {[
              inc.row.severityName,
              t.fmt.dateShort(inc.row.declaredAt),
              inc.row.serviceName,
              inc.row.leadName ? `${t("postMortem.meta.lead")} ${inc.row.leadName}` : null,
              pm.ownerName ? t("postMortem.ownedBy", { name: pm.ownerName }) : null,
            ]
              .filter(Boolean)
              .map((part, i) => (
                <span key={i} style={{ display: "contents" }}>
                  {i > 0 && <span>·</span>}
                  <span>{part}</span>
                </span>
              ))}
          </div>
          <div
            style={{
              ...muted,
              marginTop: 4,
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            {people.length > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                {people.slice(0, 5).map((name) => (
                  <span
                    key={name}
                    title={name}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: "var(--brand-t)",
                      color: "var(--brand)",
                      fontSize: 9.5,
                      fontWeight: 700,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {name
                      .split(/\s+/)
                      .map((p) => p[0] ?? "")
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                ))}
                <span>{t("postMortem.contributors", { count: people.length })}</span>
              </span>
            )}
            {pm.updatedByName && (
              <span>
                ·{" "}
                {t("postMortem.meta.updatedBy", {
                  name: pm.updatedByName,
                  when: t.fmt.relative(pm.updatedAt),
                })}
              </span>
            )}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 8,
              margin: "18px 0 26px",
            }}
          >
            {metrics.map(([l, v]) => (
              <div
                key={l}
                style={{ background: "var(--sunk)", borderRadius: 10, padding: "9px 12px" }}
              >
                <div className="oi-eyebrow">{l}</div>
                <div
                  style={{
                    fontFamily: "var(--font-title)",
                    fontSize: 13.5,
                    fontWeight: 600,
                    marginTop: 2,
                  }}
                >
                  {v}
                </div>
              </div>
            ))}
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
              style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}
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
                }}
              />
              <button type="submit" style={btn}>
                + {t("postMortem.addSection")}
              </button>
            </form>
          )}

          {inc.followUps.length > 0 && (
            <div style={{ marginTop: 26, borderTop: "1px solid var(--line-2)", paddingTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <h2
                  style={{
                    margin: 0,
                    fontFamily: "var(--font-title)",
                    fontSize: 17,
                    fontWeight: 600,
                  }}
                >
                  {t("incident.tab.followUps")}
                </h2>
                <span style={{ flex: 1 }} />
                <Link
                  href={`/app/incidents/${number}?tab=follow-ups`}
                  className="oi-link"
                  style={{ fontSize: 12 }}
                >
                  {t("incident.tab.followUps")} →
                </Link>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <tbody>
                  {inc.followUps.map((f) => (
                    <tr key={f.id} style={{ borderTop: "1px solid var(--line-2)" }}>
                      <td style={{ padding: "6px 0" }}>
                        {f.externalRef?.url ? (
                          <a
                            href={f.externalRef.url}
                            target="_blank"
                            rel="noreferrer"
                            className="oi-link"
                          >
                            {f.title}
                          </a>
                        ) : (
                          f.title
                        )}
                      </td>
                      <td
                        style={{
                          padding: "6px 8px",
                          fontFamily: "var(--font-mono)",
                          fontSize: 11.5,
                          color: "var(--ink-2)",
                        }}
                      >
                        {f.priorityName ?? "—"}
                      </td>
                      <td style={{ padding: "6px 8px", color: "var(--ink-2)" }}>
                        {f.assigneeName ?? "—"}
                      </td>
                      <td
                        style={{
                          padding: "6px 0",
                          textAlign: "right",
                          color: f.status === "done" ? "var(--ok)" : "var(--ink-2)",
                          fontWeight: 600,
                          fontSize: 12,
                        }}
                      >
                        {t(`followUp.status.${f.status}`)}
                        {f.externalRef ? ` · ${f.externalRef.key}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ——— Right rail: history and open comments ——— */}
      <div
        style={{ display: "flex", flexDirection: "column", gap: 10, position: "sticky", top: 0 }}
      >
        <div className="oi-panel" style={railCard} data-testid="pm-history">
          <div className="oi-eyebrow">{t("postMortem.historyTitle")}</div>
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
                      style={{
                        background: "none",
                        border: 0,
                        padding: 0,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                        color: "var(--brand)",
                      }}
                      data-testid="pm-restore"
                    >
                      {t("postMortem.restore")}
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
        <div className="oi-panel" style={railCard} data-testid="pm-open-comments">
          <div className="oi-eyebrow">{t("postMortem.comments.open")}</div>
          {openComments.length === 0 && <span style={muted}>{t("postMortem.comments.none")}</span>}
          {openComments.slice(0, 10).map((c) => {
            const section = c.sectionKey ? pm.sections.find((s) => s.key === c.sectionKey) : null;
            return (
              <a
                key={c.id}
                href={section ? `#pm-${section.key}` : "#"}
                style={{ textDecoration: "none", color: "inherit", fontSize: 12 }}
              >
                <span style={{ fontWeight: 600 }}>{c.memberName}</span>
                {section && (
                  <span style={{ color: "var(--ink-3)" }}> · {sectionTitle(section, t)}</span>
                )}
                <span
                  style={{
                    display: "block",
                    color: "var(--ink-2)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.body}
                </span>
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
