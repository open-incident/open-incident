"use client";

import { useEffect, useState, useTransition } from "react";
import { useT } from "@/i18n/client";
import { draftUpdateMessage } from "./ai-actions";
import { postUpdate } from "./actions";

type Opt = { id: string; name: string; rank: number };

const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};
const field: React.CSSProperties = {
  height: 36,
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "0 9px",
  fontSize: 13,
  background: "var(--panel)",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

/**
 * "Share an update" — the one gesture of a live incident, as the design's right
 * drawer: the new status as pills, the message (which the assistant can draft),
 * where it goes, and when to be reminded. "Declare resolved" is the same drawer
 * with the resolving status already chosen: a resolution still says why.
 */
export function UpdateDialog({
  number,
  statuses,
  severities,
  currentStatusId,
  currentSeverityName,
  openInitially,
  initialStatus,
  initialMessage = "",
  resolved = false,
  slackChannel = null,
  statusPage = null,
  aiDraft = false,
}: {
  number: number;
  statuses: Opt[];
  severities: Opt[];
  currentStatusId: string | null;
  currentSeverityName: string | null;
  openInitially?: boolean;
  /** "resolve", when the reader arrived through "Declare resolved". */
  initialStatus?: string;
  /** The assistant's summary, when the reader asked to turn it into an update. */
  initialMessage?: string;
  /** Already resolved: the drawer stays, the resolving shortcut goes. */
  resolved?: boolean;
  slackChannel?: string | null;
  statusPage?: { name: string; published: boolean; checked: boolean } | null;
  aiDraft?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(Boolean(openInitially));
  const [mirrorChat, setMirrorChat] = useState(true);
  const [publish, setPublish] = useState(statusPage?.checked ?? false);
  const [statusId, setStatusId] = useState<string>(
    initialStatus ?? currentStatusId ?? statuses[0]?.id ?? "resolve",
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState(initialMessage);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [aiDrafted, setAiDrafted] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const openWith = (id: string) => {
    setStatusId(id);
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        data-testid="update-open"
        onClick={() => openWith(initialStatus ?? currentStatusId ?? statuses[0]?.id ?? "resolve")}
        className="oi-hover-brand-2"
        style={{
          height: 34,
          padding: "0 15px",
          borderRadius: 9,
          background: "var(--brand)",
          color: "var(--on-brand)",
          border: 0,
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {t("incident.update.cta")}
      </button>
      {!resolved && (
        <button
          type="button"
          data-testid="resolve-open"
          onClick={() => openWith("resolve")}
          className="oi-hover-ok"
          style={{
            height: 34,
            padding: "0 13px",
            border: "1px solid var(--line)",
            borderRadius: 9,
            background: "var(--panel)",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--ok)",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {t("inc2.resolve")}
        </button>
      )}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim)",
            zIndex: 50,
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <form
            data-testid="update-form"
            role="dialog"
            aria-label={t("inc2.upd.drawerLabel")}
            onClick={(e) => e.stopPropagation()}
            className="oi-rise-fast"
            action={(fd) => {
              setError(null);
              start(async () => {
                const res = await postUpdate(fd);
                if (res && "error" in res) setError(res.error);
                else setOpen(false);
              });
            }}
            style={{
              width: 420,
              maxWidth: "100vw",
              height: "100%",
              background: "var(--panel)",
              boxShadow: "var(--shadow-modal)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <input type="hidden" name="number" value={number} />
            <input type="hidden" name="statusId" value={statusId} />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "16px 20px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span style={{ fontFamily: "var(--title)", fontSize: 17, fontWeight: 600 }}>
                {t("incident.update.title")}
              </span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("common.close")}
                className="oi-hover"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  border: 0,
                  background: "transparent",
                  color: "var(--ink-3)",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "18px 20px",
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("inc2.upd.status")}</span>
                <div role="radiogroup" style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {[
                    ...statuses.map((s) => ({ id: s.id, name: s.name })),
                    { id: "resolve", name: t("incident.update.resolved") },
                  ].map((s) => {
                    const on = statusId === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setStatusId(s.id)}
                        style={{
                          height: 30,
                          padding: "0 12px",
                          border: on ? "1.5px solid var(--brand)" : "1px solid var(--line)",
                          borderRadius: 999,
                          background: on ? "var(--brand-t)" : "var(--panel)",
                          color: on ? "var(--brand)" : "var(--ink-2)",
                          display: "flex",
                          alignItems: "center",
                          fontSize: 12.5,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {s.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <span style={label}>{t("incident.update.message")}</span>
                  <span style={{ flex: 1 }} />
                  {aiDraft && (
                    <button
                      type="button"
                      data-testid="ai-draft-update"
                      disabled={drafting}
                      onClick={async () => {
                        setDrafting(true);
                        setDraftError(null);
                        const out = await draftUpdateMessage(number);
                        if ("error" in out) setDraftError(out.error);
                        else {
                          setMessage(out.value);
                          setAiDrafted(true);
                        }
                        setDrafting(false);
                      }}
                      style={{
                        background: "none",
                        border: 0,
                        padding: 0,
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: "var(--viol)",
                        cursor: "pointer",
                        opacity: drafting ? 0.6 : 1,
                      }}
                    >
                      ✦ {drafting ? t("ai.working") : t("ai.update.draft")}
                    </button>
                  )}
                </div>
                {draftError && (
                  <span role="alert" style={{ fontSize: 12, color: "var(--dang)" }}>
                    {draftError}
                  </span>
                )}
                <textarea
                  name="message"
                  required
                  rows={5}
                  autoFocus
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    setAiDrafted(false);
                  }}
                  placeholder={t("incident.update.messagePlaceholder")}
                  className="oi-field"
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    fontSize: 13.5,
                    lineHeight: 1.5,
                    resize: "vertical",
                    outline: "none",
                    background: "var(--panel)",
                  }}
                />
                {aiDrafted && (
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: "var(--viol)",
                      background: "var(--viol-t)",
                      borderRadius: 5,
                      padding: "2px 7px",
                      width: "fit-content",
                    }}
                  >
                    {t("inc2.upd.draftTag")}
                  </span>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={label}>{t("inc2.upd.sendTo")}</span>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    fontSize: 13,
                    color: "var(--ink-2)",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: "var(--ok)",
                      marginLeft: 4,
                    }}
                  />
                  {t("inc2.upd.subscribers")}
                  <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                    {t("inc2.upd.always")}
                  </span>
                </div>
                {statusPage && (
                  <label
                    data-testid="update-status-page-toggle"
                    style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13 }}
                  >
                    <input
                      type="checkbox"
                      checked={publish}
                      onChange={(e) => setPublish(e.target.checked)}
                      style={{ width: 15, height: 15, accentColor: "var(--brand)" }}
                    />
                    {t("incident.update.statusPage", { page: statusPage.name })}
                    <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                      {statusPage.published
                        ? t("incident.update.statusPagePublished")
                        : t("incident.update.statusPagePublic")}
                    </span>
                    <input type="hidden" name="statusPage" value={publish ? "on" : "off"} />
                  </label>
                )}
                {slackChannel && (
                  <label
                    data-testid="update-slack-toggle"
                    style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13 }}
                  >
                    <input
                      type="checkbox"
                      checked={mirrorChat}
                      onChange={(e) => setMirrorChat(e.target.checked)}
                      style={{ width: 15, height: 15, accentColor: "var(--brand)" }}
                    />
                    {t("incident.update.slackChannel", { channel: `#${slackChannel}` })}
                    <input type="hidden" name="chat" value={mirrorChat ? "on" : "off"} />
                  </label>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style={label}>{t("incident.update.severity")}</span>
                  <select name="severityId" defaultValue="" className="oi-field" style={field}>
                    <option value="">
                      {currentSeverityName
                        ? t("incident.update.keepSeverity", { severity: currentSeverityName })
                        : t("incident.update.noSeverity")}
                    </option>
                    {severities.map((sv) => (
                      <option key={sv.id} value={sv.id}>
                        {sv.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style={label}>{t("incident.update.nextReminder")}</span>
                  <select
                    name="nextUpdateMinutes"
                    defaultValue={statusId === "resolve" ? "" : "30"}
                    disabled={statusId === "resolve"}
                    className="oi-field"
                    style={field}
                  >
                    <option value="">{t("incident.update.noReminder")}</option>
                    {[15, 30, 60, 120].map((m) => (
                      <option key={m} value={m}>
                        {t("incident.update.inMinutes", { count: m })}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {error && (
                <p
                  role="alert"
                  style={{
                    margin: 0,
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: "var(--dang-t)",
                    border: "1px solid var(--dang)",
                    color: "var(--dang)",
                    fontSize: 13,
                  }}
                >
                  {error}
                </p>
              )}
              <p style={{ margin: 0, fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
                {t("incident.update.footer")}
              </p>
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                padding: "14px 20px",
                borderTop: "1px solid var(--line)",
              }}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  height: 36,
                  padding: "0 14px",
                  border: "1px solid var(--line)",
                  borderRadius: 9,
                  background: "var(--panel)",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={pending}
                className="oi-hover-brand-2"
                style={{
                  flex: 1,
                  height: 36,
                  borderRadius: 9,
                  border: 0,
                  background: "var(--brand)",
                  color: "var(--on-brand)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  opacity: pending ? 0.6 : 1,
                }}
              >
                {pending ? t("common.saving") : t("incident.update.submit")}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
