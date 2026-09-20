import { headers } from "next/headers";
import { withTenant } from "@openincident/db";
import { getEdition } from "@openincident/config";
import { canOpenSettings, canRespond, requireMember } from "@/lib/session";
import { getWorkspace, requireTenant } from "@/lib/tenant";
import { I18nProvider } from "@/i18n/client";
import { getT } from "@/i18n/server";
import { AppFrame } from "@/components/shell/app-frame";
import type { SidebarSection } from "@/components/shell/sidebar";
import { ThemeSync } from "@/components/theme-sync";
import { initials } from "@/lib/avatar";
import { countViews } from "@/lib/incidents";
import { alertCounts } from "@/lib/alerts";
import { onCallNow } from "@/lib/oncall";
import { telemetryInstalled } from "@/lib/telemetry-module";
import { inboxForShell } from "@/lib/inbox";
import { markBellRead, pageMeFromShell } from "./actions";

const ROLE_LABEL = {
  owner: "member.role.owner",
  admin: "member.role.admin",
  responder: "member.role.responder",
  viewer: "member.role.viewer",
} as const;

/**
 * Shared frame of the responder space: a 228 px rail on the left, a 50 px
 * header, the screen filling the rest. Every screen under /app renders inside
 * it, under one I18nProvider.
 *
 * The rail's two badges and its on-call line are read here, once, rather than
 * by each screen: they belong to the frame and must say the same thing on every
 * page.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Ahead of requireMember, which would send an invented subdomain to /login
  // instead of answering the 404 it deserves (see requireTenant).
  await requireTenant();
  const { tenant, member } = await requireMember();
  const t = await getT();
  const workspace = await getWorkspace();

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

  const frame = await withTenant(tenant.id, async (tx) => {
    const [views, alerts, onCall, inbox] = await Promise.all([
      countViews(tx, tenant.id, member.id),
      alertCounts(tx, tenant.id),
      onCallNow(tx, tenant.id),
      inboxForShell(tx, tenant.id, member.id),
    ]);
    return { views, alerts, onCall, inbox };
  });

  const sections: SidebarSection[] = [
    { id: "home", href: "/app", labelKey: "nav.home" },
    { id: "incidents", href: "/app/incidents", labelKey: "nav.incidents", badge: frame.views.open },
    { id: "alerts", href: "/app/alerts", labelKey: "nav.alerts", badge: frame.alerts.firing },
    { id: "monitors", href: "/app/monitors", labelKey: "nav.monitors" },
    { id: "onCall", href: "/app/on-call", labelKey: "nav.onCall" },
    { id: "statusPages", href: "/app/status-pages", labelKey: "nav.statusPages" },
    { id: "services", href: "/app/services", labelKey: "nav.services" },
    { id: "insights", href: "/app/insights", labelKey: "nav.insights" },
    {
      id: "telemetry",
      href: "/app/telemetry",
      labelKey: "nav.telemetry",
      ...(telemetryInstalled() ? {} : { tag: "nav.notInstalled" as const }),
    },
    // Only when there is something to put on one. A dashboards entry on an
    // instance with no column store leads to a screen that can only apologise.
    ...(telemetryInstalled()
      ? [
          {
            id: "dashboards" as const,
            href: "/app/dashboards",
            labelKey: "nav.dashboards" as const,
          },
        ]
      : []),
  ];

  // The first schedule that actually has someone is the one the rail names:
  // saying "nobody" while another schedule is covered would be a lie of omission.
  const covered = frame.onCall.find((s) => s.memberName) ?? null;

  return (
    <I18nProvider locale={t.locale} dict={t.dict} timeZone={t.timeZone}>
      <ThemeSync theme={member.theme ?? null} />
      <AppFrame
        workspaceName={workspace?.name ?? tenant.slug}
        workspaceAccent={workspace?.branding.accentColor ?? "var(--brand)"}
        member={{
          name: member.name,
          roleLabel: t(ROLE_LABEL[member.role]),
          initials: initials(member.name),
        }}
        sections={sections}
        onCall={
          covered
            ? {
                name: covered.memberName!,
                scheduleName: covered.scheduleName,
                until: t.fmt.time(covered.until, t.timeZone),
              }
            : null
        }
        canDeclare={canRespond(member)}
        canPageSelf={canRespond(member)}
        pageMeAction={pageMeFromShell}
        bell={{
          unread: frame.inbox.unread,
          rows: frame.inbox.rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            title: r.title,
            body: r.body,
            url: r.url,
            count: r.count,
            read: Boolean(r.readAt),
            at: t.fmt.relative(r.createdAt),
          })),
        }}
        markBellReadAction={markBellRead}
      >
        {children}
      </AppFrame>
    </I18nProvider>
  );
}
