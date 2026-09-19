import { asc, eq, inArray, sql } from "drizzle-orm";
import {
  escalationPaths,
  members,
  services,
  teamMembers,
  teams,
  withTenant,
} from "@openincident/db";
import { isManagerRole } from "@openincident/config";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { avatarTone, initials } from "@/lib/avatar";
import { activeMembers } from "@/lib/oncall";
import { TeamDialog } from "./team-dialog";
import { deleteTeam, updateTeamMember } from "./actions";

/**
 * On-call · Teams — who the pager reaches when something names a service.
 *
 * A team was something only the seed could make. Everything that pages "the
 * owner" resolves to one, so a workspace could declare services, route alerts
 * and publish policies, and still have nobody to hand any of it to.
 *
 * Each row says the two things that decide whether the pager rings: the path
 * the team is paged through, and the people in it. A team missing either is
 * marked, because the engine reaches it all the same and then wakes nobody.
 */
export async function TeamsTab({ q }: { q: Record<string, string | undefined> }) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const manages = isManagerRole(member);

  const data = await withTenant(tenant.id, async (tx) => {
    const rows = await tx
      .select({
        id: teams.id,
        name: teams.name,
        policyPathId: teams.policyPathId,
        policyName: escalationPaths.name,
        published: escalationPaths.currentVersionId,
        chatChannel: teams.chatChannel,
      })
      .from(teams)
      .leftJoin(escalationPaths, eq(escalationPaths.id, teams.policyPathId))
      .where(eq(teams.tenantId, tenant.id))
      .orderBy(asc(teams.name));
    const ids = rows.map((r) => r.id);
    const people = ids.length
      ? await tx
          .select({ teamId: teamMembers.teamId, id: members.id, name: members.name })
          .from(teamMembers)
          .innerJoin(members, eq(members.id, teamMembers.memberId))
          .where(inArray(teamMembers.teamId, ids))
          .orderBy(asc(members.name))
      : [];
    const owned = ids.length
      ? await tx
          .select({
            teamId: services.ownerTeamId,
            n: sql<number>`count(*)`.mapWith(Number),
          })
          .from(services)
          .where(inArray(services.ownerTeamId, ids))
          .groupBy(services.ownerTeamId)
      : [];
    return {
      rows,
      people,
      owned: new Map(owned.map((o) => [o.teamId, o.n])),
      paths: await tx
        .select({ id: escalationPaths.id, name: escalationPaths.name })
        .from(escalationPaths)
        .where(eq(escalationPaths.tenantId, tenant.id))
        .orderBy(asc(escalationPaths.name)),
      everyone: await activeMembers(tx, tenant.id),
    };
  });

  const open = q.members ?? null;
  const error = q.error ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("oc2.teams.intro")}</span>
        <span style={{ flex: 1 }} />
        {manages && <TeamDialog paths={data.paths} members={data.everyone} />}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            background: "var(--dang-t)",
            border: "1px solid rgba(192,52,43,.25)",
            borderRadius: 12,
            padding: "11px 15px",
            fontSize: 13,
            color: "var(--dang)",
          }}
        >
          {error === "taken"
            ? t("oc2.teams.errTaken")
            : error === "owns"
              ? t("oc2.teams.errOwns")
              : t("oc2.teams.errInvalid")}
        </div>
      )}

      {data.rows.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--line)",
            borderRadius: "var(--radius-card)",
            padding: 26,
            textAlign: "center",
            fontSize: 13,
            color: "var(--ink-2)",
          }}
        >
          {t("oc2.teams.empty")}
        </div>
      ) : (
        data.rows.map((team) => {
          const people = data.people.filter((p) => p.teamId === team.id);
          const owned = data.owned.get(team.id) ?? 0;
          const showing = open === team.id;
          const outsiders = data.everyone.filter((m) => !people.some((p) => p.id === m.id));
          return (
            <div
              key={team.id}
              data-testid="team-row"
              style={{
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-card)",
                boxShadow: "var(--shadow-card)",
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    background: avatarTone(team.name).bg,
                    color: avatarTone(team.name).ink,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 11.5,
                    fontWeight: 700,
                    flex: "none",
                  }}
                >
                  {initials(team.name)}
                </span>
                <div style={{ minWidth: 200, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{team.name}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    {team.policyName
                      ? team.published
                        ? t("oc2.teams.paged", { policy: team.policyName })
                        : t("oc2.teams.pathDraft", { policy: team.policyName })
                      : t("oc2.teams.noPath")}
                    {team.chatChannel ? ` · ${team.chatChannel}` : ""}
                    {owned > 0 ? ` · ${t("oc2.teams.owns", { count: owned })}` : ""}
                  </div>
                </div>
                {/* The two ways a team fails to wake anybody, said on the row. */}
                {(!team.policyName || !team.published || people.length === 0) && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--wait)",
                      background: "var(--wait-t)",
                      borderRadius: 999,
                      padding: "2px 9px",
                    }}
                  >
                    {people.length === 0 ? t("oc2.teams.nobody") : t("oc2.teams.unreachable")}
                  </span>
                )}
                {manages && (
                  <>
                    <TeamDialog
                      paths={data.paths}
                      members={data.everyone}
                      team={{
                        id: team.id,
                        name: team.name,
                        policyPathId: team.policyPathId,
                        chatChannel: team.chatChannel,
                      }}
                    />
                    <form action={deleteTeam}>
                      <input type="hidden" name="id" value={team.id} />
                      <button
                        type="submit"
                        data-testid="team-delete"
                        aria-label={t("common.delete")}
                        className="oi-hover-dang"
                        style={{
                          width: 26,
                          height: 26,
                          border: "1px solid var(--line)",
                          borderRadius: 8,
                          background: "var(--panel)",
                          color: "var(--dang)",
                          display: "grid",
                          placeItems: "center",
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        ✕
                      </button>
                    </form>
                  </>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                {people.length === 0 && (
                  <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    {t("oc2.teams.noMembers")}
                  </span>
                )}
                {people.map((p) => (
                  <span
                    key={p.id}
                    data-testid="team-member"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      height: 26,
                      padding: manages ? "0 4px 0 8px" : "0 10px",
                      border: "1px solid var(--line)",
                      borderRadius: 999,
                      fontSize: 12,
                    }}
                  >
                    {p.name}
                    {manages && (
                      <form action={updateTeamMember} style={{ display: "contents" }}>
                        <input type="hidden" name="teamId" value={team.id} />
                        <input type="hidden" name="memberId" value={p.id} />
                        <input type="hidden" name="op" value="remove" />
                        <button
                          type="submit"
                          aria-label={t("common.delete")}
                          style={{
                            width: 18,
                            height: 18,
                            border: 0,
                            borderRadius: "50%",
                            background: "var(--sunk)",
                            color: "var(--ink-3)",
                            fontSize: 10,
                            cursor: "pointer",
                            display: "grid",
                            placeItems: "center",
                          }}
                        >
                          ✕
                        </button>
                      </form>
                    )}
                  </span>
                ))}
                <span style={{ flex: 1 }} />
                {manages && outsiders.length > 0 && !showing && (
                  <a
                    href={`/app/on-call?tab=teams&members=${team.id}`}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--brand)",
                      textDecoration: "none",
                    }}
                  >
                    {t("oc2.teams.addMember")}
                  </a>
                )}
              </div>

              {manages && showing && outsiders.length > 0 && (
                <form
                  action={updateTeamMember}
                  data-testid="team-member-form"
                  style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
                >
                  <input type="hidden" name="teamId" value={team.id} />
                  <input type="hidden" name="op" value="add" />
                  <select
                    name="memberId"
                    className="oi-field"
                    style={{
                      height: 30,
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      padding: "0 8px",
                      fontSize: 12.5,
                      background: "var(--panel)",
                    }}
                  >
                    {outsiders.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="oi-hover-brand-2"
                    style={{
                      height: 30,
                      padding: "0 12px",
                      border: 0,
                      borderRadius: 8,
                      background: "var(--brand)",
                      color: "var(--on-brand)",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {t("oc2.teams.addMember")}
                  </button>
                </form>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
