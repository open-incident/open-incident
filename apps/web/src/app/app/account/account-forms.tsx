"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { authClient } from "@/lib/auth-client";

const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};
const control: React.CSSProperties = {
  height: 38,
  padding: "0 12px",
  border: "1px solid var(--line)",
  borderRadius: 10,
  outline: "none",
  fontSize: 13.5,
  background: "var(--panel)",
  width: "100%",
};
const primary: React.CSSProperties = {
  height: 32,
  padding: "0 14px",
  borderRadius: 9,
  background: "var(--brand)",
  color: "#fff",
  border: 0,
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
};

function Notice({
  tone,
  children,
  testId,
}: {
  tone: "ok" | "dang";
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <p
      role={tone === "ok" ? "status" : "alert"}
      data-testid={testId}
      style={{
        margin: 0,
        padding: "10px 12px",
        borderRadius: 10,
        background: tone === "ok" ? "var(--ok-t)" : "var(--dang-t)",
        border: `1px solid ${tone === "ok" ? "var(--ok)" : "var(--dang)"}`,
        color: tone === "ok" ? "var(--ok)" : "var(--dang)",
        fontSize: 13,
      }}
    >
      {children}
    </p>
  );
}

/** New address → confirmation link sent to the CURRENT one; nothing changes until it is clicked. */
export function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");
  return (
    <form
      className="oi-panel"
      style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}
      onSubmit={async (e) => {
        e.preventDefault();
        const newEmail = String(new FormData(e.currentTarget).get("newEmail"));
        const { error } = await authClient.changeEmail({
          newEmail,
          callbackURL: "/app/account?email=changed",
        });
        setState(error ? "error" : "sent");
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600 }}>{t("account.email.title")}</span>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-3)" }}>
        {t("account.email.body", { email: currentEmail })}
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
          <span style={label}>{t("account.email.new")}</span>
          <input
            name="newEmail"
            type="email"
            required
            autoComplete="email"
            className="oi-field"
            style={control}
          />
        </label>
        <button type="submit" style={primary}>
          {t("account.email.submit")}
        </button>
      </div>
      {state === "sent" && <Notice tone="ok">{t("account.email.sent")}</Notice>}
      {state === "error" && <Notice tone="dang">{t("account.email.error")}</Notice>}
    </form>
  );
}

export function ChangePasswordForm() {
  const t = useT();
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  return (
    <form
      data-testid="password-form"
      className="oi-panel"
      style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const { error } = await authClient.changePassword({
          currentPassword: String(fd.get("currentPassword")),
          newPassword: String(fd.get("newPassword")),
          revokeOtherSessions: true,
        });
        setState(error ? "error" : "done");
        if (!error) e.currentTarget.reset();
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600 }}>{t("account.password.title")}</span>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr auto",
          gap: 10,
          alignItems: "flex-end",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={label}>{t("account.password.current")}</span>
          <input
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            className="oi-field"
            style={control}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={label}>{t("account.password.new")}</span>
          <input
            name="newPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="oi-field"
            style={control}
          />
        </label>
        <button type="submit" style={primary}>
          {t("account.password.submit")}
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>{t("account.password.note")}</p>
      {state === "done" && (
        <Notice tone="ok" testId="password-changed">
          {t("account.password.done")}
        </Notice>
      )}
      {state === "error" && <Notice tone="dang">{t("account.password.error")}</Notice>}
    </form>
  );
}

/** Deletion is confirmed by a link sent to the account's mailbox; an owner hands over first. */
export function DeleteAccountForm({ isOwner }: { isOwner: boolean }) {
  const t = useT();
  const router = useRouter();
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");
  return (
    <form
      style={{
        background: "var(--panel)",
        border: "1px solid var(--dang)",
        borderRadius: 14,
        padding: "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (isOwner) return;
        const fd = new FormData(e.currentTarget);
        const { error } = await authClient.deleteUser({
          password: String(fd.get("password")),
          callbackURL: "/login?deleted=1",
        });
        setState(error ? "error" : "sent");
        if (!error) router.refresh();
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--dang)" }}>
        {t("account.delete.title")}
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>
        {isOwner ? t("account.delete.ownerNote") : t("account.delete.body")}
      </p>
      {!isOwner && (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <label
            style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, maxWidth: 320 }}
          >
            <span style={label}>{t("account.password.current")}</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="oi-field"
              style={control}
            />
          </label>
          <button
            type="submit"
            className="oi-hover-dang"
            style={{
              height: 32,
              padding: "0 13px",
              border: "1px solid var(--dang)",
              borderRadius: 9,
              color: "var(--dang)",
              background: "var(--panel)",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t("account.delete.submit")}
          </button>
        </div>
      )}
      {state === "sent" && <Notice tone="ok">{t("account.delete.sent")}</Notice>}
      {state === "error" && <Notice tone="dang">{t("account.delete.error")}</Notice>}
    </form>
  );
}
