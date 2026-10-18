import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  auditEvents,
  authAccounts,
  authDb,
  authUsers,
  customRoles,
  mailDeliveries,
  members,
  ssoConnections,
  teamMembers,
  teams,
  withTenant,
} from "@openincident/db";
import { entitlementsFor } from "@/lib/entitlements";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { avatarTone, initials } from "@/lib/avatar";
import { Note, SettingsPage } from "@/components/settings/template";
import { InviteDialog } from "./invite-dialog";
import { MembersTable, type MemberRow, type MembersFilter } from "./members-table";
import { ago, calendarDaysUntil, shortDate } from "./format";

const DAY = 86_400_000;
const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1, responder: 2, viewer: 3 };

/**
 * Settings › Members (design V2): one card — filter chips with their counts,
 * a search, then a row per person: who, role (a select that saves on
 * change), teams, how they sign in, when they were last active, and the one
 * thing to do about them.
 *
 * Every cell is read from rows: the sign-in method from the identity's
 * accounts (an account at one of this workspace's SSO connections, or a
 * password), the invitation's expiry from the last invitation email sent,
 * its author from the audit line, a provider's removal from the SCIM audit
 * line.
 */
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  const { tenant, workspace, member: me } = await requireMember();
  const t = await getT();
  const { f } = await searchParams;
  const ent = entitlementsFor(tenant);
  const manages = isManager(me);

  const data = await withTenant(tenant.id, async (tx) => {
    const rows = await tx
      .select()
      .from(members)
      .where(eq(members.tenantId, tenant.id))
      .orderBy(asc(members.name));
    const roles = ent.customRoles
      ? await tx
          .select({ id: customRoles.id, name: customRoles.name })
          .from(customRoles)
          .where(eq(customRoles.tenantId, tenant.id))
          .orderBy(asc(customRoles.name))
      : [];
    const memberships = await tx
      .select({ memberId: teamMembers.memberId, team: teams.name })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teamMembers.tenantId, tenant.id))
      .orderBy(asc(teams.name));
    const invitationMails = await tx
      .select({ to: mailDeliveries.toAddress, createdAt: mailDeliveries.createdAt })
      .from(mailDeliveries)
      .where(and(eq(mailDeliveries.tenantId, tenant.id), eq(mailDeliveries.kind, "invitation")))
      .orderBy(desc(mailDeliveries.createdAt))
      .limit(500);
    const lines = await tx
      .select({
        action: auditEvents.action,
        actorName: auditEvents.actorName,
        actorMemberId: auditEvents.actorMemberId,
        email: sql<string | null>`${auditEvents.target}->>'email'`,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, tenant.id),
          inArray(auditEvents.action, ["member.invited", "member.deactivated_by_provider"]),
        ),
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(1000);
    const connections = await tx
      .select({ providerId: ssoConnections.providerId, label: ssoConnections.label })
      .from(ssoConnections)
      .where(eq(ssoConnections.tenantId, tenant.id))
      .orderBy(asc(ssoConnections.createdAt));
    return { rows, roles, memberships, invitationMails, lines, connections };
  });

  // How each identity signs in: the accounts the authentication holds for it.
  const emails = data.rows.map((m) => m.email.toLowerCase());
  const accounts = emails.length
    ? await authDb
        .select({ email: authUsers.email, providerId: authAccounts.providerId })
        .from(authAccounts)
        .innerJoin(authUsers, eq(authUsers.id, authAccounts.userId))
        .where(inArray(sql`lower(${authUsers.email})`, emails))
    : [];
  const ssoProviders = new Set(data.connections.map((c) => c.providerId));
  const methodsOf = new Map<string, Set<string>>();
  for (const a of accounts) {
    const key = a.email.toLowerCase();
    const set = methodsOf.get(key) ?? new Set<string>();
    set.add(
      ssoProviders.has(a.providerId) ? "sso" : a.providerId === "credential" ? "password" : "other",
    );
    methodsOf.set(key, set);
  }

  const provider = data.connections[0]?.label ?? t("settingsV2.people.provider");
  const teamsOf = new Map<string, string[]>();
  for (const m of data.memberships)
    teamsOf.set(m.memberId, [...(teamsOf.get(m.memberId) ?? []), m.team]);
  const roleNames = new Map(data.roles.map((r) => [r.id, r.name]));
  const builtIn = (r: string) =>
    t(`member.role.${r as "owner" | "admin" | "responder" | "viewer"}`);
  const now = Date.now();

  const rows: MemberRow[] = data.rows
    .slice()
    .sort((a, b) => {
      const st = (s: string) => (s === "active" ? 0 : s === "invited" ? 1 : 2);
      if (st(a.status) !== st(b.status)) return st(a.status) - st(b.status);
      if (a.status === "invited") return a.createdAt.getTime() - b.createdAt.getTime();
      if (a.status === "active" && ROLE_RANK[a.role] !== ROLE_RANK[b.role])
        return (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9);
      return a.name.localeCompare(b.name);
    })
    .map((m) => {
      const you = m.id === me.id;
      const email = m.email.toLowerCase();
      const custom = m.customRoleId ? roleNames.get(m.customRoleId) : undefined;
      const roleValue = custom ? `custom:${m.customRoleId}` : m.role;
      const roleLabel = custom ?? builtIn(m.role);
      const mayTouch = manages && !you && (me.role === "owner" || m.role !== "owner");
      const tone =
        m.status === "invited" ? { bg: "var(--sunk)", ink: "var(--ink-2)" } : avatarTone(m.name);

      let sub = m.email;
      let last = m.lastSeenAt ? ago(t, m.lastSeenAt, now) : "—";
      let method: MemberRow["method"];
      let action: MemberRow["action"] = null;

      if (m.status === "invited") {
        method = "invited";
        const invite = data.lines.find((l) => l.action === "member.invited" && l.email === email);
        const when = ago(t, m.createdAt, now);
        sub = !invite
          ? t("settingsV2.members.invitedWhen", { when })
          : invite.actorMemberId === me.id
            ? t("settingsV2.members.invitedByYou", { when })
            : t("settingsV2.members.invitedBy", {
                name: invite.actorName.split(/\s+/)[0] ?? invite.actorName,
                when,
              });
        // The link carries its own expiry: seven days from the last email sent.
        const sent =
          data.invitationMails.find((d) => d.to.toLowerCase() === email)?.createdAt ?? m.createdAt;
        const expires = new Date(sent.getTime() + 7 * DAY);
        const days = calendarDaysUntil(t.timeZone, expires, new Date(now));
        last =
          expires.getTime() <= now
            ? t("settingsV2.members.link.expired")
            : days <= 0
              ? t("settingsV2.members.link.today")
              : days === 1
                ? t("settingsV2.members.link.tomorrow")
                : t("settingsV2.members.link.valid", { count: days });
        if (manages) action = "resend";
      } else if (m.status === "disabled") {
        method = "disabled";
        if (m.source === "scim") {
          const removed = data.lines.find(
            (l) => l.action === "member.deactivated_by_provider" && l.email === email,
          );
          if (removed)
            last = t("settingsV2.members.removedFrom", {
              provider,
              date: shortDate(t, removed.createdAt),
            });
          action = manages ? "managed" : null;
        } else if (mayTouch) action = "reactivate";
      } else {
        const ways = methodsOf.get(email);
        method =
          m.source === "sso" || ways?.has("sso")
            ? "sso"
            : ways?.has("password")
              ? "password"
              : "none";
        if (mayTouch) action = "disable";
      }

      return {
        id: m.id,
        name: m.status === "invited" ? m.email : m.name,
        realName: m.name,
        email: m.email,
        sub,
        initials: initials(m.name),
        tone,
        you,
        status: m.status,
        roleValue,
        roleLabel,
        canEditRole: m.status === "active" && mayTouch,
        teams: (teamsOf.get(m.id) ?? []).join(", ") || "—",
        method,
        last,
        action,
      };
    });

  const roleOptions = [
    ...(me.role === "owner"
      ? ["owner", "admin", "responder", "viewer"]
      : ["admin", "responder", "viewer"]
    ).map((r) => ({ value: r, label: builtIn(r) })),
    ...data.roles.map((r) => ({ value: `custom:${r.id}`, label: r.name })),
  ];
  const inviteRoles = [
    ...["responder", "viewer", "admin"].map((r) => ({ value: r, label: builtIn(r) })),
    ...data.roles.map((r) => ({ value: `custom:${r.id}`, label: r.name })),
  ];
  const filter: MembersFilter = f === "active" || f === "invited" || f === "disabled" ? f : "all";
  const domain = me.email.split("@")[1] ?? "example.com";

  return (
    <SettingsPage
      home={t("settingsV2.home")}
      crumb={t("settingsV2.group.people")}
      title={t("settingsV2.entry.members")}
      lead={t("settingsV2.members.lead", { workspace: workspace.name })}
      actions={manages ? <InviteDialog roles={inviteRoles} domain={domain} /> : undefined}
      testId="settings-members"
    >
      <MembersTable
        key={filter}
        rows={rows}
        roleOptions={roleOptions}
        initialFilter={filter}
        provider={provider}
      />
      <Note>{t("settingsV2.members.note")}</Note>
    </SettingsPage>
  );
}
