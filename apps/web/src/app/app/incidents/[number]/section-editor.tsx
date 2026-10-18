"use client";

import { createContext, useContext, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useT } from "@/i18n/client";
import { renderMarkdown } from "@/lib/markdown";
import { avatarTone, initials } from "@/lib/avatar";
import { draftPostMortemAction } from "./ai-actions";
import {
  addPostMortemComment,
  deletePostMortemSection,
  movePostMortemSection,
  refineSectionAction,
  renamePostMortemSection,
  resolvePostMortemComment,
  savePostMortemBody,
} from "./pm-actions";

export type EditorBlocks = { timeline: string; followUps: string; impact: string };
export type SectionComment = {
  id: string;
  body: string;
  memberName: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
};
export type SectionReview = { verdict: "supported" | "gap" | "contradiction"; note: string } | null;

const small: React.CSSProperties = {
  background: "none",
  border: 0,
  padding: "2px 6px",
  borderRadius: 6,
  fontSize: 11.5,
  fontWeight: 600,
  cursor: "pointer",
  color: "var(--ink-3)",
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
};
const menu: React.CSSProperties = {
  position: "absolute",
  right: 0,
  top: "calc(100% + 4px)",
  zIndex: 5,
  minWidth: 220,
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 10,
  boxShadow: "var(--shadow-pop)",
  padding: 4,
};
const chip: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "var(--viol)",
  background: "var(--viol-t)",
  borderRadius: 5,
  padding: "1px 6px",
  whiteSpace: "nowrap",
};

function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  const tone = avatarTone(name);
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: tone.bg,
        color: tone.ink,
        display: "grid",
        placeItems: "center",
        fontSize: size <= 20 ? 8 : 8.5,
        fontWeight: 700,
        flex: "none",
      }}
    >
      {initials(name)}
    </span>
  );
}

/** "＋ Comment" with the count of open comments — the one control every section shows. */
function CommentButton({ count, onClick }: { count: number; onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="pm-comment-toggle"
      className="oi-pm-comment"
      style={{
        ...small,
        padding: 0,
        display: "flex",
        alignItems: "center",
        gap: 5,
        whiteSpace: "nowrap",
      }}
    >
      ＋ {t("incv2.pm.comment")}
      {count > 0 && (
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            background: "var(--brand-t)",
            color: "var(--brand)",
            borderRadius: 999,
            padding: "0 6px",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * The team's notes on a section, as the design draws them under it — yellow
 * cards with who and when — and the composer the "＋ Comment" opens. Open
 * comments only: a resolved one stays in the Comments panel, with its mark.
 */
function SectionNotes({
  number,
  sectionKey,
  comments,
  canAct,
  composing,
  me,
  onPosted,
}: {
  number: number;
  sectionKey: string;
  comments: SectionComment[];
  canAct: boolean;
  composing: boolean;
  me: string;
  onPosted: () => void;
}) {
  const t = useT();
  const form = useRef<HTMLFormElement>(null);
  const open = comments.filter((c) => !c.resolvedAt);
  if (open.length === 0 && !composing) return null;
  return (
    <div data-testid="pm-comments" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {open.map((c) => (
        <div
          key={c.id}
          className="oi-pm-note"
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            background: "var(--note)",
            border: "1px solid var(--note-b)",
            borderRadius: 10,
            padding: "9px 12px",
            marginTop: 2,
          }}
        >
          <Avatar name={c.memberName} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{c.memberName}</span>
              <span style={{ fontSize: 11, color: "var(--note-ink)" }}>
                {t.fmt.messageTime(new Date(c.createdAt))}
              </span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5, marginTop: 1, whiteSpace: "pre-wrap" }}>
              {c.body}
            </div>
          </div>
          {canAct && (
            <form action={resolvePostMortemComment} className="oi-pm-resolve">
              <input type="hidden" name="number" value={number} />
              <input type="hidden" name="id" value={c.id} />
              <button type="submit" style={{ ...small, color: "var(--ok)" }}>
                {t("postMortem.comments.resolve")}
              </button>
            </form>
          )}
        </div>
      ))}
      {canAct && composing && (
        <form
          ref={form}
          action={async (fd) => {
            await addPostMortemComment(fd);
            form.current?.reset();
            onPosted();
          }}
          className="oi-rise-fast"
          data-testid="pm-comment-form"
          style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 2 }}
        >
          <input type="hidden" name="number" value={number} />
          <input type="hidden" name="section" value={sectionKey} />
          <span style={{ marginTop: 6 }}>
            <Avatar name={me} />
          </span>
          <textarea
            name="body"
            required
            rows={2}
            maxLength={4000}
            autoFocus
            placeholder={t("incv2.pm.commentPlaceholder")}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                e.currentTarget.form?.requestSubmit();
            }}
            style={{
              flex: 1,
              border: "1px solid var(--brand)",
              borderRadius: 10,
              padding: "8px 11px",
              fontSize: 13,
              lineHeight: 1.5,
              outline: "none",
              resize: "vertical",
              boxShadow: "var(--focus-ring)",
              background: "var(--panel)",
              color: "var(--ink)",
              fontFamily: "inherit",
            }}
          />
          <button
            type="submit"
            className="oi-hover-brand-2"
            style={{
              height: 34,
              padding: "0 12px",
              borderRadius: 9,
              border: 0,
              background: "var(--brand)",
              color: "var(--on-brand)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              marginTop: 1,
            }}
          >
            {t("incv2.pm.post")}
          </button>
        </form>
      )}
    </div>
  );
}

