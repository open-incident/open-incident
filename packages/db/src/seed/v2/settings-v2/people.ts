/**
 * settings-v2 demo rows — People & access. Idempotent: running it twice leaves
 * the same rows. Called by ../settings-v2.ts inside the seed's transaction,
 * the tenant context already set.
 *
 * What the design's screens show and the demo did not have:
 * - a custom role, "Incident commander", held by Thomas — not Claire as in
 *   the design: Claire is the viewer every permission test signs in as;
 * - an invitation six days old, whose link expires tomorrow, sent by Karim;
 * - a member the identity provider created, then deactivated (Ana Costa);
 * - the SCIM endpoint switched on and called a few minutes ago, with a
 *   token nobody knows (only its hash is stored, as for a real one), and the
 *   three teams it keeps in step with its groups;
 * - when each demo member was last active.
 *
 * No SSO connection: one with "SSO only" on skylark.dev would lock the demo
 * accounts out, and one without a real provider would put a dead button on
 * the sign-in page.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  auditEvents,
  customRoles,
  mailDeliveries,
  members,
  scimSettings,
  teamMembers,
  teams,
  workspaces,
} from "../../../schema/app";
import type { SeedTx } from "../types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export async function seed(tx: SeedTx, tenantId: string): Promise<void> {
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms);
  const cast = await tx
    .select({
      id: members.id,
      email: members.email,
      name: members.name,
      lastSeenAt: members.lastSeenAt,
    })
    .from(members)
    .where(eq(members.tenantId, tenantId));
  const byEmail = new Map<string, { id: string; name: string }>(
    cast.map((m: { id: string; email: string; name: string }) => [m.email, m]),
  );
  const amelie = byEmail.get("amelie@skylark.dev");
  const karim = byEmail.get("karim@skylark.dev");
  const thomas = byEmail.get("thomas@skylark.dev");

  /* ---------- A custom role, held by one member ---------- */
  const [role] = await tx
    .insert(customRoles)
    .values({
      tenantId,
      key: "incident_commander",
      name: "Incident commander",
      description:
        "Runs the response end to end: on-call, status pages, reports, incident settings.",
      base: "responder",
      permissions: [
        "incidents.respond",
        "oncall.manage",
        "statuspages.manage",
        "insights.manage",
        "settings.response",
        "audit.view",
      ],
    })
    .onConflictDoNothing()
    .returning({ id: customRoles.id });
  if (role && thomas)
    await tx
      .update(members)
      .set({ customRoleId: role.id })
      .where(and(eq(members.id, thomas.id), isNull(members.customRoleId)));

  /* ---------- An invitation six days old ---------- */
  const sofia = "sofia.r@skylark.dev";
  const [invited] = await tx
    .insert(members)
    .values({
      tenantId,
      email: sofia,
      name: "Sofia R",
      role: "responder",
      status: "invited",
      createdAt: ago(6 * DAY),
    })
    .onConflictDoNothing()
    .returning({ id: members.id });
  if (invited) {
    const [ws] = await tx
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.tenantId, tenantId));
    await tx.insert(mailDeliveries).values({
      tenantId,
      toAddress: sofia,
      subject: `You are invited to ${ws?.name ?? "Skylark Systems"}`,
      kind: "invitation",
      provider: "smtp",
      status: "sent",
      attempts: 1,
      sentAt: ago(6 * DAY),
      createdAt: ago(6 * DAY),
    });
    await tx.insert(auditEvents).values({
      tenantId,
      actorMemberId: karim?.id ?? null,
      actorName: karim?.name ?? "Karim Haddad",
      category: "members",
      action: "member.invited",
      target: { email: sofia, role: "responder" },
      createdAt: ago(6 * DAY),
    });
  }

  /* ---------- A member the provider created, then removed ---------- */
  const ana = "ana@skylark.dev";
  const [provisioned] = await tx
    .insert(members)
    .values({
      tenantId,
      email: ana,
      name: "Ana Costa",
      role: "responder",
      status: "disabled",
      source: "scim",
      externalId: "00u4ana7costa",
      lastSeenAt: ago(9 * DAY + 3 * HOUR),
      createdAt: ago(40 * DAY),
    })
    .onConflictDoNothing()
    .returning({ id: members.id });
  if (provisioned)
    await tx.insert(auditEvents).values([
      {
        tenantId,
        actorMemberId: null,
        actorName: "SCIM provisioning",
        category: "members",
        action: "member.provisioned",
        target: { email: ana, role: "responder" },
        createdAt: ago(40 * DAY),
      },
      {
        tenantId,
        actorMemberId: null,
        actorName: "SCIM provisioning",
        category: "members",
        action: "member.deactivated_by_provider",
        target: { email: ana },
        createdAt: ago(9 * DAY),
      },
    ]);

  /* ---------- The SCIM endpoint, on ---------- */
  const token = `oi_scim_${randomBytes(24).toString("hex")}`;
  const [endpoint] = await tx
    .insert(scimSettings)
    .values({
      tenantId,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      tokenHint: `…${token.slice(-6)}`,
      enabled: true,
      defaultRole: "responder",
      sendInvites: false,
      createdByMemberId: amelie?.id ?? null,
      lastSeenAt: ago(4 * MIN),
      createdAt: ago(36 * DAY),
    })
    .onConflictDoNothing()
    .returning({ id: scimSettings.id });
  if (endpoint) {
    await tx.insert(auditEvents).values({
      tenantId,
      actorMemberId: amelie?.id ?? null,
      actorName: amelie?.name ?? "Amélie Laurent",
      category: "security",
      action: "scim.enabled",
      target: {},
      createdAt: ago(36 * DAY),
    });
    const groups = await tx
      .select({ name: teams.name, n: sql<number>`count(${teamMembers.memberId})`.mapWith(Number) })
      .from(teams)
      .leftJoin(teamMembers, eq(teamMembers.teamId, teams.id))
      .where(
        and(
          eq(teams.tenantId, tenantId),
          inArray(teams.name, ["Platform", "Payments", "Storefront"]),
        ),
      )
      .groupBy(teams.name);
    if (groups.length)
      await tx.insert(auditEvents).values(
        groups.map((g: { name: string; n: number }, i: number) => ({
          tenantId,
          actorMemberId: null,
          actorName: "SCIM provisioning",
          category: "config" as const,
          action: "team.updated_by_provider",
          target: { name: g.name, members: g.n },
          createdAt: ago(36 * DAY - (i + 1) * MIN),
        })),
      );
  }

  /* ---------- When each demo member was last active ---------- */
  const lastSeen: Record<string, number> = {
    "karim@skylark.dev": 12 * MIN,
    "claire@skylark.dev": 4 * HOUR,
    "nadia@skylark.dev": 26 * HOUR,
    "lucas@skylark.dev": 27 * HOUR,
    "thomas@skylark.dev": 3 * DAY + 2 * HOUR,
  };
  for (const [email, ms] of Object.entries(lastSeen)) {
    const m = byEmail.get(email);
    if (m)
      await tx
        .update(members)
        .set({ lastSeenAt: ago(ms) })
        .where(and(eq(members.id, m.id), isNull(members.lastSeenAt)));
  }
}
