"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useT } from "@/i18n/client";

type Provider = "google" | "microsoft" | "github";

const field: React.CSSProperties = {
  height: 42,
  padding: "0 13px",
  borderRadius: 10,
  border: "1px solid var(--line)",
  background: "var(--panel)",
  color: "var(--ink)",
  fontSize: 14,
  width: "100%",
  outline: "none",
};

const label: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" };

export function LoginForm({
  initialError,
  providers,
  sso = [],
}: {
  initialError?: string;
  providers: Provider[];
  /** The workspace's single sign-on connections (enterprise edition). */
  sso?: Array<{ providerId: string; label: string }>;
}) {
  const t = useT();
  const router = useRouter();
  const [error, setError] = useState<string | null>(
    initialError === "not-a-member" ? t("auth.login.notAMember") : null,
  );
  const [bad, setBad] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setBad(false);
    const form = new FormData(e.currentTarget);
    const { error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    if (error) {
      // A rate-limit refusal is not a wrong password, and neither is an
      // unverified address: naming the real cause is the difference between a
      // member who waits ten seconds and one who resets a password that works.
      const rateLimited = error.status === 429;
      const unverified = error.code === "EMAIL_NOT_VERIFIED";
      const ssoRequired = error.code === "SSO_REQUIRED";
      setError(
        rateLimited
          ? t("auth.login.rateLimited")
          : unverified
            ? t("auth.login.emailNotVerified")
            : ssoRequired
              ? t("auth.login.ssoRequired")
              : t("auth.login.badCredentials"),
      );
      setBad(!rateLimited && !unverified && !ssoRequired);
      setPending(false);
      return;
    }
    router.push("/app/incidents");
    router.refresh();
  }

  async function onSocial(provider: Provider) {
    setError(null);
    const { error } = await authClient.signIn.social({ provider, callbackURL: "/app/incidents" });
    if (error) setError(t("auth.login.providerMissing"));
  }

  async function onSso(providerId: string) {
    setError(null);
    // Absolute: the callback must land on this workspace's host.
    const callbackURL = `${window.location.origin}/app/incidents`;
    const { error } = await authClient.signIn.sso({ providerId, callbackURL });
    // The provider's refusal is worth reading: a misconfigured connection says why.
    if (error)
      setError(
        error.message
          ? `${t("auth.login.providerMissing")} ${error.message}`
          : t("auth.login.providerMissing"),
      );
  }

  const providerLabel: Record<Provider, string> = {
    google: t("auth.login.google"),
    microsoft: t("auth.login.microsoft"),
    github: t("auth.login.github"),
  };

  return (
    // `method="post"` even though submission is intercepted: the safety net for
    // the window before hydration — a form with no method goes out as GET, and
    // the password ends up in the address bar and the server logs.
    <form
      onSubmit={onSubmit}
      method="post"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      {(providers.length > 0 || sso.length > 0) && (
        <>
          {sso.map((c) => (
            <button
              key={c.providerId}
              type="button"
              onClick={() => onSso(c.providerId)}
              data-testid="sso-button"
              className="oi-hover-edge-fill"
              style={{
                height: 44,
                border: "1px solid var(--brand-b)",
                borderRadius: 10,
                background: "var(--brand-t)",
                color: "var(--brand)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 9,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t("auth.login.sso", { label: c.label })}
            </button>
          ))}
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
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 9,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {providerLabel[p]}
            </button>
          ))}
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
        </>
      )}

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={label}>{t("auth.login.email")}</span>
        <input
          className="oi-field"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder={t("auth.login.emailPlaceholder")}
          style={{ ...field, borderColor: bad ? "var(--dang)" : "var(--line)" }}
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={label}>{t("auth.login.password")}</span>
        <input
          className="oi-field"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          style={{ ...field, borderColor: bad ? "var(--dang)" : "var(--line)" }}
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
        {pending ? t("auth.login.pending") : t("auth.login.submit")}
      </button>

      <a href="/forgot-password" className="oi-link" style={{ textAlign: "center", fontSize: 13 }}>
        {t("auth.login.forgot")}
      </a>
    </form>
  );
}
