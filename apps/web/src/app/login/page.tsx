import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { I18nProvider } from "@/i18n/client";
import { getT } from "@/i18n/server";
import { currentMember } from "@/lib/session";
import { requireWorkspace } from "@/lib/tenant";
import { SOCIAL_PROVIDERS } from "@openincident/auth";
import { ssoSignInOptions } from "@openincident/ee-web/sso";
import { LoginForm } from "./login-form";

/**
 * Sign-in: the workspace's name above the card, the host under it — the line
 * that distinguishes this page from a copy of it. Social buttons appear only
 * for the providers the instance actually has credentials for.
 *
 * Someone already signed in is sent straight in. The session is global (one
 * identity, several workspaces) and its cookie can be set on the parent domain,
 * so arriving here with a valid session and a membership is common — from
 * another workspace, or from a control plane's sign-in page. Asking for a
 * password again in that case is a step nobody can act on differently.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; accepted?: string; verified?: string; deleted?: string }>;
}) {
  const t = await getT();
  const { tenant } = await requireWorkspace();
  // Membership is what decides, not the session alone: an identity that belongs
  // to another workspace still has to sign in to this one.
  if (await currentMember()) redirect("/app/incidents");
  const { error, accepted, verified, deleted } = await searchParams;
  const sso = await ssoSignInOptions(tenant.id);

  const notice =
    accepted === "1"
      ? { tone: "ok", text: t("auth.login.invited") }
      : verified === "1"
        ? { tone: "ok", text: t("auth.login.verified") }
        : deleted === "1"
          ? { tone: "ok", text: t("auth.login.deleted") }
          : tenant.status === "suspended" || tenant.status === "deleting"
            ? { tone: "dang", text: t("auth.login.suspended") }
            : null;

  return (
    <AuthCard
      banner={
        notice && (
          <p
            role="status"
            style={{
              margin: 0,
              textAlign: "center",
              padding: "10px 14px",
              borderRadius: 10,
              fontSize: 13,
              background: notice.tone === "ok" ? "var(--ok-t)" : "var(--dang-t)",
              color: notice.tone === "ok" ? "var(--ok)" : "var(--dang)",
            }}
          >
            {notice.text}
          </p>
        )
      }
    >
      <I18nProvider locale={t.locale} dict={t.dict} timeZone={t.timeZone}>
        <LoginForm initialError={error} providers={SOCIAL_PROVIDERS} sso={sso} />
      </I18nProvider>
    </AuthCard>
  );
}
