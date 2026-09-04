"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useT } from "@/i18n/client";

export function ForgotForm() {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const email = String(new FormData(e.currentTarget).get("email"));
    // The outcome is the same whether or not the address exists: Better Auth
    // answers success in both cases, and the screen must not reveal which
    // addresses have an account.
    await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" }).catch(() => {});
    setSent(true);
    setPending(false);
  }

  if (sent) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p
          data-testid="forgot-sent"
          style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.55 }}
        >
          {t("auth.forgot.sent")}
        </p>
        <a href="/login" className="oi-link" style={{ textAlign: "center", fontSize: 13 }}>
          {t("auth.forgot.back")}
        </a>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      method="post"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>
          {t("auth.login.email")}
        </span>
        <input
          className="oi-field"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder={t("auth.login.emailPlaceholder")}
          style={{
            height: 42,
            padding: "0 13px",
            borderRadius: 10,
            border: "1px solid var(--line)",
            background: "var(--panel)",
            fontSize: 14,
            width: "100%",
            outline: "none",
          }}
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        style={{
          color: "#fff",
          height: 44,
          borderRadius: 10,
          background: "var(--brand)",
          fontSize: 14,
          fontWeight: 600,
          border: 0,
          cursor: "pointer",
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? t("auth.forgot.pending") : t("auth.forgot.submit")}
      </button>
      <a href="/login" className="oi-link" style={{ textAlign: "center", fontSize: 13 }}>
        {t("auth.forgot.back")}
      </a>
    </form>
  );
}
