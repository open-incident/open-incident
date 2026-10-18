"use client";

/**
 * "Link by hand": no account of the tool uses the member's email, so an
 * admin picks the right one from the tool's own people (Slack's member list,
 * the paired team's roster) — the accounts nobody is linked to yet.
 */
import { useState } from "react";
import { useT } from "@/i18n/client";
import { initials } from "@/i18n/format";

export type PickState = {
  provider: "slack" | "teams";
  memberId: string;
  member: string;
  email: string;
  accounts: Array<{ id: string; name: string; email: string | null }>;
  /** From Pages in chat: the link also makes the member reachable by direct message. */
  method: boolean;
};

export function LinkPicker({
  state,
  onCancel,
  onPick,
}: {
  state: PickState;
  onCancel: () => void;
  onPick: (externalId: string) => void;
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const N = state.provider === "slack" ? "Slack" : "Microsoft Teams";
  const needle = q.trim().toLowerCase();
  const list = state.accounts.filter(
    (a) =>
      !needle ||
      a.name.toLowerCase().includes(needle) ||
      (a.email ?? "").toLowerCase().includes(needle),
  );
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 85,
        background: "rgba(13,22,28,.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "10vh 16px 16px",
        overflow: "auto",
      }}
    >
      <div
        role="dialog"
        aria-modal
        data-testid="chat-link-picker"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          background: "var(--panel)",
          borderRadius: "var(--radius-modal)",
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
          animation: "ohd-rise .16s ease backwards",
        }}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ fontFamily: "var(--title)", fontSize: 17, fontWeight: 600 }}>
            {t("chat2.pick.t", { member: state.member, name: N })}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 4, lineHeight: 1.5 }}>
            {t("chat2.pick.d", { name: N, email: state.email })}
          </div>
        </div>
        <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("chat2.pick.search")}
            className="oi-field"
            style={{
              height: 34,
              border: "1px solid var(--line)",
              borderRadius: 9,
              padding: "0 10px",
              fontSize: 13,
              background: "var(--panel)",
              color: "var(--ink)",
              outline: "none",
            }}
          />
          <div
            style={{
              maxHeight: 320,
              overflow: "auto",
              border: "1px solid var(--line-2)",
              borderRadius: 11,
            }}
          >
            {list.length === 0 ? (
              <div style={{ padding: "14px 12px", fontSize: 12.5, color: "var(--ink-3)" }}>
                {t("chat2.pick.none")}
              </div>
            ) : (
              list.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  data-testid="chat-link-account"
                  onClick={() => onPick(a.id)}
                  className="oi-hover"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "9px 12px",
                    border: 0,
                    borderTop: "1px solid var(--line-2)",
                    background: "transparent",
                    textAlign: "left",
                    cursor: "pointer",
                    color: "var(--ink)",
                    fontFamily: "inherit",
                  }}
                >
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: "var(--sunk)",
                      color: "var(--ink-2)",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 9.5,
                      fontWeight: 700,
                      flex: "none",
                    }}
                  >
                    {initials(a.name)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 500 }}>
                      {a.name}
                    </span>
                    {a.email && (
                      <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)" }}>
                        {a.email}
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--brand)" }}>
                    {t("chat2.btn.link")}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: "12px 20px",
            borderTop: "1px solid var(--line)",
            background: "var(--sunk)",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              height: 34,
              padding: "0 13px",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--ink-3)",
              background: "transparent",
              border: 0,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {t("chat2.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
