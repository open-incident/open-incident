import { AuthCard } from "@/components/auth-card";
import { I18nProvider } from "@/i18n/client";
import { getT } from "@/i18n/server";
import { ForgotForm } from "./forgot-form";

/**
 * Where "Forgot your password?" leads. The form asks Better Auth's
 * /request-password-reset (wired in packages/auth); the email lands the member
 * on /reset-password of this very workspace, with a one-hour token.
 */
export default async function ForgotPasswordPage() {
  const t = await getT();
  return (
    <AuthCard title={t("auth.forgot.title")} subtitle={t("auth.forgot.body")}>
      <I18nProvider locale={t.locale} dict={t.dict} timeZone={t.timeZone}>
        <ForgotForm />
      </I18nProvider>
    </AuthCard>
  );
}
