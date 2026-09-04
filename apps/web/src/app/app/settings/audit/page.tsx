import { desc, eq } from "drizzle-orm";
import { auditEvents, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";

/**
 * Settings → Audit log: who did what, when — readable by a human. Each line is
 * a category chip and a sentence rendered from the stored action and target;
 * the actor's name is the snapshot taken when the line was written. CSV export
 * and SIEM forwarding land with the platform milestone.
 */
export default async function AuditPage() {
  const { tenant } = await requireMember();
  const t = await getT();
  const rows = await withTenant(tenant.id, (tx) =>
    tx
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, tenant.id))
      .orderBy(desc(auditEvents.createdAt))
      .limit(200),
  );
  const tone: Record<string, { bg: string; ink: string; label: string }> = {
    config: { bg: "var(--brand-t)", ink: "var(--brand)", label: t("audit.category.config") },
    security: { bg: "var(--viol-t)", ink: "var(--viol)", label: t("audit.category.security") },
    members: { bg: "var(--open-t)", ink: "var(--open)", label: t("audit.category.members") },
    data: { bg: "var(--wait-t)", ink: "var(--wait)", label: t("audit.category.data") },
  };
  const s = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "—");
  const sentence = (row: (typeof rows)[number]): string => {
    const tg = row.target;
    const a = row.actorName;
    switch (row.action) {
      case "workspace.updated":
        return t("audit.workspaceUpdated", { actor: a });
      case "member.invited":
        return t("audit.memberInvited", {
          actor: a,
          email: s(tg.email),
          role: t(`member.role.${s(tg.role) as "owner" | "admin" | "responder" | "viewer"}`),
        });
      case "member.role_changed":
        return t("audit.memberRoleChanged", {
          actor: a,
          member: s(tg.member),
          from: t(`member.role.${s(tg.from) as "owner" | "admin" | "responder" | "viewer"}`),
          to: t(`member.role.${s(tg.to) as "owner" | "admin" | "responder" | "viewer"}`),
        });
      case "member.disabled":
        return t("audit.memberDisabled", { actor: a, member: s(tg.member) });
      case "member.reactivated":
        return t("audit.memberReactivated", { actor: a, member: s(tg.member) });
      case "member.invite_revoked":
        return t("audit.inviteRevoked", { actor: a, email: s(tg.email) });
      case "catalog.entry_created":
        return t("audit.catalogEntryCreated", { actor: a, name: s(tg.name) });
      case "severity.updated":
        return t("audit.severityUpdated", { actor: a, name: s(tg.to) });
      case "incident_status.updated":
        return t("audit.statusUpdated", { actor: a, name: s(tg.to) });
      case "api_key.created":
        return t("audit.apiKeyCreated", {
          actor: a,
          hint: s(tg.hint),
          scopes: Array.isArray(tg.scopes) ? (tg.scopes as string[]).join(", ") : "—",
        });
      case "session.sso_signed_in":
        return t("audit.ssoSignedIn", { provider: s(tg.provider), email: s(tg.email) });
      case "announcement_template.updated":
        return t("audit.announcementTemplateUpdated", { actor: a, name: s(tg.name) });
      case "escalation_path.published":
        return t("audit.escalationPathPublished", {
          actor: a,
          name: s(tg.name),
          version: s(tg.version),
        });
      case "status_page.subscribers_imported":
        return t("audit.subscribersImported", { actor: a, count: Number(tg.count ?? 0) });
      default:
        return `${a} — ${row.action}`;
    }
  };

  return (
    <div
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 920 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("settings.audit.title")}
        </h1>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {t("settings.audit.subtitle")}
        </span>
      </div>
      <div className="oi-panel" style={{ overflow: "hidden" }}>
        {rows.map((row) => {
          const c = tone[row.category] ?? tone.config!;
          return (
            <div
              key={row.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 16px",
                borderBottom: "1px solid var(--line-2)",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--ink-3)",
                  width: 118,
                  flex: "none",
                }}
                title={t.fmt.dateLong(row.createdAt)}
              >
                {t.fmt.messageTime(row.createdAt)}
              </span>
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 6,
                  background: c.bg,
                  color: c.ink,
                  fontSize: 10.5,
                  fontWeight: 700,
                  flex: "none",
                }}
              >
                {c.label}
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--ink-2)" }}>
                {sentence(row)}
              </span>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div style={{ padding: 28, textAlign: "center", color: "var(--ink-3)", fontSize: 13.5 }}>
            {t("settings.audit.empty")}
          </div>
        )}
      </div>
      <div className="oi-note">{t("settings.audit.note")}</div>
    </div>
  );
}
