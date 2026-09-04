"use client";

import { useEffect, useState, useTransition } from "react";
import { useT } from "@/i18n/client";
import { draftUpdateMessage } from "./ai-actions";
import { postUpdate } from "./actions";

type Opt = { id: string; name: string; rank: number };

/**
 * "Share an update" — the one gesture of the incident: a status (or Resolved),
 * a short message, optionally a severity and the next reminder. The design's
 * modal: 520 px, radius 18, the status choices as pills.
 */
export function UpdateDialog({
  number,
  statuses,
  severities,
  currentStatusId,
  currentSeverityName,
  openInitially,
  slackChannel = null,
  statusPage = null,
  aiDraft = false,
}: {
  number: number;
  statuses: Opt[];
  severities: Opt[];
  currentStatusId: string | null;
  currentSeverityName: string | null;
  /** The incident's Slack channel, when it has one: the update is mirrored there unless unticked. */
  slackChannel?: string | null;
  /** The workspace's status page, when the incident qualifies or is already published there. */
  statusPage?: { name: string; published: boolean; checked: boolean } | null;
  /** Whether the assistant may draft the message (instance configured, workspace and capability on). */
  aiDraft?: boolean;
  openInitially?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(Boolean(openInitially));
  const [mirrorChat, setMirrorChat] = useState(true);
  const [publish, setPublish] = useState(statusPage?.checked ?? false);
  const [statusId, setStatusId] = useState<string>(currentStatusId ?? statuses[0]?.id ?? "resolve");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [aiDrafted, setAiDrafted] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const control: React.CSSProperties = {
    height: 38,
    padding: "0 12px",
    border: "1px solid var(--line)",
    borderRadius: 9,
    fontSize: 13,
    background: "var(--panel)",
    outline: "none",
    width: "100%",
  };

  return (
    <>
      <button
        type="button"
        data-testid="update-open"
        onClick={() => setOpen(true)}
        style={{
          height: 36,
          padding: "0 16px",
          borderRadius: 9,
          background: "var(--brand)",
          color: "#fff",
          border: 0,
          fontSize: 13.5,
          fontWeight: 600,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {t("incident.update.cta")}
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(8,12,14,.45)",
            backdropFilter: "blur(2px)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: "8vh",
            zIndex: 60,
          }}
        >
          <form
            data-testid="update-form"
            onClick={(e) => e.stopPropagation()}
            action={(fd) => {
              setError(null);
              start(async () => {
                const res = await postUpdate(fd);
                if (res && "error" in res) setError(res.error);
                else setOpen(false);
              });
            }}
            className="oi-rise-modal"
            role="dialog"
            aria-label={t("incident.update.title")}
            style={{
              width: 520,
              maxWidth: "94vw",
              background: "var(--panel)",
              borderRadius: 18,
              boxShadow: "var(--shadow-modal)",
              overflow: "hidden",
            }}
          >
            <input type="hidden" name="number" value={number} />
            <input type="hidden" name="statusId" value={statusId} />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "16px 22px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-title)",
                  fontSize: 17,
                  fontWeight: 600,
                  letterSpacing: "-.015em",
                }}
              >
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
                  fontSize: 15,
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>
            <div
              style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>
                  {t("incident.update.newStatus")}
                </span>
                <div role="radiogroup" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {[
                    ...statuses.map((s) => ({ id: s.id, label: s.name })),
                    { id: "resolve", label: t("incident.update.resolved") },
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
                          padding: "0 13px",
                          border: on ? "1.5px solid var(--brand)" : "1px solid var(--line)",
                          borderRadius: 999,
                          background: on ? "var(--brand-t)" : "var(--panel)",
                          display: "inline-flex",
                          alignItems: "center",
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: on ? "var(--brand)" : "var(--ink-2)",
                          cursor: "pointer",
                        }}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "var(--ink-2)",
                  }}
                >
                  {t("incident.update.message")}
                  <span style={{ flex: 1 }} />
                  {aiDrafted && (
                    <span
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
                      {t("ai.badge")}
                    </span>
                  )}
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
                </span>
                {draftError && (
                  <span role="alert" style={{ fontSize: 12, color: "var(--dang)" }}>
                    {draftError}
                  </span>
                )}
                <textarea
                  name="message"
                  required
                  rows={4}
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
                    padding: "10px 13px",
                    fontSize: 13.5,
                    resize: "vertical",
                    outline: "none",
                    background: "var(--panel)",
                    lineHeight: 1.6,
                  }}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>
                    {t("incident.update.severity")}
                  </span>
                  <select name="severityId" defaultValue="" className="oi-field" style={control}>
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
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>
                    {t("incident.update.nextReminder")}
                  </span>
                  <select
                    name="nextUpdateMinutes"
                    defaultValue={statusId === "resolve" ? "" : "30"}
                    disabled={statusId === "resolve"}
                    className="oi-field"
                    style={control}
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
              {(slackChannel || statusPage) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>
                    {t("incident.update.sendAlso")}
                  </span>
                  {statusPage && (
                    <label
                      data-testid="update-status-page-toggle"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 9,
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={publish}
                        onChange={(e) => setPublish(e.target.checked)}
                        style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
                      />
                      <span
                        aria-hidden
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 5,
                          background: publish ? "var(--brand)" : "var(--sunk)",
                          border: publish ? "1px solid var(--brand)" : "1.5px solid var(--line)",
                          display: "grid",
                          placeItems: "center",
                          color: "#fff",
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {publish ? "✓" : ""}
                      </span>
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
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 9,
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={mirrorChat}
                        onChange={(e) => setMirrorChat(e.target.checked)}
                        style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
                      />
                      <span
                        aria-hidden
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 5,
                          background: mirrorChat ? "var(--brand)" : "var(--sunk)",
                          border: mirrorChat ? "1px solid var(--brand)" : "1.5px solid var(--line)",
                          display: "grid",
                          placeItems: "center",
                          color: "#fff",
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {mirrorChat ? "✓" : ""}
                      </span>
                      {t("incident.update.slackChannel", { channel: `#${slackChannel}` })}
                      <input type="hidden" name="chat" value={mirrorChat ? "on" : "off"} />
                    </label>
                  )}
                </div>
              )}
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
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "14px 22px",
                borderTop: "1px solid var(--line)",
                background: "var(--canvas)",
              }}
            >
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {t("incident.update.footer")}
              </span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  height: 36,
                  padding: "0 14px",
                  border: "1px solid var(--line)",
                  borderRadius: 9,
                  background: "var(--panel)",
                  fontSize: 13.5,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={pending}
                style={{
                  height: 36,
                  padding: "0 16px",
                  borderRadius: 9,
                  background: "var(--brand)",
                  color: "#fff",
                  border: 0,
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
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
