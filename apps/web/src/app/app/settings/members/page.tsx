import { asc, eq } from "drizzle-orm";
import { customRoles, members, withTenant } from "@openincident/db";
import { entitlementsFor } from "@/lib/entitlements";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { avatarTone, initials } from "@/lib/avatar";
import { InviteDialog } from "./invite-dialog";
import { disableMember, resendInvite, revokeInvite, updateRole } from "./actions";

/**
 * Settings → Members & roles: the list of the design — avatar, name and email,
 * the status chip, the role as a select that saves on change, the last time
 * they were seen — then the pending invitations on a sunk row with resend and
 * revoke, and the note on roles.
 *
 * The design draws a "2FA" chip per member. There is no second factor yet, so
 * the chip says what IS true — active, invited, disabled — rather than
 * promising a protection nobody has.
 */
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { tenant, member: me } = await requireMember();
  const t = await getT();
  const { saved, error } = await searchParams;
  const { rows, roles } = await withTenant(tenant.id, async (tx) => ({
    rows: await tx
      .select()
      .from(members)
      .where(eq(members.tenantId, tenant.id))
      .orderBy(asc(members.name)),
    roles: entitlementsFor(tenant).customRoles
      ? await tx
          .select({ id: customRoles.id, name: customRoles.name, base: customRoles.base })
          .from(customRoles)
          .where(eq(customRoles.tenantId, tenant.id))
          .orderBy(asc(customRoles.name))
      : [],
  }));
  const active = rows.filter((m) => m.status !== "invited");
  const invited = rows.filter((m) => m.status === "invited");
  const roleLabel = (r: string) =>
    t(`member.role.${r as "owner" | "admin" | "responder" | "viewer"}`);
  /** The select's value: a built-in role, or `custom:<id>` for a custom role (enterprise). */
  const roleValue = (m: { role: string; customRoleId: string | null }) =>
    m.customRoleId && roles.some((r) => r.id === m.customRoleId)
      ? `custom:${m.customRoleId}`
      : m.role;
  const statusTone = (s: string) =>
    s === "active"
      ? { bg: "var(--ok-t)", ink: "var(--ok)" }
      : s === "disabled"
        ? { bg: "var(--sunk)", ink: "var(--ink-3)" }
        : { bg: "var(--wait-t)", ink: "var(--wait)" };

  return (
    <div
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 920 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("settings.members.title")}
        </h1>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {t("settings.members.count", { count: active.length })}
          {invited.length > 0
            ? ` · ${t("settings.members.pending", { count: invited.length })}`
            : ""}
        </span>
        <span style={{ flex: 1 }} />
        {saved === "1" && (
          <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
            {t("settings.members.invitesSent")}
          </span>
        )}
        {error && (
          <span role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--dang)" }}>
            {t("settings.members.inviteError")}
          </span>
        )}
        <InviteDialog />
      </div>
      <div className="oi-panel" style={{ overflow: "hidden" }}>
        {active.map((m) => {
          const tone = avatarTone(m.name);
          const st = statusTone(m.status);
          const isMe = m.id === me.id;
          const canEdit = !isMe && (me.role === "owner" || m.role !== "owner");
          return (
            <div
              key={m.id}
              data-member-email={m.email}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 16px",
                borderBottom: "1px solid var(--line-2)",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: tone.bg,
                  color: tone.ink,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  border: `1px solid ${m.role === "owner" ? "var(--brand-b)" : "transparent"}`,
                  flex: "none",
                  opacity: m.status === "disabled" ? 0.5 : 1,
                }}
              >
                {initials(m.name)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: m.status === "disabled" ? "var(--ink-3)" : "var(--ink)",
                  }}
                >
                  {m.name}
                  {isMe && (
                    <span style={{ fontWeight: 400, color: "var(--ink-3)" }}>
                      {" "}
                      · {t("settings.members.you")}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{m.email}</div>
              </div>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "2px 9px",
                  borderRadius: 999,
                  background: st.bg,
                  color: st.ink,
                  fontSize: 10.5,
                  fontWeight: 700,
                }}
              >
                {t(`member.status.${m.status}`)}
              </span>
              {m.source !== "ui" && (
                <span
                  data-testid="member-source"
                  title={t(`member.source.${m.source}`)}
                  style={{
                    padding: "1px 8px",
                    borderRadius: 999,
                    background: "var(--brand-t)",
                    color: "var(--brand)",
                    fontSize: 10.5,
                    fontWeight: 700,
                  }}
                >
                  {t(`member.source.${m.source}`)}
                </span>
              )}
              {canEdit && m.status !== "disabled" ? (
                <form action={updateRole} style={{ display: "contents" }}>
                  <input type="hidden" name="memberId" value={m.id} />
                  <select
                    name="role"
                    defaultValue={roleValue(m)}
                    aria-label={t("settings.members.roleOf", { name: m.name })}
                    onChange={undefined}
                    className="oi-field"
                    style={{
                      height: 30,
                      padding: "0 11px",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      fontSize: 12.5,
                      background: "var(--panel)",
                      minWidth: 128,
                      outline: "none",
                    }}
                  >
                    {(me.role === "owner"
                      ? ["owner", "admin", "responder", "viewer"]
                      : ["admin", "responder", "viewer"]
                    ).map((r) => (
                      <option key={r} value={r}>
                        {roleLabel(r)}
                      </option>
                    ))}
                    {roles.map((r) => (
                      <option key={r.id} value={`custom:${r.id}`}>
                        {r.name} · {roleLabel(r.base)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="oi-hover"
                    style={{
                      height: 30,
                      padding: "0 10px",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      background: "var(--panel)",
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {t("common.apply")}
                  </button>
                </form>
              ) : (
                <span
                  style={{
                    height: 30,
                    padding: "0 11px",
                    display: "flex",
                    alignItems: "center",
                    fontSize: 12.5,
                    color: "var(--ink-2)",
                    minWidth: 128,
                  }}
                >
                  {roleLabel(m.role)}
                </span>
              )}
              {canEdit && (
                <form action={disableMember}>
                  <input type="hidden" name="memberId" value={m.id} />
                  <button
                    type="submit"
                    data-testid="member-disable"
                    className={m.status === "disabled" ? "oi-hover" : "oi-hover-dang"}
                    style={{
                      height: 28,
                      padding: "0 11px",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      background: "var(--panel)",
                      fontSize: 11.5,
                      color: m.status === "disabled" ? "var(--ink)" : "var(--dang)",
                      cursor: "pointer",
                    }}
                  >
                    {m.status === "disabled"
                      ? t("settings.members.reactivate")
                      : t("settings.members.disable")}
                  </button>
                </form>
              )}
              <span
                style={{ fontSize: 11.5, color: "var(--ink-3)", width: 76, textAlign: "right" }}
              >
                {m.lastSeenAt ? t.fmt.relative(m.lastSeenAt) : "—"}
              </span>
            </div>
          );
        })}
        {invited.map((m) => (
          <div
            key={m.id}
            data-member-email={m.email}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "11px 16px",
              background: "var(--sunk)",
              borderBottom: "1px solid var(--line-2)",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                border: "1.5px dashed var(--ink-3)",
                color: "var(--ink-3)",
                display: "grid",
                placeItems: "center",
                fontSize: 11,
                fontWeight: 700,
                flex: "none",
              }}
            >
              ?
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{m.email}</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                {t("settings.members.invitedLine", {
                  when: t.fmt.relative(m.createdAt),
                  role: roleLabel(m.role),
                })}
              </div>
            </div>
            <form action={resendInvite}>
              <input type="hidden" name="memberId" value={m.id} />
              <button
                type="submit"
                className="oi-hover-edge-fill"
                style={{
                  height: 28,
                  padding: "0 11px",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  background: "var(--panel)",
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {t("settings.members.resend")}
              </button>
            </form>
            <form action={revokeInvite}>
              <input type="hidden" name="memberId" value={m.id} />
              <button
                type="submit"
                className="oi-hover-dang"
                style={{
                  height: 28,
                  padding: "0 11px",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  background: "var(--panel)",
                  fontSize: 11.5,
                  color: "var(--dang)",
                  cursor: "pointer",
                }}
              >
                {t("settings.members.revoke")}
              </button>
            </form>
          </div>
        ))}
      </div>
      <div className="oi-note">{t("settings.members.rolesNote")}</div>
    </div>
  );
}
