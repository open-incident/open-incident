import { PERMISSIONS, ROLE_PERMISSIONS, type Permission } from "@openincident/config";
import type { ScreenDeps } from "../sso/deps";
import { RoleForm } from "./role-form";
import type { CustomRoleRow } from "./store";

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 14,
  padding: "14px 16px",
  boxShadow: "var(--shadow-card)",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

/**
 * Settings → Custom roles. The built-in roles as a reference (what each may
 * do), the custom ones with their members, and the form. A role in use keeps
 * its holders: the deletion says who.
 */
export function RolesSettings({
  deps,
  roles,
  notice,
  actions,
}: {
  deps: ScreenDeps;
  roles: Array<CustomRoleRow & { memberCount: number }>;
  notice?: { kind: "saved" | "removed" | "error"; code?: string; detail?: string };
  actions: {
    save: (formData: FormData) => Promise<void>;
    remove: (formData: FormData) => Promise<void>;
  };
}) {
  const { t } = deps;
  if (!deps.entitled) return <>{deps.unavailable}</>;
  const permLabel = (p: Permission) => t(`perm.${p}`);
  const labels = {
    title: t("ee.roles.formTitle"),
    name: t("ee.roles.field.name"),
    description: t("ee.roles.field.description"),
    base: t("ee.roles.field.base"),
    baseHint: t("ee.roles.field.baseHint"),
    permissions: t("ee.roles.field.permissions"),
    save: t("ee.roles.save"),
    add: t("ee.roles.add"),
    cancel: t("common.cancel"),
    edit: t("ee.roles.edit"),
    remove: t("ee.roles.remove"),
    baseRoles: {
      admin: t("member.role.admin"),
      responder: t("member.role.responder"),
      viewer: t("member.role.viewer"),
    },
    permissionLabels: Object.fromEntries(PERMISSIONS.map((p) => [p, permLabel(p)])) as Record<
      Permission,
      string
    >,
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 820 }}>
      <div>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("ee.roles.title")}
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
          {t("ee.roles.lead")}
        </p>
      </div>
      {notice?.kind === "saved" && (
        <p
          role="status"
          data-testid="roles-saved"
          style={{ margin: 0, fontSize: 13, color: "var(--ok)" }}
        >
          {t("ee.roles.saved")}
        </p>
      )}
      {notice?.kind === "removed" && (
        <p role="status" style={{ margin: 0, fontSize: 13, color: "var(--ok)" }}>
          {t("ee.roles.removed")}
        </p>
      )}
      {notice?.kind === "error" && (
        <p
          role="alert"
          data-testid="roles-error"
          style={{
            margin: 0,
            padding: "10px 12px",
            borderRadius: 10,
            background: "var(--dang-t)",
            border: "1px solid var(--dang)",
            color: "var(--dang)",
            fontSize: 13,
          }}
        >
          {notice.code === "in_use"
            ? t("ee.roles.error.inUse", { members: notice.detail ?? "" })
            : notice.code === "duplicate"
              ? t("ee.roles.error.duplicate")
              : t("ee.roles.error.invalid")}
        </p>
      )}

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="oi-eyebrow">{t("ee.roles.builtIn")}</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 10,
          }}
        >
          {(["admin", "responder", "viewer"] as const).map((r) => (
            <div key={r} style={{ ...card, gap: 6 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{labels.baseRoles[r]}</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
                {ROLE_PERMISSIONS[r].length === PERMISSIONS.length
                  ? t("ee.roles.everything")
                  : ROLE_PERMISSIONS[r].length === 0
                    ? t("ee.roles.readOnly")
                    : ROLE_PERMISSIONS[r].map(permLabel).join(" · ")}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="oi-eyebrow">{t("ee.roles.custom")}</div>
        {roles.length === 0 && (
          <div style={{ ...card, color: "var(--ink-3)", fontSize: 13 }}>{t("ee.roles.none")}</div>
        )}
        {roles.map((r) => (
          <div key={r.id} data-testid="role-row" style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</span>
              <span
                style={{
                  padding: "1px 8px",
                  borderRadius: 999,
                  background: "var(--sunk)",
                  color: "var(--ink-2)",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {t("ee.roles.basedOn", {
                  role: labels.baseRoles[r.base as "admin" | "responder" | "viewer"] ?? r.base,
                })}
              </span>
              <span data-testid="role-members" style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                {t("ee.roles.members", { count: r.memberCount })}
              </span>
              <span style={{ flex: 1 }} />
              <RoleForm
                mode="edit"
                role={{
                  id: r.id,
                  name: r.name,
                  description: r.description ?? "",
                  base: r.base,
                  permissions: r.permissions,
                }}
                action={actions.save}
                labels={labels}
              />
              <form action={actions.remove}>
                <input type="hidden" name="id" value={r.id} />
                <button
                  type="submit"
                  data-testid="role-remove"
                  className="oi-hover-dang"
                  style={{
                    height: 28,
                    padding: "0 10px",
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    background: "var(--panel)",
                    color: "var(--dang)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {labels.remove}
                </button>
              </form>
            </div>
            {r.description && (
              <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{r.description}</div>
            )}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {r.permissions.map((p) => (
                <span
                  key={p}
                  style={{
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: "var(--brand-t)",
                    color: "var(--brand)",
                    fontSize: 11.5,
                    fontWeight: 600,
                  }}
                >
                  {labels.permissionLabels[p as Permission] ?? p}
                </span>
              ))}
              {r.permissions.length === 0 && (
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {t("ee.roles.readOnly")}
                </span>
              )}
            </div>
          </div>
        ))}
        <RoleForm mode="create" action={actions.save} labels={labels} />
      </section>
    </div>
  );
}
