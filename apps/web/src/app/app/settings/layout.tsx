import { Suspense } from "react";
import { headers } from "next/headers";
import { canOpenSettings, hasPermission, requireMember } from "@/lib/session";
import { getEdition, type Permission } from "@openincident/config";
import { getT } from "@/i18n/server";
import { SettingsNav, type NavGroup, type NavItem } from "./settings-nav";

/**
 * The administration frame of the V2 design: a 210 px sticky secondary
 * navigation in five groups, then the screen in the second column of a
 * 1200-wide grid. Owner and admin only — a viewer or responder who lands here
 * by URL reads why, and no form is rendered for them.
 *
 * Two kinds of item are not plain links. One leaves the area (Alert sources
 * now lives in Alerts, and says so with ↗). The other is a capability this
 * instance does not have: it stays on the screen, greyed, carrying the reason
 * and the way to enable it, and the URL behind it refuses.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { member } = await requireMember();
  const t = await getT();
  const pathname = (await headers()).get("x-pathname") ?? "";
  const cloud = getEdition() === "cloud";

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
  type Item = NavItem & { permission: Permission };
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
        // The subscription is sold by the control plane of a cloud deployment.
        // A self-hosted instance keeps the entry — greyed, with the reason and
        // the way to enable it — and its URL answers 404.
        cloud
          ? {
              href: "/app/settings/billing",
              label: t("settings.nav.billing"),
              permission: "settings.workspace" as Permission,
            }
          : {
              label: t("settings.nav.billing"),
              chip: t("set2.nav.billingOff"),
              why: t("set2.nav.billingWhy"),
              permission: "settings.workspace" as Permission,
            },
      ],
    },
    {
      title: t("settings.group.response"),
      items: [
        {
          href: "/app/settings/types",
          label: t("settings.nav.types"),
          bare: true,
          permission: "settings.response",
        },
        // The incident severities are the second segment of the same screen.
        {
          href: "/app/settings/types?seg=severities",
          label: t("set2.nav.incidentSeverities"),
          seg: "severities",
          permission: "settings.response",
        },
        {
          href: "/app/settings/fields",
          label: t("set2.nav.fields"),
          permission: "settings.response",
        },
        // The shared label keys the design folds into "Fields & labels": the
        // vocabulary every source maps its payload onto. Its own screen, next
        // to the fields, because that is where a reader looks for a label key.
        {
          href: "/app/settings/alert-attributes",
          label: t("settings.nav.alertAttributes"),
          permission: "settings.alerting",
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
          href: "/app/alerts/sources",
          label: t("settings.nav.alertSources"),
          external: true,
          hint: t("set2.nav.externalHint"),
          permission: "settings.alerting",
        },
        {
          href: "/app/settings/alert-routes",
          label: t("set2.nav.rules"),
          permission: "settings.alerting",
        },
        {
          href: "/app/settings/alert-priorities",
          label: t("set2.nav.alertSeverities"),
          permission: "settings.alerting",
        },
        {
          href: "/app/settings/probes",
          label: t("set2.nav.probes"),
          permission: "settings.alerting",
        },
        // A heartbeat is the other thing that watches by waiting: its silence
        // is the signal. It belongs beside the probes, not in a group of its own.
        {
          href: "/app/settings/heartbeats",
          label: t("settings.nav.heartbeats"),
          permission: "settings.alerting",
        },
        // The guided four-step hub. Superseded by the four items above for
        // anyone who knows what they want; kept last for anyone who does not.
        {
          href: "/app/settings/alerting",
          label: t("settings.nav.alerting"),
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
  const groups: NavGroup[] = all
    .map((g) => ({
      title: g.title,
      items: g.items
        .filter((i) => hasPermission(member, i.permission))
        .map(({ permission: _permission, ...i }) => i),
    }))
    .filter((g) => g.items.length > 0);
  // A screen the member does not hold: the same notice as a member without settings at all.
  const current = all
    .flatMap((g) => g.items)
    .find((i) => i.href && !i.external && pathname.startsWith(i.href.split("?")[0]!));
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
        {children}
      </div>
    </div>
  );
}
