"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import { authClient } from "@/lib/auth-client";
import { acceptInvite } from "../actions";

type Provider = "google" | "microsoft" | "github";

const field: React.CSSProperties = {
  height: 42,
  padding: "0 13px",
  borderRadius: 10,
  border: "1px solid var(--line)",
  background: "var(--panel)",
  fontSize: 14,
  width: "100%",
  outline: "none",
};

export function AcceptInviteForm({
  token,
  defaultName,
  initialError,
  providers,
}: {
  token: string;
  defaultName: string;
  initialError?: string;
  providers: Provider[];
}) {
  const t = useT();
  const [socialError, setSocialError] = useState<string | null>(null);
  const error =
    socialError ??
    (initialError === "password"
      ? t("auth.invite.passwordTooShort")
      : initialError
        ? t("auth.invite.failed")
        : null);

  async function onSocial(provider: Provider) {
    setSocialError(null);
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: `/invite/${encodeURIComponent(token)}`,
    });
    if (error) setSocialError(t("auth.login.providerMissing"));
  }
  const providerLabel: Record<Provider, string> = {
    google: t("auth.login.google"),
    microsoft: t("auth.login.microsoft"),
    github: t("auth.login.github"),
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <form action={acceptInvite} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <input type="hidden" name="token" value={token} />
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>
            {t("auth.invite.nameLabel")}
          </span>
          <input
            className="oi-field"
            name="name"
            type="text"
            defaultValue={defaultName}
            autoComplete="name"
            style={field}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>
            {t("auth.invite.passwordLabel")}
          </span>
          <input
            className="oi-field"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            style={field}
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
          style={{
            color: "#fff",
            height: 44,
            borderRadius: 10,
            background: "var(--brand)",
            fontSize: 14,
            fontWeight: 600,
            border: 0,
            cursor: "pointer",
          }}
        >
          {t("auth.invite.submit")}
        </button>
      </form>
      {providers.length > 0 && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              color: "var(--ink-3)",
              fontSize: 12,
            }}
          >
            <span style={{ height: 1, flex: 1, background: "var(--line)" }} />
            {t("auth.login.or")}
            <span style={{ height: 1, flex: 1, background: "var(--line)" }} />
          </div>
          {providers.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onSocial(p)}
              className="oi-hover-edge-fill"
              style={{
                height: 44,
                border: "1px solid var(--line)",
                borderRadius: 10,
                background: "var(--panel)",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {providerLabel[p]}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
