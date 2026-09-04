import { AuthCard } from "@/components/auth-card";
import { I18nProvider } from "@/i18n/client";
import { getT } from "@/i18n/server";
import { ResetForm } from "./reset-form";

/**
 * Landing page of the reset email. The token is validated only when the new
 * password is submitted; a missing token is reported rather than rendering a
 * form that cannot work.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const t = await getT();
  const { token } = await searchParams;
  return (
    <AuthCard title={t("auth.reset.title")} subtitle={t("auth.reset.body")}>
      <I18nProvider locale={t.locale} dict={t.dict} timeZone={t.timeZone}>
        <ResetForm token={token ?? ""} />
      </I18nProvider>
    </AuthCard>
  );
}
