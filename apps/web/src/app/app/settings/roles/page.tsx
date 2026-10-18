import { PERMISSIONS, ROLE_PERMISSIONS } from "@openincident/config";
import { listRoles } from "@openincident/ee-web/roles";
import { getT } from "@/i18n/server";
import { entitlementsFor } from "@/lib/entitlements";
import { isManager, requireMember } from "@/lib/session";
import { SettingsPage, Unavailable } from "@/components/settings/template";
import { RoleMatrix } from "./matrix";
import { NewRoleDialog } from "./role-dialogs";

const BUILT_IN = ["owner", "admin", "responder", "viewer"] as const;

/**
 * Settings › Roles (design V2, enterprise): the permission matrix — the four
 * built-in roles as they are, read-only, beside the selected custom role,
 * whose boxes are clicked one by one and saved with the save bar. The role
 * chips above choose which custom role is the last column.
 *
 * The rows are the product's real permissions — eleven, where the design
 * draws ten: "Manage services" is the one it did not have.
 */
export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { role: wanted } = await searchParams;
  const entitled = entitlementsFor(tenant).customRoles;
  const home = t("settingsV2.home");
  const crumb = t("settingsV2.group.people");
  const title = t("settingsV2.entry.roles");

  if (!entitled)
    return (
      <SettingsPage home={home} crumb={crumb} title={title} lead={t("settingsV2.roles.leadEe")}>
        <Unavailable
          testId="ee-unavailable"
          title={t("settingsV2.unavailable")}
          text={t("settingsV2.eeText")}
          code="OI_ENTITLEMENTS=sso,customRoles"
        />
      </SettingsPage>
    );

  const manages = isManager(member);
  const roles = await listRoles(tenant.id);
  const selected = roles.find((r) => r.id === wanted) ?? roles[0] ?? null;
  const builtInLabel = (r: string) =>
    t(`member.role.${r as "owner" | "admin" | "responder" | "viewer"}`);

  return (
    <SettingsPage
      home={home}
      crumb={crumb}
      title={title}
      lead={t("settingsV2.roles.lead")}
      actions={manages ? <NewRoleDialog /> : undefined}
      testId="settings-roles"
    >
      <RoleMatrix
        key={selected ? `${selected.id}:${selected.updatedAt.getTime()}` : "none"}
        manages={manages}
        hint={
          selected
            ? t("settingsV2.roles.hint", {
                name: selected.name,
                base: builtInLabel(selected.base),
                members: t("settingsV2.roles.members", { count: selected.memberCount }),
              })
            : t("settingsV2.roles.hintEmpty")
        }
        roles={roles.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description ?? "",
          base: r.base === "owner" ? "admin" : r.base,
          members: t("settingsV2.roles.members", { count: r.memberCount }),
        }))}
        selected={
          selected
            ? { id: selected.id, name: selected.name, permissions: selected.permissions }
            : null
        }
        builtIn={BUILT_IN.map((r) => ({
          key: r,
          label: builtInLabel(r),
          permissions: [...ROLE_PERMISSIONS[r]],
        }))}
        permissions={PERMISSIONS.map((p) => ({ key: p, label: t(`settingsV2.roles.perm.${p}`) }))}
      />
    </SettingsPage>
  );
}
