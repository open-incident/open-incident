import Link from "next/link";
import { headers } from "next/headers";
import { canOpenSettings, hasPermission, requireMember } from "@/lib/session";
import { getEdition, type Permission } from "@openincident/config";
import { getT } from "@/i18n/server";

/**
 * The administration frame of the design: a 236 px secondary navigation in
 * four groups, then the screen in an 18/22 padded column. Owner and admin only
 * — a viewer or responder who lands here by URL reads why, and no form is
 * rendered for them.
 *
 * Every section the design lists is present. Those whose screen lands with a
 * later milestone are drawn muted with the milestone's name, as the design
 * itself labels its future items — and are not links.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { member } = await requireMember();
  const t = await getT();
  const pathname = (await headers()).get("x-pathname") ?? "";

  if (!canOpenSettings(member)) {
    return (
      <section style={{ flex: 1, display: "grid", placeItems: "center", padding: 32 }}>
        <p
          data-testid="role-restricted"
          style={{ fontSize: 13.5, color: "var(--ink-2)", maxWidth: 420, textAlign: "center" }}
        >
          {t("settings.roleRestricted")}
        </p>
      </section>
    );
  }

  // Each screen names the permission it stands for; a member sees the screens they hold.
  type Item = { href?: string; label: string; soon?: string; permission: Permission };
  const all: Array<{ title: string; items: Item[] }> = [
    {
      title: t("settings.group.workspace"),
      items: [
        {
          href: "/app/settings/general",
          label: t("settings.nav.general"),
          permission: "settings.workspace",
        },
        {
          href: "/app/settings/members",
          label: t("settings.nav.members"),
          permission: "settings.members",
        },
        {
          href: "/app/settings/working-hours",
          label: t("settings.nav.workingHours"),
          permission: "settings.workspace",
        },
        // The subscription lives on the control plane of a cloud deployment;
        // a self-hosted instance has no such screen (it answers 404).
        ...(getEdition() === "cloud"
          ? [
              {
                href: "/app/settings/billing",
                label: t("settings.nav.billing"),
                permission: "settings.workspace" as Permission,
              },
            ]
          : []),
      ],
    },
    {
      title: t("settings.group.response"),
      items: [
        {
          href: "/app/settings/types",
          label: t("settings.nav.types"),
          permission: "settings.response",
        },
        {
          href: "/app/settings/fields",
          label: t("settings.nav.customFields"),
          permission: "settings.response",
        },
        {
          href: "/app/settings/announcements",
          label: t("settings.nav.announcements"),
          permission: "settings.response",
        },
        {
          href: "/app/settings/post-incident",
          label: t("settings.nav.postIncidentFlow"),
          permission: "settings.response",
        },
      ],
    },
    {
      title: t("settings.group.alerting"),
      items: [
        {
          href: "/app/settings/alert-sources",
          label: t("settings.nav.alertSources"),
          permission: "settings.alerting",
        },
        {
          href: "/app/settings/alert-routes",
          label: t("settings.nav.routes"),
          permission: "settings.alerting",
        },
        {
          href: "/app/settings/alert-priorities",
          label: t("settings.nav.priorities"),
          permission: "settings.alerting",
        },
        {
          href: "/app/settings/heartbeats",
          label: t("settings.nav.heartbeats"),
          permission: "settings.alerting",
        },
      ],
    },
    {
      title: t("settings.group.platform"),
      items: [
        {
          href: "/app/settings/integrations",
          label: t("settings.nav.integrations"),
          permission: "settings.platform",
        },
        {
          href: "/app/settings/api",
          label: t("settings.nav.api"),
          permission: "settings.platform",
        },
        {
          href: "/app/settings/ai",
          label: t("settings.nav.aiGovernance"),
          permission: "settings.platform",
        },
        { href: "/app/settings/audit", label: t("settings.nav.audit"), permission: "audit.view" },
        { href: "/app/settings/qa", label: t("settings.nav.qa"), permission: "settings.platform" },
      ],
    },
    {
      title: t("settings.group.enterprise"),
      items: [
        { href: "/app/settings/sso", label: t("settings.nav.sso"), permission: "settings.members" },
        {
          href: "/app/settings/scim",
          label: t("settings.nav.scim"),
          permission: "settings.members",
        },
        {
          href: "/app/settings/roles",
          label: t("settings.nav.roles"),
          permission: "settings.members",
        },
      ],
    },
  ];
  const groups = all
    .map((g) => ({ ...g, items: g.items.filter((i) => hasPermission(member, i.permission)) }))
    .filter((g) => g.items.length > 0);
  // A screen the member does not hold: the same notice as a member without settings at all.
  const current = all.flatMap((g) => g.items).find((i) => i.href && pathname.startsWith(i.href));
  if (current && !hasPermission(member, current.permission)) {
    return (
      <section style={{ flex: 1, display: "grid", placeItems: "center", padding: 32 }}>
        <p
          data-testid="role-restricted"
          style={{ fontSize: 13.5, color: "var(--ink-2)", maxWidth: 420, textAlign: "center" }}
        >
          {t("settings.roleRestricted")}
        </p>
      </section>
    );
  }

  return (
    <>
      <nav
        aria-label={t("nav.settings")}
        style={{
          width: 236,
          flex: "none",
          background: "var(--panel)",
          borderRight: "1px solid var(--line)",
          padding: "16px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 1,
          overflow: "auto",
        }}
      >
        {groups.map((g, gi) => (
          <div key={g.title} style={{ display: "contents" }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: ".12em",
                textTransform: "uppercase",
                color: "var(--ink)",
                padding: gi === 0 ? "0 10px 6px" : "14px 10px 6px",
              }}
            >
              {g.title}
            </div>
            {g.items.map((item) => {
              const active = item.href ? pathname.startsWith(item.href) : false;
              const style: React.CSSProperties = {
                padding: "7px 10px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                color: active ? "var(--brand)" : "var(--ink-2)",
                background: active ? "var(--brand-t)" : "transparent",
                textDecoration: "none",
                display: "flex",
                alignItems: "center",
                gap: 8,
              };
              if (!item.href) {
                return (
                  <span
                    key={item.label}
                    aria-disabled
                    title={item.soon}
                    style={{ ...style, color: "var(--ink-3)", cursor: "default" }}
                  >
                    <span style={{ flex: 1 }}>{item.label}</span>
                    <span
                      style={{
                        padding: "1px 7px",
                        borderRadius: 6,
                        border: "1px solid var(--line)",
                        fontSize: 10.5,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.soon}
                    </span>
                  </span>
                );
              }
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={active ? undefined : "oi-hover"}
                  style={style}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: "18px 22px 28px" }}>
        {children}
      </div>
    </>
  );
}