const Scope = createContext<{ composing: boolean; toggle: () => void; close: () => void } | null>(
  null,
);

/**
 * For a block whose heading is drawn by someone else (Atlas's "What Atlas
 * did"): the "＋ Comment" goes in as that heading's aside, the notes after it,
 * and this shares the composer's state between the two.
 */
export function CommentScope({ children }: { children: React.ReactNode }) {
  const [composing, setComposing] = useState(false);
  return (
    <Scope.Provider
      value={{
        composing,
        toggle: () => setComposing((v) => !v),
        close: () => setComposing(false),
      }}
    >
      {children}
    </Scope.Provider>
  );
}

export function ScopeCommentButton({ count }: { count: number }) {
  const scope = useContext(Scope);
  return <CommentButton count={count} onClick={() => scope?.toggle()} />;
}

export function ScopeNotes(props: {
  number: number;
  sectionKey: string;
  comments: SectionComment[];
  canAct: boolean;
  me: string;
}) {
  const scope = useContext(Scope);
  return (
    <SectionNotes
      {...props}
      composing={scope?.composing ?? false}
      onPosted={() => scope?.close()}
    />
  );
}

/**
 * A block of the document that is not typed but read off the incident — the
 * decisions, what Atlas did, the follow-ups. Same heading as a section, the
 * same "＋ Comment" and team notes; the content comes from the server.
 */
export function PmBlock({
  number,
  sectionKey,
  title,
  canAct,
  comments,
  me,
  children,
  testid,
}: {
  number: number;
  sectionKey: string;
  title: string;
  canAct: boolean;
  comments: SectionComment[];
  me: string;
  children: React.ReactNode;
  testid?: string;
}) {
  const [composing, setComposing] = useState(false);
  const open = comments.filter((c) => !c.resolvedAt).length;
  return (
    <section
      id={`pm-${sectionKey}`}
      data-testid={testid ?? `pm-block-${sectionKey}`}
      className="oi-pm-sec"
      style={{ display: "flex", flexDirection: "column", gap: 8, scrollMarginTop: 80 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: "-.01em" }}>
          {title}
        </h3>
        <span style={{ flex: 1 }} />
        {canAct && <CommentButton count={open} onClick={() => setComposing((v) => !v)} />}
      </div>
      {children}
      <SectionNotes
        number={number}
        sectionKey={sectionKey}
        comments={comments}
        canAct={canAct}
        composing={composing}
        me={me}
        onPosted={() => setComposing(false)}
      />
    </section>
  );
}

/**
 * One section of the document: read as prose at the design's reading size,
 * edited as markdown with a toolbar and a live preview, reworked by Atlas one
 * section at a time, commented, moved, renamed or removed. Only "＋ Comment"
 * is always on show; the editing tools appear when the pointer is on the
 * section. The person's words always win.
 */
