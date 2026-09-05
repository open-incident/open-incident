import { headers } from "next/headers";
import { canOpenSettings, canRespond, requireMember } from "@/lib/session";
import { requireTenant } from "@/lib/tenant";
import { I18nProvider } from "@/i18n/client";
import { getT } from "@/i18n/server";
import { RailNav } from "@/components/shell/rail-nav";
import { ShellTopBar } from "@/components/shell/shell-top-bar";
import { ThemeSync } from "@/components/theme-sync";
import { getEdition } from "@openincident/config";

/**
 * Shared shell of the responder space: the 56 px top bar spans the full width,
 * the 60 px rail sits under it, the screen fills the rest. Every screen under
 * /app renders inside it, under one I18nProvider.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Ahead of requireMember, which would send an invented subdomain to /login
  // instead of answering the 404 it deserves (see requireTenant).
  await requireTenant();
  const { tenant, member } = await requireMember();
  const t = await getT();

  // Suspended workspace: everything is blocked. The wording follows the reason
  // the directory gives; an unknown reason keeps the generic one.
  if (tenant.status === "suspended" || tenant.status === "deleting") {
    const pathname = (await headers()).get("x-pathname") ?? "";
    const unverified = tenant.suspendedReason === "email_unverified";
    // In a cloud deployment the way out of a pause is the subscription screen:
    // it stays reachable for the people who can act on it, and nothing else does.
    const billingOpen = getEdition() === "cloud" && !unverified && canOpenSettings(member);
    if (
      !pathname.startsWith("/app/account") &&
      !(billingOpen && pathname.startsWith("/app/settings/billing"))
    ) {
      return (
        <main
          style={{
            display: "flex",
            minHeight: "100vh",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div style={{ width: "100%", maxWidth: 440, textAlign: "center" }}>
            <h1
              style={{ fontFamily: "var(--font-title)", fontSize: 22, fontWeight: 600, margin: 0 }}
            >
              {t(unverified ? "shell.suspendedUnverifiedTitle" : "shell.suspendedTitle")}
            </h1>
            <p style={{ marginTop: 12, fontSize: 14, color: "var(--ink-2)" }}>
              {t(
                unverified
                  ? "shell.suspendedUnverifiedText"
                  : member.role === "owner"
                    ? "shell.suspendedOwnerText"
                    : "shell.suspendedText",
              )}
            </p>
            {billingOpen && (
              <a
                href="/app/settings/billing"
                style={{
                  display: "inline-grid",
                  placeItems: "center",
                  marginTop: 18,
                  height: 36,
                  padding: "0 16px",
                  borderRadius: 9,
                  background: "var(--brand)",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                {t("shell.suspendedBillingCta")}
              </a>
            )}
          </div>
        </main>
      );
    }
  }

  return (
    <I18nProvider locale={t.locale} dict={t.dict} timeZone={t.timeZone}>
      <div
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--canvas)",
          color: "var(--ink)",
          overflow: "hidden",
        }}
      >
        <ThemeSync theme={member.theme ?? null} />
        <ShellTopBar
          slug={tenant.slug}
          member={{
            name: member.name,
            email: member.email,
            role: member.role,
            canRespond: canRespond(member),
            isManager: canOpenSettings(member),
          }}
        />
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <RailNav />
          {children}
        </div>
      </div>
    </I18nProvider>
  );
}
