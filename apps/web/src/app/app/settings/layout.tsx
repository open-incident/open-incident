import { Suspense } from "react";
import { headers } from "next/headers";
import { canOpenSettings, hasPermission, requireMember } from "@/lib/session";
import { entitlementsFor } from "@/lib/entitlements";
import { getEdition, type Permission } from "@openincident/config";
import { getT } from "@/i18n/server";
import { SegmentTabs, type SegmentTab } from "@/components/shell/segment-tabs";
import { SettingsNav, type NavGroup } from "./settings-nav";

/**
 * The administration frame: a 210 px sticky secondary navigation in four
 * groups, then the screen in the second column of a 1200-wide grid. Owner and
 * admin only — a viewer or responder who lands here by URL reads why, and no
 * form is rendered for them.
 *
 * Twelve entries, one per thing an administrator decides. A family of screens
 * that used to take three or four entries each takes one, and separates its
 * screens with tabs drawn above the screen — General & brand and Working
 * hours; Members and the enterprise access screens; Types, severities and
 * fields; Priorities and attributes; Integrations and API. What is not a
 * decision has no entry: alert sources are read and created under Alerts, and
 * heartbeats live beside the monitors they resemble.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { member, tenant } = await requireMember();
  const t = await getT();
  const pathname = (await headers()).get("x-pathname") ?? "";
  const cloud = getEdition() === "cloud";
  const entitlements = entitlementsFor(tenant);

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

  // Each entry names the permission it stands for; a member sees the entries they hold.
  type Entry = {
    href: string;
    label: string;
    permission: Permission;
    tabs?: SegmentTab[];
  };
  // The enterprise access screens: three tabs when the instance has them, one
  // tab — the notice that says how to get them — when it does not.
  const accessTabs: SegmentTab[] =
    entitlements.sso || entitlements.customRoles
      ? [
          { href: "/app/settings/sso", label: t("ee.sso.title") },
          { href: "/app/settings/scim", label: t("ee.scim.title") },
          { href: "/app/settings/roles", label: t("ee.roles.title") },
        ]
      : [
          {
            href: "/app/settings/sso",
            label: t("settings.tab.enterprise"),
            also: ["/app/settings/scim", "/app/settings/roles"],
          },
        ];
  const all: Array<{ title: string; items: Entry[] }> = [
    {
      title: t("settings.group.workspace"),
      items: [
        {
          href: "/app/settings/general",
          label: t("settings.nav.general"),
          permission: "settings.workspace",
          tabs: [
            { href: "/app/settings/general", label: t("settings.general.title") },
            { href: "/app/settings/working-hours", label: t("settings.hours.title") },
          ],
        },
        {
          href: "/app/settings/members",
          label: t("settings.nav.members"),
          permission: "settings.members",
          tabs: [
            { href: "/app/settings/members", label: t("settings.tab.members") },
            ...accessTabs,
          ],
        },
        // The subscription is sold by the control plane of a cloud deployment;
        // a self-hosted instance has nothing to show and shows nothing.
        ...(cloud
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
          tabs: [
            { href: "/app/settings/types", label: t("settings.types.segTypes"), bare: true },
            {
              href: "/app/settings/types?seg=severities",
              label: t("settings.types.segSeverities"),
              seg: "severities",
            },
            { href: "/app/settings/fields", label: t("settings.fields.title") },
          ],
        },
        {
          href: "/app/settings/announcements",
          label: t("settings.nav.announcements"),
          permission: "settings.response",
        },
        {
          href: "/app/settings/post-incident",
          label: t("set2.nav.postIncident"),
          permission: "settings.response",
        },
      ],
    },
    {
      title: t("settings.group.alerting"),
      items: [
        {
          href: "/app/settings/alert-routes",
          label: t("set2.nav.rules"),
          permission: "settings.alerting",
        },
        // The vocabulary the rules read: what an alert is worth, and what it says.
        {
          href: "/app/settings/alert-priorities",
          label: t("settings.nav.priorities"),
          permission: "settings.alerting",
          tabs: [
            { href: "/app/settings/alert-priorities", label: t("set2.sev.title") },
            { href: "/app/settings/alert-attributes", label: t("settings.attributes.title") },
          ],
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
          tabs: [
            { href: "/app/settings/integrations", label: t("settings.integrations.title") },
            { href: "/app/settings/api", label: t("settings.nav.api") },
          ],
        },
        {
          href: "/app/settings/ai",
          label: t("settings.nav.aiGovernance"),
          permission: "settings.platform",
        },
        // Retention, redaction and the exception-regression rule. The
        // ingestion keys and the usage stay on the Telemetry screen, where the
        // reader is when they need them.
        {
          href: "/app/settings/observability",
          label: t("settings.nav.observability"),
          permission: "settings.platform",
        },
        { href: "/app/settings/audit", label: t("settings.nav.audit"), permission: "audit.view" },
        // The instance's own test suites — diagnostics, owner-only in the screen.
        { href: "/app/settings/qa", label: t("settings.nav.qa"), permission: "settings.platform" },
      ],
    },
  ];
  const pathsOf = (e: Entry) =>
    Array.from(
      new Set(
        [e.href, ...(e.tabs ?? []).flatMap((tab) => [tab.href, ...(tab.also ?? [])])].map(
          (href) => href.split("?")[0]!,
        ),
      ),
    );
  const groups: NavGroup[] = all
    .map((g) => ({
      title: g.title,
      items: g.items
        .filter((i) => hasPermission(member, i.permission))
        .map((i) => ({ href: i.href, label: i.label, paths: pathsOf(i) })),
    }))
    .filter((g) => g.items.length > 0);
  // The entry the current screen belongs to — for its tabs, and for the
  // permission it stands for: a screen the member does not hold gets the same
  // notice as a member without settings at all.
  const current = all
    .flatMap((g) => g.items)
    .find((i) => pathsOf(i).some((path) => pathname === path || pathname.startsWith(`${path}/`)));
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
    <div
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: "22px 28px 60px",
        display: "grid",
        gridTemplateColumns: "210px minmax(0,1fr)",
        gap: 22,
        alignItems: "start",
      }}
    >
      <Suspense fallback={<div style={{ width: 210 }} />}>
        <SettingsNav groups={groups} label={t("nav.settings")} />
      </Suspense>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        {current?.tabs && (
          <Suspense fallback={<div style={{ height: 34 }} />}>
            <SegmentTabs tabs={current.tabs} label={current.label} />
          </Suspense>
        )}
        {children}
      </div>
    </div>
  );
}
