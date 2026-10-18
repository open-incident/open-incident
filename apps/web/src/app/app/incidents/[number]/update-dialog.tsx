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

/** Monochrome glyphs of the "Send to" lines — the design's, never a brand logo. */
const GLYPH = {
  mail: (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  ),
  page: (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
    </svg>
  ),
  slack: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <rect x="3" y="10" width="8" height="4" rx="2" />
      <rect x="13" y="10" width="8" height="4" rx="2" />
      <rect x="10" y="3" width="4" height="8" rx="2" />
      <rect x="10" y="13" width="4" height="8" rx="2" />
    </svg>
  ),
  teams: (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="3" y="6" width="12" height="12" rx="2" />
      <circle cx="18" cy="8" r="2.5" />
      <path d="M15 12h6v5" />
    </svg>
  ),
};

type Win = Window & { __oiUpdateReady?: boolean };

/**
 * Opens the drawer from anywhere on the page — "Share update", "Declare
 * resolved". Before the drawer is listening (a click during hydration), the
 * address that opens it does the same.
 */
export function openUpdate(status?: "resolve") {
  if (!(window as Win).__oiUpdateReady) {
    const url = new URL(window.location.href);
    url.searchParams.set("update", "1");
    if (status) url.searchParams.set("status", status);
    window.location.assign(url.toString());
    return;
  }
  window.dispatchEvent(new CustomEvent("oi:update", { detail: { status } }));
}

/** A header button that opens the drawer, with the resolving status chosen or not. */
export function UpdateButton({
  mode,
  children,
  testid,
}: {
  mode: "update" | "resolve";
  children: React.ReactNode;
  testid: string;
}) {
  const primary = mode === "update";
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={() => openUpdate(mode === "resolve" ? "resolve" : undefined)}
      className={primary ? "oi-hover-brand-2" : "oi-hover-ok"}
      style={{
        height: 34,
        padding: primary ? "0 15px" : "0 13px",
        borderRadius: 9,
        border: primary ? 0 : "1px solid var(--line)",
        background: primary ? "var(--brand)" : "var(--panel)",
        color: primary ? "var(--on-brand)" : "var(--ok)",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
        display: "flex",
        alignItems: "center",
      }}
    >
      {children}
    </button>
  );
}

/**
 * "Share an update" — the one gesture of a live incident, as the design's right
 * drawer: the new status as pills, the message (which Atlas can draft), where
 * it goes — the people on the incident, the status page, the Slack and Teams
 * channels, each one a switch — and when to be reminded. "Declare resolved"
 * is the same drawer with the resolving status already chosen: a resolution
 * still says why.
 */
export function UpdateDialog({
  number,
  statuses,
  currentStatusId,
  openInitially,
  initialStatus,
  initialMessage = "",
  subscribers,
  statusPage = null,
  slackChannel = null,
  teamsChannel = null,
  aiDraft = false,
}: {
  number: number;
  statuses: Opt[];
  currentStatusId: string | null;
  openInitially?: boolean;
  /** "resolve", when the reader arrived through "Declare resolved". */
  initialStatus?: "resolve";
  /** The assistant's summary, when the reader asked to turn it into an update. */
  initialMessage?: string;
  /** The people on the incident who would be told — the author excluded. */
  subscribers: number;
  statusPage?: { name: string; published: boolean; checked: boolean } | null;
  /** "#inc-217", when the incident has a Slack channel. */
  slackChannel?: string | null;
  /** "Teams › Incidents", when the incident has a Teams channel. */
  teamsChannel?: string | null;
  aiDraft?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(Boolean(openInitially));
  const [publish, setPublish] = useState(statusPage?.checked ?? false);
  const [toSubscribers, setToSubscribers] = useState(true);
  const [toSlack, setToSlack] = useState(true);
  const [toTeams, setToTeams] = useState(true);
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
    const onOpen = (e: Event) => {
      const status = (e as CustomEvent<{ status?: string }>).detail?.status;
      setStatusId(status ?? currentStatusId ?? statuses[0]?.id ?? "resolve");
      setOpen(true);
    };
    window.addEventListener("oi:update", onOpen);
    (window as Win).__oiUpdateReady = true;
    return () => {
      window.removeEventListener("oi:update", onOpen);
      (window as Win).__oiUpdateReady = false;
    };
  }, [currentStatusId, statuses]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  const dest = (
    key: string,
    glyph: React.ReactNode,
    text: string,
    meta: string,
    checked: boolean,
    set: (v: boolean) => void,
    name: string,
    testid?: string,
  ) => (
    <label
      key={key}
      data-testid={testid}
      style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, cursor: "pointer" }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => set(e.target.checked)}
        style={{ width: 15, height: 15, accentColor: "var(--brand)", margin: 0 }}
      />
      <span
        aria-hidden
        style={{
          width: 16,
          height: 16,
          display: "grid",
          placeItems: "center",
          color: "var(--ink-2)",
        }}
      >
        {glyph}
      </span>
      {text}
      {meta && <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{meta}</span>}
      <input type="hidden" name={name} value={checked ? "on" : "off"} />
    </label>
  );

  return (
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
            else {
              setOpen(false);
              setMessage("");
              setAiDrafted(false);
            }
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
                  ✦ {drafting ? t("ai.working") : t("incv2.upd.draftWithAtlas")}
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
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                  e.currentTarget.form?.requestSubmit();
              }}
              placeholder={t("incv2.upd.placeholder")}
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
                fontFamily: "inherit",
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
            {dest(
              "subscribers",
              GLYPH.mail,
              t("incv2.upd.subscribers"),
              t.fmt.number(subscribers),
              toSubscribers,
              setToSubscribers,
              "subscribers",
              "update-subscribers-toggle",
            )}
            {statusPage &&
              dest(
                "page",
                GLYPH.page,
                statusPage.name,
                statusPage.published
                  ? t("incident.update.statusPagePublished")
                  : t("incident.update.statusPagePublic"),
                publish,
                setPublish,
                "statusPage",
                "update-status-page-toggle",
              )}
            {slackChannel &&
              dest(
                "slack",
                GLYPH.slack,
                `Slack ${slackChannel}`,
                "",
                toSlack,
                setToSlack,
                "slack",
                "update-slack-toggle",
              )}
            {teamsChannel &&
              dest(
                "teams",
                GLYPH.teams,
                teamsChannel,
                "",
                toTeams,
                setToTeams,
                "teams",
                "update-teams-toggle",
              )}
          </div>

          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={label}>{t("incv2.upd.remind")}</span>
            <select
              name="nextUpdateMinutes"
              defaultValue={statusId === "resolve" ? "" : "30"}
              key={statusId === "resolve" ? "resolve" : "open"}
              disabled={statusId === "resolve"}
              className="oi-field"
              style={{
                height: 36,
                border: "1px solid var(--line)",
                borderRadius: 10,
                padding: "0 9px",
                fontSize: 13,
                background: "var(--panel)",
                outline: "none",
              }}
            >
              {[30, 15, 60].map((m) => (
                <option key={m} value={m}>
                  {m === 60 ? t("incv2.upd.inHour") : t("incident.update.inMinutes", { count: m })}
                </option>
              ))}
              <option value="">{t("incident.update.noReminder")}</option>
            </select>
          </label>

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
              color: "inherit",
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
            {pending ? t("common.saving") : t("incv2.upd.submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
