"use client";

import { usePathname } from "next/navigation";
import { useT } from "@/i18n/client";
import { TopBar, type ShellMember } from "./top-bar";

/**
 * Derives the breadcrumb from the path — the layout renders once for every
 * screen and cannot know which one is on, so the crumb is computed here.
 */
export function ShellTopBar({ slug, member }: { slug: string; member: ShellMember }) {
  const t = useT();
  const pathname = usePathname();
  const crumbs: Array<{ label: string; href?: string; mono?: boolean }> = [];
  const incident = pathname.match(/^\/app\/incidents\/(\d+)/);
  if (pathname.startsWith("/app/incidents")) {
    crumbs.push({ label: t("nav.incidents"), href: "/app/incidents" });
    if (incident) crumbs.push({ label: `INC-${incident[1]}`, mono: true });
    else if (pathname.endsWith("/new")) crumbs.push({ label: t("incidents.declare.title") });
  } else if (pathname.startsWith("/app/catalog")) {
    crumbs.push({ label: t("nav.catalog"), href: "/app/catalog" });
  } else if (pathname.startsWith("/app/settings")) {
    crumbs.push({ label: t("nav.settings"), href: "/app/settings/general" });
    const section = pathname.split("/")[3];
    const labels: Record<string, string> = {
      general: t("settings.nav.general"),
      members: t("settings.nav.members"),
      types: t("settings.nav.types"),
      audit: t("settings.nav.audit"),
      api: t("settings.nav.api"),
      fields: t("settings.nav.customFields"),
      announcements: t("settings.nav.announcements"),
      "post-incident": t("settings.nav.postIncidentFlow"),
      "working-hours": t("settings.nav.workingHours"),
      "alert-sources": t("settings.nav.alertSources"),
      heartbeats: t("settings.nav.heartbeats"),
      "alert-routes": t("settings.nav.routes"),
      "alert-priorities": t("settings.nav.priorities"),
      integrations: t("settings.nav.integrations"),
      ai: t("settings.nav.aiGovernance"),
    };
    if (section && labels[section]) crumbs.push({ label: labels[section]!.toLowerCase() });
  } else if (pathname.startsWith("/app/account")) {
    crumbs.push({ label: t("nav.account") });
  }
  return <TopBar slug={slug} member={member} crumbs={crumbs} />;
}
