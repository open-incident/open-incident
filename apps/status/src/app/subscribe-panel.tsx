"use client";

import { useState } from "react";

/**
 * How a visitor asks to be told.
 *
 * Three channels, and all three are real: an email address with double opt-in,
 * and the two feed addresses this page already serves. The design draws
 * webhook, Slack and Teams chips beside them; this product has no subscription
 * of those kinds, and a public page is the wrong place to advertise what an
 * operator has not built — the reader here is a customer, not an administrator.
 *
 * The outcome of a subscription is not shown here but in the page's own
 * banner: the form posts and the server answers with a redirect, so the
 * message survives a reader with no JavaScript.
 */

export type PanelLabels = {
  getUpdates: string;
  subTitle: string;
  subConfirm: string;
  optinFull: string;
  copy: string;
  copied: string;
  channelEmail: string;
  channelRss: string;
  channelAtom: string;
};

const MAIL = "M3 5h18v14H3zM3 7l9 6 9-6";
const RSS = "M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16";

function Chip({
  on,
  label,
  path,
  onClick,
  accent,
}: {
  on: boolean;
  label: string;
  path: string;
  onClick: () => void;
  accent: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        height: 34,
        padding: "0 13px",
        border: on ? `1px solid ${accent}` : "1px solid rgba(27,25,23,.14)",
        borderRadius: 10,
        background: on ? "rgba(27,25,23,.03)" : "#fff",
        color: on ? accent : "inherit",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d={path} />
      </svg>
      {label}
    </button>
  );
}

export function SubscribePanel({
  accent,
  origin,
  lang,
  labels,
}: {
  accent: string;
  origin: string;
  /** Carried through the round-trip so the answer comes back in the same language. */
  lang: string | null;
  labels: PanelLabels;
}) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<"email" | "rss" | "atom">("email");
  const [copied, setCopied] = useState(false);
  const feed = `${origin}/${channel === "atom" ? "atom.xml" : "rss.xml"}`;

  return (
    <>
      <button
        type="button"
        data-testid="subscribe-open"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="st-sub"
        style={{
          height: 36,
          padding: "0 16px",
          borderRadius: 10,
          background: "#1B1917",
          color: "#fff",
          border: "none",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {labels.getUpdates}
      </button>
      {open && (
        <div
          data-testid="subscribe-panel"
          style={{
            position: "absolute",
            top: 58,
            right: 24,
            width: "min(460px, calc(100vw - 48px))",
            background: "#fff",
            border: "1px solid rgba(27,25,23,.1)",
            borderRadius: 18,
            padding: "18px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            boxShadow: "0 20px 50px -30px rgba(27,25,23,.3)",
            animation: "st-rise .2s ease both",
            zIndex: 40,
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <span style={{ fontFamily: "var(--title)", fontSize: 17, fontWeight: 600 }}>
              {labels.subTitle}
            </span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="close"
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                border: "none",
                background: "none",
                color: "#8A8378",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Chip
              on={channel === "email"}
              label={labels.channelEmail}
              path={MAIL}
              accent={accent}
              onClick={() => setChannel("email")}
            />
            <Chip
              on={channel === "rss"}
              label={labels.channelRss}
              path={RSS}
              accent={accent}
              onClick={() => setChannel("rss")}
            />
            <Chip
              on={channel === "atom"}
              label={labels.channelAtom}
              path={RSS}
              accent={accent}
              onClick={() => setChannel("atom")}
            />
          </div>

          {channel === "email" ? (
            <form
              method="post"
              action="/subscribe"
              data-testid="subscribe-form"
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              {lang && <input type="hidden" name="lang" value={lang} />}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  type="email"
                  name="email"
                  required
                  autoFocus
                  placeholder="you@company.com"
                  className="st-input"
                  style={{
                    flex: 1,
                    minWidth: 220,
                    height: 42,
                    border: "1px solid rgba(27,25,23,.14)",
                    borderRadius: 11,
                    padding: "0 14px",
                    fontSize: 14,
                    outline: "none",
                    background: "#fff",
                  }}
                />
                <button
                  type="submit"
                  style={{
                    height: 42,
                    padding: "0 18px",
                    borderRadius: 11,
                    background: accent,
                    color: "#fff",
                    border: "none",
                    fontSize: 13.5,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {labels.subConfirm}
                </button>
              </div>
              <div style={{ fontSize: 12, color: "#8A8378" }}>{labels.optinFull}</div>
            </form>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "#F4F3EF",
                borderRadius: 11,
                padding: "10px 14px",
              }}
            >
              <code
                style={{
                  flex: 1,
                  fontFamily: "var(--mono)",
                  fontSize: 12.5,
                  wordBreak: "break-all",
                }}
              >
                {feed}
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(feed).then(
                    () => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    },
                    () => setCopied(false),
                  );
                }}
                style={{
                  height: 30,
                  padding: "0 12px",
                  borderRadius: 8,
                  background: "#1B1917",
                  color: "#fff",
                  border: "none",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {copied ? labels.copied : labels.copy}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
