import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { SOCIAL_PROVIDERS } from "@openincident/auth";
import { auth } from "@/lib/auth";
import { verifyInviteToken } from "@openincident/crypto";
import { members, withTenant } from "@openincident/db";
import { AuthCard } from "@/components/auth-card";
import { I18nProvider } from "@/i18n/client";
import { getT } from "@/i18n/server";
import { requireWorkspace } from "@/lib/tenant";
import { activateFromSession } from "../actions";
import { AcceptInviteForm } from "./accept-form";

/**
 * Accepting an invitation: the link received by email lands here, on the
 * workspace's subdomain. Without a session: a password form (+ OAuth, which
 * comes back to this page once signed in). With a session on the right
 * address: immediate activation.
 */
export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const t = await getT();
  const { token } = await params;
  const { error } = await searchParams;
  // A 404 rather than a bounce to /login: an invitation that names no existing
  // workspace is a dead link, not a sign-in (see requireTenant).
  const { tenant, workspace } = await requireWorkspace();

  const memberId = verifyInviteToken(tenant.id, token);
  const invited = memberId
    ? await withTenant(tenant.id, async (tx) => {
        const [row] = await tx
          .select()
          .from(members)
          .where(and(eq(members.tenantId, tenant.id), eq(members.id, memberId)));
        return row ?? null;
      })
    : null;

  if (!invited || invited.status === "disabled") {
    return (
      <AuthCard title={t("auth.invite.invalidTitle")} subtitle={t("auth.invite.invalidText")}>
        <a
          href="/login"
          className="oi-link"
          style={{ display: "block", textAlign: "center", fontSize: 13 }}
        >
          {t("auth.forgot.back")}
        </a>
      </AuthCard>
    );
  }

  if (invited.status === "active") redirect("/login?accepted=1");

  const session = await auth.api.getSession({ headers: await headers() });
  if (session && session.user.email.toLowerCase() === invited.email) {
    if (await activateFromSession(token)) redirect("/app/incidents");
  }

  return (
    <AuthCard
      title={t("auth.invite.title", { workspace: workspace.name })}
      subtitle={t("auth.invite.subtitle", { email: invited.email })}
    >
      <I18nProvider locale={t.locale} dict={t.dict} timeZone={t.timeZone}>
        <AcceptInviteForm
          token={token}
          defaultName={invited.name}
          initialError={error}
          providers={SOCIAL_PROVIDERS}
        />
      </I18nProvider>
    </AuthCard>
  );
}
