import { headers } from "next/headers";
import { canOpenSettings, hasPermission, requireMember } from "@/lib/session";
import { getT } from "@/i18n/server";
import { SettingsToaster } from "@/components/settings/controls";
import { SettingsNav } from "./settings-nav";
import { entryForPath, settingsDirectory } from "./directory";

/**
 * The administration frame (design V2): a 224 px sticky navigation — the
 * overview, "Find a setting", five groups with one entry per screen — and
 * the screen beside it, in a 1240-wide grid.
 *
 * Owner and admin by default; a custom role sees the entries its permissions
 * name. A member who lands on a screen they do not hold reads why, and no
 * form is rendered for them.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { member } = await requireMember();
  const t = await getT();
  const pathname = (await headers()).get("x-pathname") ?? "";

  const restricted = (
    <section style={{ flex: 1, display: "grid", placeItems: "center", padding: 32 }}>
      <p
        data-testid="role-restricted"
        style={{ fontSize: 13.5, color: "var(--ink-2)", maxWidth: 420, textAlign: "center" }}
      >
        {t("settings.roleRestricted")}
      </p>
    </section>
  );
  if (!canOpenSettings(member)) return restricted;
  const current = entryForPath(pathname);
  if (current && !hasPermission(member, current.permission)) return restricted;

  const { groups } = await settingsDirectory();

  return (
    <div
      style={{
        maxWidth: 1240,
        margin: "0 auto",
        padding: "22px 28px 40px",
        display: "grid",
        gridTemplateColumns: "224px minmax(0,1fr)",
        gap: 28,
        alignItems: "start",
      }}
    >
      <SettingsNav
        label={t("nav.settings")}
        groups={groups.map((g) => ({
          key: g.key,
          title: g.title,
          entries: g.entries.map((e) => ({
            key: e.key,
            href: e.href,
            label: e.label,
            status: e.status,
            tone: e.tone,
            locked: e.locked,
            paths: e.paths,
          })),
        }))}
      />
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        {children}
      </div>
      <SettingsToaster />
    </div>
  );
}
