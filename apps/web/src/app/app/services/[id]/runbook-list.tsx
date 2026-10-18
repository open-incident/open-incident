"use client";

/**
 * RUNBOOKS — the titles, as links. Opening one shows where it comes from, when
 * it was last fetched (or why the fetch failed — the last copy is kept), the
 * text itself, and for a manager the two things to do with it: fetch again,
 * remove.
 */

import { useState } from "react";
import { useT } from "@/i18n/client";
import { deleteRunbook, refreshRunbookAction } from "../actions";
import { BTN_GHOST, Dialog } from "../dialog";

export type RunbookView = {
  id: string;
  title: string;
  sourceUrl: string | null;
  content: string;
  fetchError: string | null;
  fetchedAt: string | null;
  /** Attached to the whole workspace rather than to this service. */
  workspaceWide: boolean;
};

export function RunbookList({
  serviceId,
  runbooks,
  mayManage,
}: {
  serviceId: string;
  runbooks: RunbookView[];
  mayManage: boolean;
}) {
  const t = useT();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = runbooks.find((r) => r.id === openId) ?? null;

  if (runbooks.length === 0)
    return <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("svc.runbooks.none")}</div>;

  return (
    <>
      {runbooks.map((r) => (
        <div
          key={r.id}
          data-testid="runbook-row"
          style={{ display: "flex", flexDirection: "column" }}
        >
          <button
            type="button"
            onClick={() => setOpenId(r.id)}
            style={{
              fontSize: 12.5,
              color: r.fetchError ? "var(--dang)" : "var(--brand)",
              fontWeight: 600,
              cursor: "pointer",
              border: 0,
              background: "none",
              padding: 0,
              textAlign: "left",
            }}
          >
            {r.title}
            {r.workspaceWide && (
              <span style={{ fontWeight: 500, color: "var(--ink-3)" }}>
                {" "}
                · {t("services.runbookWorkspace")}
              </span>
            )}
          </button>
        </div>
      ))}
      {open && (
        <Dialog
          title={open.title}
          onClose={() => setOpenId(null)}
          width={620}
          testId="runbook-detail"
        >
          <div style={{ fontSize: 12, color: open.fetchError ? "var(--dang)" : "var(--ink-3)" }}>
            {open.fetchError
              ? t("svc.runbooks.fetchError", { error: open.fetchError })
              : open.fetchedAt
                ? t("svc.runbooks.fetchedAt", { when: t.fmt.relative(new Date(open.fetchedAt)) })
                : t("svc.runbooks.pasted", { chars: open.content.length })}
            {open.sourceUrl && (
              <>
                {" · "}
                <a
                  href={open.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="oi-link"
                  style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}
                >
                  {open.sourceUrl}
                </a>
              </>
            )}
          </div>
          <pre
            style={{
              margin: 0,
              background: "var(--sunk)",
              borderRadius: 10,
              padding: "12px 14px",
              fontFamily: "var(--mono)",
              fontSize: 12,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 360,
              overflowY: "auto",
              color: "var(--ink-2)",
            }}
          >
            {open.content || t("services.runbookEmpty")}
          </pre>
          {mayManage && !open.workspaceWide && (
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              {open.sourceUrl && (
                <form action={refreshRunbookAction}>
                  <input type="hidden" name="id" value={open.id} />
                  <input type="hidden" name="serviceId" value={serviceId} />
                  <button type="submit" className="oi-hover" style={BTN_GHOST}>
                    ↻ {t("svc.runbooks.refresh")}
                  </button>
                </form>
              )}
              <form action={deleteRunbook}>
                <input type="hidden" name="id" value={open.id} />
                <input type="hidden" name="serviceId" value={serviceId} />
                <button
                  type="submit"
                  data-testid="runbook-delete"
                  className="oi-hover-dang"
                  style={{ ...BTN_GHOST, color: "var(--dang)" }}
                >
                  {t("common.delete")}
                </button>
              </form>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
