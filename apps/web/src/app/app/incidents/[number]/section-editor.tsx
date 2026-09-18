"use client";

import { useMemo, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { renderMarkdown } from "@/lib/markdown";
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
  color: "var(--brand)",
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
  boxShadow: "var(--shadow-card)",
  padding: 4,
};

/**
 * One section of the document: rendered as prose, edited as markdown with a
 * toolbar and a live preview, reworked by the assistant one section at a time
 * (regenerate, tighten, enrich, rewrite — a person pays for what they ask),
 * commented, moved, renamed or removed. The person's words always win.
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
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [preview, setPreview] = useState(false);
  const [draft, setDraft] = useState(section.body);
  const [commenting, setCommenting] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const html = useMemo(() => renderMarkdown(section.body), [section.body]);
  const previewHtml = useMemo(() => (preview ? renderMarkdown(draft) : ""), [preview, draft]);
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
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = s + lineStart.length + before.length + selected.length;
      el.setSelectionRange(pos, pos);
    });
  };
  const insertBlock = (text: string) => {
    if (!text) return;
    const el = area.current;
    const s = el?.selectionStart ?? draft.length;
    const pad = s > 0 && draft[s - 1] !== "\n" ? "\n\n" : "";
    const next = draft.slice(0, s) + pad + text + "\n" + draft.slice(s);
    setDraft(next);
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

  return (
    <section
      id={`pm-${section.key}`}
      data-testid={`pm-section-${section.key}`}
      style={{ display: "flex", flexDirection: "column", gap: 8, scrollMarginTop: 80 }}
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
            <button type="submit" style={{ ...small }}>
              {t("common.save")}
            </button>
            <button
              type="button"
              style={{ ...small, color: "var(--ink-3)" }}
              onClick={() => setRenaming(false)}
            >
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
          <>
            <button
              type="button"
              onClick={() => {
                setDraft(section.body);
                setPreview(false);
                setEditing(true);
              }}
              style={small}
            >
              {t("common.edit")}
            </button>
            {aiAllowed && (
              <details style={{ position: "relative" }}>
                <summary
                  style={{ ...small, color: "var(--viol)", listStyle: "none" }}
                  title={t("postMortem.aiMenu")}
                >
                  ✦ {t("postMortem.aiMenu")}
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
            <button
              type="button"
              onClick={() => setCommenting((v) => !v)}
              style={{ ...small, color: open.length ? "var(--brand)" : "var(--ink-3)" }}
              data-testid="pm-comment-toggle"
            >
              {open.length
                ? t("postMortem.comments.count", { count: open.length })
                : t("postMortem.comments.add")}
            </button>
            <details style={{ position: "relative" }}>
              <summary
                style={{ ...small, color: "var(--ink-3)", listStyle: "none" }}
                aria-label={t("postMortem.more")}
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
          </>
        )}
      </div>

      {review && review.verdict !== "supported" && review.note && (
        <div
          style={{
            margin: "0 0 8px",
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
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                  e.currentTarget.form?.requestSubmit();
              }}
              rows={Math.min(28, Math.max(6, draft.split("\n").length + 2))}
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
          {preview && <input type="hidden" name="body" value={draft} />}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="submit"
              style={{
                height: 30,
                padding: "0 12px",
                borderRadius: 8,
                background: "var(--brand)",
                color: "#fff",
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
              }}
            >
              {t("common.cancel")}
            </button>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
              {t("postMortem.tool.markdownHint")} · {draft.length}
            </span>
          </div>
        </form>
      ) : section.body.trim() === "" ? (
        <p style={{ margin: "0 0 4px", fontSize: 13, color: "var(--ink-3)", fontStyle: "italic" }}>
          {hint || t("postMortem.emptySection")}
        </p>
      ) : (
        <div
          className="oi-prose"
          style={{ fontSize: 14 }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}

      {(commenting || open.length > 0) && (
        <div
          data-testid="pm-comments"
          style={{
            marginTop: 8,
            padding: "8px 12px",
            borderLeft: "3px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {comments
            .filter((c) => commenting || !c.resolvedAt)
            .map((c) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  fontSize: 12.5,
                  opacity: c.resolvedAt ? 0.6 : 1,
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{c.memberName}</span>
                  <span style={{ color: "var(--ink-3)" }}>
                    {" "}
                    · {t.fmt.relative(new Date(c.createdAt))}
                  </span>
                  {c.resolvedAt && (
                    <span style={{ color: "var(--ok)" }}>
                      {" "}
                      · {t("postMortem.comments.resolvedBy", { name: c.resolvedByName ?? "" })}
                    </span>
                  )}
                  <span style={{ display: "block", color: "var(--ink-2)", whiteSpace: "pre-wrap" }}>
                    {c.body}
                  </span>
                </span>
                {canAct && (
                  <form action={resolvePostMortemComment}>
                    <input type="hidden" name="number" value={number} />
                    <input type="hidden" name="id" value={c.id} />
                    {c.resolvedAt && <input type="hidden" name="reopen" value="1" />}
                    <button
                      type="submit"
                      style={{ ...small, color: c.resolvedAt ? "var(--ink-3)" : "var(--ok)" }}
                    >
                      {c.resolvedAt
                        ? t("postMortem.comments.reopen")
                        : t("postMortem.comments.resolve")}
                    </button>
                  </form>
                )}
              </div>
            ))}
          {canAct && commenting && (
            <form
              action={async (fd) => {
                await addPostMortemComment(fd);
              }}
              style={{ display: "flex", gap: 6, alignItems: "flex-start" }}
              data-testid="pm-comment-form"
            >
              <input type="hidden" name="number" value={number} />
              <input type="hidden" name="section" value={section.key} />
              <textarea
                name="body"
                required
                rows={2}
                maxLength={4000}
                placeholder={t("postMortem.comments.placeholder")}
                className="oi-field"
                style={{
                  flex: 1,
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: "6px 9px",
                  fontSize: 12.5,
                  background: "var(--panel)",
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
              />
              <button
                type="submit"
                style={{
                  ...small,
                  height: 30,
                  border: "1px solid var(--line)",
                  background: "var(--panel)",
                }}
              >
                {t("postMortem.comments.send")}
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
