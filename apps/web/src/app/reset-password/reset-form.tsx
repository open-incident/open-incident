"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useT } from "@/i18n/client";

export function ResetForm({ token }: { token: string }) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--dang)" }}>{t("auth.reset.missing")}</p>
        <a
          href="/forgot-password"
          className="oi-link"
          style={{ textAlign: "center", fontSize: 13 }}
        >
          {t("auth.forgot.title")}
        </a>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const newPassword = String(new FormData(e.currentTarget).get("password"));
    if (newPassword.length < 8) {
      setError(t("auth.reset.tooShort"));
      return;
    }
    setPending(true);
    const { error } = await authClient.resetPassword({ newPassword, token });
    if (error) {
      setError(t("auth.reset.invalid"));
      setPending(false);
      return;
    }
    setDone(true);
    setPending(false);
  }

  if (done) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p data-testid="reset-done" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          {t("auth.reset.success")}
        </p>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)" }}>
          {t("auth.reset.successBody")}
        </p>
        <a
          href="/login"
          style={{
            display: "grid",
            placeItems: "center",
            color: "#fff",
            height: 44,
            borderRadius: 10,
            background: "var(--brand)",
            fontSize: 14,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          {t("auth.reset.signIn")}
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
          {t("auth.reset.password")}
        </span>
        <input
          className="oi-field"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder={t("auth.reset.placeholder")}
          style={{
            height: 42,
            padding: "0 13px",
            borderRadius: 10,
            border: `1px solid ${error ? "var(--dang)" : "var(--line)"}`,
            background: "var(--panel)",
            fontSize: 14,
            width: "100%",
            outline: "none",
          }}
        />
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
        {pending ? t("auth.reset.pending") : t("auth.reset.submit")}
      </button>
    </form>
  );
}
