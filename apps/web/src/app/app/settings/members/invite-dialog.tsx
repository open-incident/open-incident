"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import { inviteMembers } from "./actions";

/** "+ Invite" — addresses separated by commas, one role for the batch. */
export function InviteDialog() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const control: React.CSSProperties = {
    height: 38,
    padding: "0 12px",
    border: "1px solid var(--line)",
    borderRadius: 10,
    outline: "none",
    fontSize: 13,
    background: "var(--panel)",
    width: "100%",
  };
  return (
    <>
      <button
        type="button"
        data-testid="invite-open"
        onClick={() => setOpen(true)}
        style={{
          height: 32,
          padding: "0 14px",
          borderRadius: 9,
          background: "var(--brand)",
          color: "#fff",
          border: 0,
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {t("settings.members.invite")}
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(13,18,19,.52)",
            display: "grid",
            placeItems: "center",
            padding: 24,
            zIndex: 60,
          }}
        >
          <form
            data-testid="invite-form"
            action={inviteMembers}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            className="oi-rise"
            style={{
              width: 480,
              maxWidth: "100%",
              background: "var(--panel)",
              borderRadius: 18,
              boxShadow: "var(--shadow-modal)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 20px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <div style={{ fontFamily: "var(--font-title)", fontSize: 16.5, fontWeight: 600 }}>
                {t("settings.members.inviteTitle")}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("common.close")}
                className="oi-hover"
                style={{
                  marginLeft: "auto",
                  width: 30,
                  height: 30,
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
              style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 13 }}
            >
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="oi-label">{t("settings.members.emails")}</span>
                <textarea
                  name="emails"
                  required
                  rows={3}
                  autoFocus
                  placeholder="marc@skylark.dev, sophie@skylark.dev"
                  className="oi-field"
                  style={{
                    ...control,
                    height: "auto",
                    padding: "10px 12px",
                    resize: "vertical",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12.5,
                  }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="oi-label">{t("settings.members.role")}</span>
                <select name="role" defaultValue="responder" className="oi-field" style={control}>
                  <option value="admin">{t("member.role.admin")}</option>
                  <option value="responder">{t("member.role.responder")}</option>
                  <option value="viewer">{t("member.role.viewer")}</option>
                </select>
              </label>
              <div
                className="oi-note"
                style={{ borderRadius: 11, padding: "11px 13px", fontSize: 12 }}
              >
                {t("settings.members.inviteNote")}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "14px 20px",
                borderTop: "1px solid var(--line)",
              }}
            >
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="oi-hover"
                style={{
                  height: 34,
                  padding: "0 13px",
                  border: "1px solid var(--line)",
                  borderRadius: 9,
                  background: "var(--panel)",
                  fontSize: 12.5,
                  cursor: "pointer",
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                style={{
                  height: 34,
                  padding: "0 16px",
                  borderRadius: 9,
                  background: "var(--brand)",
                  color: "#fff",
                  border: 0,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {t("settings.members.sendInvites")}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