export function SectionEditor({
  number,
  section,
  title,
  hint,
  index,
  count,
  canAct,
  aiAllowed,
  removable,
  blocks,
  review,
  comments,
  draft = false,
  fromRca = false,
  me,
}: {
  number: number;
  section: { key: string; title: string; body: string };
  title: string;
  hint: string;
  index: number;
  count: number;
  canAct: boolean;
  aiAllowed: boolean;
  removable: boolean;
  blocks: EditorBlocks;
  review: SectionReview;
  comments: SectionComment[];
  /** Written by Atlas and not touched by a person since — "draft · Atlas". */
  draft?: boolean;
  /** The root cause, as Atlas's analysis wrote it: the violet rule and the way back to the analysis. */
  fromRca?: boolean;
  me: string;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [preview, setPreview] = useState(false);
  const [draftBody, setDraftBody] = useState(section.body);
  const [composing, setComposing] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const html = useMemo(() => renderMarkdown(section.body), [section.body]);
  const previewHtml = useMemo(
    () => (preview ? renderMarkdown(draftBody) : ""),
    [preview, draftBody],
  );
  const open = comments.filter((c) => !c.resolvedAt);

  /** Wraps the selection (or inserts at the cursor) and keeps focus in the textarea. */
  const apply = (before: string, after = "", block = false) => {
    const el = area.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const selected = value.slice(s, e);
    const lineStart = block && s > 0 && value[s - 1] !== "\n" ? "\n" : "";
    const insert = `${lineStart}${before}${selected}${after}`;
    const next = value.slice(0, s) + insert + value.slice(e);
    setDraftBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = s + lineStart.length + before.length + selected.length;
      el.setSelectionRange(pos, pos);
    });
  };
  const insertBlock = (text: string) => {
    if (!text) return;
    const el = area.current;
    const s = el?.selectionStart ?? draftBody.length;
    const pad = s > 0 && draftBody[s - 1] !== "\n" ? "\n\n" : "";
    const next = draftBody.slice(0, s) + pad + text + "\n" + draftBody.slice(s);
    setDraftBody(next);
    requestAnimationFrame(() => el?.focus());
  };

  const tool = (label: string, onClick: () => void, titleText: string) => (
    <button
      type="button"
      onClick={onClick}
      title={titleText}
      aria-label={titleText}
      className="oi-hover"
      style={{
        height: 26,
        minWidth: 26,
        padding: "0 7px",
        border: "1px solid var(--line)",
        borderRadius: 6,
        background: "var(--panel)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        color: "var(--ink-2)",
      }}
    >
      {label}
    </button>
  );

  const verdictTone =
    review?.verdict === "contradiction"
      ? { bg: "var(--dang-t)", ink: "var(--dang)" }
      : review?.verdict === "gap"
        ? { bg: "var(--wait-t)", ink: "var(--wait)" }
        : { bg: "var(--ok-t)", ink: "var(--ok)" };

  const fromRcaLine = t("incv2.pm.fromRca", { tab: "\u0000" }).split("\u0000");
  const prose = (
    <div
      className="oi-prose oi-pm-body"
      style={{ fontSize: 15, lineHeight: 1.7, maxWidth: "none", textWrap: "pretty" }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );

  return (
    <section
      id={`pm-${section.key}`}
      data-testid={`pm-section-${section.key}`}
      className="oi-pm-sec"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        scrollMarginTop: 80,
        position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {renaming ? (
          <form
            action={async (fd) => {
              await renamePostMortemSection(fd);
              setRenaming(false);
            }}
            style={{ display: "flex", gap: 6, alignItems: "center", flex: 1 }}
          >
            <input type="hidden" name="number" value={number} />
            <input type="hidden" name="section" value={section.key} />
            <input
              name="title"
              defaultValue={section.title}
              required
              maxLength={120}
              autoFocus
              className="oi-field"
              style={{
                height: 30,
                padding: "0 10px",
                border: "1px solid var(--line)",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                background: "var(--panel)",
                flex: 1,
              }}
            />
            <button type="submit" style={{ ...small, color: "var(--brand)" }}>
              {t("common.save")}
            </button>
            <button type="button" style={small} onClick={() => setRenaming(false)}>
              {t("common.cancel")}
            </button>
          </form>
        ) : (
          <h3
            style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: "-.01em" }}
            title={hint || undefined}
          >
            {title}
          </h3>
        )}
        {draft && !renaming && <span style={chip}>{t("incv2.pm.draftAtlas")}</span>}
        {review && review.verdict !== "supported" && (
          <span
            data-testid="pm-review-note"
            title={review.note}
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: ".04em",
              padding: "1px 7px",
              borderRadius: 999,
              background: verdictTone.bg,
              color: verdictTone.ink,
            }}
          >
            {t(`postMortem.review.${review.verdict}`)}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {canAct && !editing && !renaming && (
          <span className="oi-pm-tools" style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <button
              type="button"
              onClick={() => {
                setDraftBody(section.body);
                setPreview(false);
                setEditing(true);
              }}
              style={small}
              className="oi-hover"
            >
              {t("common.edit")}
            </button>
            {aiAllowed && (
              <details style={{ position: "relative" }}>
                <summary
                  style={{ ...small, color: "var(--viol)", listStyle: "none" }}
                  title={t("postMortem.aiMenu")}
                  aria-label={t("postMortem.aiMenu")}
                >
                  ✦
                </summary>
                <div style={menu}>
                  <form action={draftPostMortemAction}>
                    <input type="hidden" name="number" value={number} />
                    <input type="hidden" name="section" value={section.key} />
                    <button
                      type="submit"
                      style={menuItem}
                      className="oi-hover"
                      data-testid="pm-regenerate"
                    >
                      {section.body
                        ? t("postMortem.regenerateSection")
                        : t("postMortem.generateSection")}
                    </button>
                  </form>
                  {section.body &&
                    (["tighten", "enrich", "rewrite"] as const).map((mode) => (
                      <form key={mode} action={refineSectionAction}>
                        <input type="hidden" name="number" value={number} />
                        <input type="hidden" name="section" value={section.key} />
                        <input type="hidden" name="mode" value={mode} />
                        <button type="submit" style={menuItem} className="oi-hover">
                          {t(`postMortem.refine.${mode}`)}
                        </button>
                      </form>
                    ))}
                  <div style={{ padding: "6px 10px 4px", fontSize: 11, color: "var(--ink-3)" }}>
                    {t("postMortem.aiMenuNote")}
                  </div>
                </div>
              </details>
            )}
            <details style={{ position: "relative" }}>
              <summary
                style={{ ...small, listStyle: "none" }}
                aria-label={t("postMortem.more")}
                title={t("postMortem.more")}
              >
                ···
              </summary>
              <div style={menu}>
                <form action={movePostMortemSection}>
                  <input type="hidden" name="number" value={number} />
                  <input type="hidden" name="section" value={section.key} />
                  <input type="hidden" name="dir" value="up" />
                  <button
                    type="submit"
                    style={menuItem}
                    className="oi-hover"
                    disabled={index === 0}
                  >
                    {t("postMortem.moveUp")}
                  </button>
                </form>
                <form action={movePostMortemSection}>
                  <input type="hidden" name="number" value={number} />
                  <input type="hidden" name="section" value={section.key} />
                  <input type="hidden" name="dir" value="down" />
                  <button
                    type="submit"
                    style={menuItem}
                    className="oi-hover"
                    disabled={index === count - 1}
                  >
                    {t("postMortem.moveDown")}
                  </button>
                </form>
                <button
                  type="button"
                  style={menuItem}
                  className="oi-hover"
                  onClick={() => setRenaming(true)}
                >
                  {t("postMortem.rename")}
                </button>
                {removable && (
                  <form
                    action={deletePostMortemSection}
                    onSubmit={(e) => {
                      if (!window.confirm(t("postMortem.deleteConfirm"))) e.preventDefault();
                    }}
                  >
                    <input type="hidden" name="number" value={number} />
                    <input type="hidden" name="section" value={section.key} />
                    <button
                      type="submit"
                      style={{ ...menuItem, color: "var(--dang)" }}
                      className="oi-hover"
                    >
                      {t("common.delete")}
                    </button>
                  </form>
                )}
              </div>
            </details>
          </span>
        )}
        {canAct && <CommentButton count={open.length} onClick={() => setComposing((v) => !v)} />}
      </div>

      {review && review.verdict !== "supported" && review.note && (
        <div
          style={{
            margin: "0 0 4px",
            padding: "7px 11px",
            borderRadius: 8,
            background: verdictTone.bg,
            color: verdictTone.ink,
            fontSize: 12.5,
            lineHeight: 1.5,
          }}
        >
          {review.note}
        </div>
      )}

      {editing ? (
        <form
          action={async (fd) => {
            await savePostMortemBody(fd);
            setEditing(false);
          }}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            border: "1px solid var(--line)",
            borderRadius: 12,
            padding: 10,
            background: "var(--sunk)",
          }}
        >
          <input type="hidden" name="number" value={number} />
          <input type="hidden" name="section" value={section.key} />
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
            {tool("B", () => apply("**", "**"), t("postMortem.tool.bold"))}
            {tool("I", () => apply("_", "_"), t("postMortem.tool.italic"))}
            {tool("H3", () => apply("### ", "", true), t("postMortem.tool.heading"))}
            {tool("•", () => apply("- ", "", true), t("postMortem.tool.bullets"))}
            {tool("1.", () => apply("1. ", "", true), t("postMortem.tool.numbered"))}
            {tool("❝", () => apply("> ", "", true), t("postMortem.tool.quote"))}
            {tool("</>", () => apply("```\n", "\n```", true), t("postMortem.tool.code"))}
            {tool("🔗", () => apply("[", "](https://)"), t("postMortem.tool.link"))}
            <span style={{ width: 1, height: 18, background: "var(--line)", margin: "0 4px" }} />
            <span style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 600 }}>
              {t("postMortem.tool.insert")}
            </span>
            {tool(
              t("postMortem.block.timeline"),
              () => insertBlock(blocks.timeline),
              t("postMortem.block.timelineHint"),
            )}
            {tool(
              t("postMortem.block.followUps"),
              () => insertBlock(blocks.followUps),
              t("postMortem.block.followUpsHint"),
            )}
            {tool(
              t("postMortem.block.impact"),
              () => insertBlock(blocks.impact),
              t("postMortem.block.impactHint"),
            )}
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => setPreview((v) => !v)}
              aria-pressed={preview}
              style={{ ...small, color: preview ? "var(--brand)" : "var(--ink-3)" }}
            >
              {preview ? t("postMortem.tool.write") : t("postMortem.tool.preview")}
            </button>
          </div>
          {preview ? (
            <div
              className="oi-prose"
              data-testid="pm-preview"
              style={{
                minHeight: 120,
                padding: "8px 12px",
                background: "var(--panel)",
                borderRadius: 9,
                border: "1px solid var(--line)",
              }}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          ) : (
            <textarea
              ref={area}
              name="body"
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                  e.currentTarget.form?.requestSubmit();
              }}
              rows={Math.min(28, Math.max(6, draftBody.split("\n").length + 2))}
              autoFocus
              placeholder={hint}
              className="oi-field"
              style={{
                border: "1px solid var(--line)",
                borderRadius: 9,
                padding: "10px 13px",
                fontSize: 13.5,
                lineHeight: 1.6,
                resize: "vertical",
                outline: "none",
                background: "var(--panel)",
                fontFamily: "var(--font-mono)",
              }}
            />
          )}
          {preview && <input type="hidden" name="body" value={draftBody} />}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="submit"
              style={{
                height: 30,
                padding: "0 12px",
                borderRadius: 8,
                background: "var(--brand)",
                color: "var(--on-brand)",
                border: 0,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t("common.save")}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              style={{
                height: 30,
                padding: "0 11px",
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "var(--panel)",
                fontSize: 12.5,
                cursor: "pointer",
                color: "inherit",
              }}
            >
              {t("common.cancel")}
            </button>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
              {t("postMortem.tool.markdownHint")} · {draftBody.length}
            </span>
          </div>
        </form>
      ) : section.body.trim() === "" ? (
        <p style={{ margin: 0, fontSize: 14, color: "var(--ink-3)", fontStyle: "italic" }}>
          {hint || t("postMortem.emptySection")}
        </p>
      ) : fromRca ? (
        <div
          style={{
            borderLeft: "3px solid var(--viol)",
            padding: "4px 0 4px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {prose}
          <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
            {fromRcaLine[0]}
            <Link
              href={`/app/incidents/${number}?tab=rca`}
              style={{ color: "var(--brand)", fontWeight: 600, textDecoration: "none" }}
            >
              {t("inc2.dtab.rca")}
            </Link>
            {fromRcaLine[1]}
          </div>
        </div>
      ) : (
        prose
      )}

      <SectionNotes
        number={number}
        sectionKey={section.key}
        comments={comments}
        canAct={canAct}
        composing={composing}
        me={me}
        onPosted={() => setComposing(false)}
      />
    </section>
  );
}
