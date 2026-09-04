"use client";

import { useState } from "react";

/** The subscribe button opens the inline form of the design; the form posts to /subscribe (double opt-in). */
export function SubscribeForm({
  accent,
  labels,
}: {
  accent: string;
  labels: { subscribe: string; confirm: string; optin: string };
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        data-testid="subscribe-open"
        onClick={() => setOpen(true)}
        className="st-btn"
        style={{ background: accent }}
      >
        {labels.subscribe}
      </button>
    );
  }
  return (
    <form
      method="post"
      action="/subscribe"
      data-testid="subscribe-form"
      style={{
        flex: "1 1 100%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 13,
        padding: "12px 16px",
        flexWrap: "wrap",
      }}
    >
      <input
        name="email"
        type="email"
        required
        autoFocus
        placeholder="you@company.com"
        className="st-input"
      />
      <button
        type="submit"
        className="st-btn"
        style={{ background: accent, height: 38, padding: "0 14px", fontSize: 13 }}
      >
        {labels.confirm}
      </button>
      <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
        {labels.optin}{" "}
        <a href="/rss.xml" style={{ color: accent, fontWeight: 600 }}>
          RSS
        </a>
      </span>
    </form>
  );
}
