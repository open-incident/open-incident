/**
 * Demo rows the V2 design shows for chat-v2 (Settings › Slack & Teams) —
 * idempotent: installs are upserted on their unique key, channels and
 * identities are inserted only when missing, and the chat log rows this part
 * writes carry `meta.seed` so a second run replaces them instead of adding
 * more. Called by the demo seed and by `run.ts --part chat-v2`. Owner: chat-v2.
 *
 * What it builds on the demo's own incidents and members:
 *  - a Slack workspace "Skylark" installed by Karim Haddad, and a Teams team
 *    "Incidents" paired by him — demo installs: their tokens are not real, so
 *    on an instance with Slack and Teams configured a message sent from the
 *    demo fails, and the Health section says so, which is the truth;
 *  - incident channels for the recent incidents (14 in Slack, 5 in Teams,
 *    #inc-220 and #inc-221 among them while those are open);
 *  - the identities matched by email, one member Slack does not know and two
 *    the team does not hold;
 *  - three responders who page through chat (high-urgency rules that start
 *    with Slack or Teams), only where they had no rule yet;
 *  - two rules that post their alerts to a Slack channel, only where the rule
 *    posts nowhere yet;
 *  - the chat log: deliveries of the last hour, a failed invitation, a page
 *    acknowledged from chat, the last pin.
 */
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { encryptSecrets } from "@openincident/crypto";
import {
  alertRoutes,
  chatIdentities,
  incidentChannels,
  incidents,
  integrationInstalls,
  members,
  notificationMethods,
  notificationRules,
  type NotificationStep,
} from "../../schema/app";
import { chatEvents } from "../../schema/chat";
import type { SeedTx } from "./types";

const SLACK_TEAM = "T0SKYLARKDEMO";
const TEAMS_GROUP = "skylark-demo-team-incidents";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);

export async function seed(tx: SeedTx, tenantId: string): Promise<void> {
  const people = await tx
    .select({ id: members.id, email: members.email, name: members.name, status: members.status })
    .from(members)
    .where(eq(members.tenantId, tenantId));
  const byMail = (local: string) =>
    (people as Array<{ id: string; email: string; name: string; status: string }>).find((m) =>
      m.email.startsWith(`${local}@`),
    );
  const karim = byMail("karim");
  if (!karim) return; // Not the demo cast: nothing to tell.

  /* ---------- The two installs ---------- */
  const slackConfig = {
    channelMode: "auto",
    channelPrefix: "inc-",
    announceChannelId: "C0DEMOINCIDENTS",
    announceChannelName: "incidents",
    autoInvite: true,
    inviteOnCall: true,
    dmPages: true,
    postRca: true,
    atlasDrafts: false,
    installedAt: new Date("2026-09-30T09:12:00Z").toISOString(),
  };
  const teamsConfig = {
    aadTenantId: "skylark-demo-aad-tenant",
    serviceUrl: "https://smba.trafficmanager.net/emea/",
    generalChannelId: "19:demo-general@thread.tacv2",
    channelMode: "auto",
    channelPrefix: "inc-",
    announceChannelId: "19:demo-announcements@thread.tacv2",
    announceChannelName: "Announcements",
    autoInvite: true,
    inviteOnCall: true,
    dmPages: true,
    postRca: true,
    atlasDrafts: false,
    installedAt: new Date("2026-10-02T14:40:00Z").toISOString(),
    tenantDomain: "skylark.dev",
  };
  await tx
    .insert(integrationInstalls)
    .values({
      tenantId,
      kind: "slack",
      externalId: SLACK_TEAM,
      externalName: "Skylark",
      botUserId: "U0OIDEMOBOT",
      encryptedSecrets: encryptSecrets({ bot_token: "xoxb-demo-token-not-valid-anywhere" }),
      config: slackConfig,
      status: "active",
      installedByMemberId: karim.id,
      createdAt: new Date(slackConfig.installedAt),
    })
    .onConflictDoNothing({ target: [integrationInstalls.tenantId, integrationInstalls.kind] });
  await tx
    .insert(integrationInstalls)
    .values({
      tenantId,
      kind: "teams",
      externalId: TEAMS_GROUP,
      externalName: "Incidents",
      config: teamsConfig,
      status: "active",
      installedByMemberId: karim.id,
      createdAt: new Date(teamsConfig.installedAt),
    })
    .onConflictDoNothing({ target: [integrationInstalls.tenantId, integrationInstalls.kind] });

  /* ---------- Incident channels ---------- */
  const recent = await tx
    .select({ id: incidents.id, number: incidents.number, declaredAt: incidents.declaredAt })
    .from(incidents)
    .where(
      and(
        eq(incidents.tenantId, tenantId),
        eq(incidents.visibility, "public"),
        eq(incidents.mode, "live"),
        gte(incidents.declaredAt, sql`now() - interval '90 days'`),
      ),
    )
    .orderBy(desc(incidents.declaredAt));
  const open = await tx
    .select({ id: incidents.id, number: incidents.number, declaredAt: incidents.declaredAt })
    .from(incidents)
    .where(
      and(
        eq(incidents.tenantId, tenantId),
        inArray(incidents.number, [220, 221]),
        eq(incidents.visibility, "public"),
      ),
    );
  const pickSlack = [
    ...open,
    ...recent.filter((r: { number: number }) => r.number !== 220 && r.number !== 221),
  ].slice(0, 14);
  const pickTeams = [
    ...open.filter((r: { number: number }) => r.number === 220),
    ...recent.filter((r: { number: number }) => r.number !== 220 && r.number !== 221),
  ].slice(0, 5);
  for (const inc of pickSlack as Array<{ id: string; number: number; declaredAt: Date }>)
    await tx
      .insert(incidentChannels)
      .values({
        tenantId,
        incidentId: inc.id,
        kind: "slack",
        channelId: `C0DEMO${inc.number}`,
        channelName: `inc-${inc.number}`,
        headerTs: `${Math.floor(inc.declaredAt.getTime() / 1000)}.000100`,
        createdAt: inc.declaredAt,
      })
      .onConflictDoNothing();
  for (const inc of pickTeams as Array<{ id: string; number: number; declaredAt: Date }>)
    await tx
      .insert(incidentChannels)
      .values({
        tenantId,
        incidentId: inc.id,
        kind: "teams",
        channelId: `19:demo-inc-${inc.number}@thread.tacv2`,
        channelName: `inc-${inc.number}`,
        meta: {},
        createdAt: inc.declaredAt,
      })
      .onConflictDoNothing();

  /* ---------- Who is who ---------- */
  const active = (
    people as Array<{ id: string; email: string; name: string; status: string }>
  ).filter((m) => m.status === "active");
  const notInSlack = new Set(["lucas"]);
  const notInTeams = new Set(["lucas", "claire"]);
  for (const m of active) {
    const local = m.email.split("@")[0]!;
    if (!notInSlack.has(local))
      await tx
        .insert(chatIdentities)
        .values({
          tenantId,
          memberId: m.id,
          kind: "slack",
          externalUserId: `U0DEMO${local.toUpperCase()}`,
        })
        .onConflictDoNothing();
    if (!notInTeams.has(local))
      await tx
        .insert(chatIdentities)
        .values({ tenantId, memberId: m.id, kind: "teams", externalUserId: `aad-demo-${local}` })
        .onConflictDoNothing();
  }

  /* ---------- Responders who page through chat ---------- */
  const paging: Array<[string, NotificationStep[], "slack" | "teams" | null]> = [
    [
      "karim",
      [
        { kind: "slack", delayMinutes: 0 },
        { kind: "voice", delayMinutes: 1 },
      ],
      "slack",
    ],
    [
      "nadia",
      [
        { kind: "slack", delayMinutes: 0 },
        { kind: "sms", delayMinutes: 2 },
      ],
      "slack",
    ],
    [
      "lucas",
      [
        { kind: "slack", delayMinutes: 0 },
        { kind: "voice", delayMinutes: 3 },
      ],
      null,
    ],
    [
      "thomas",
      [
        { kind: "teams", delayMinutes: 0 },
        { kind: "voice", delayMinutes: 1 },
      ],
      "teams",
    ],
  ];
  for (const [local, steps, method] of paging) {
    const m = byMail(local);
    if (!m || m.status !== "active") continue;
    await tx
      .insert(notificationRules)
      .values({ tenantId, memberId: m.id, urgency: "high", steps })
      .onConflictDoNothing();
    if (!method) continue;
    const [has] = await tx
      .select({ id: notificationMethods.id })
      .from(notificationMethods)
      .where(and(eq(notificationMethods.memberId, m.id), eq(notificationMethods.kind, method)));
    if (!has)
      await tx.insert(notificationMethods).values({
        tenantId,
        memberId: m.id,
        kind: method,
        value: method === "slack" ? `U0DEMO${local.toUpperCase()}` : `aad-demo-${local}`,
        label: method === "slack" ? `@${local}` : "Microsoft Teams",
        verifiedAt: new Date(slackConfig.installedAt),
      });
  }

  /* ---------- Rules that post alerts to a channel ---------- */
  const posting: Array<[string, string, string]> = [
    ["Production alerts", "C0DEMOALERTSPROD", "alerts-prod"],
    ["Staging — silencieux", "C0DEMOALERTSSTAGING", "alerts-staging"],
  ];
  for (const [name, id, channel] of posting)
    await tx
      .update(alertRoutes)
      .set({ notify: { slackChannelId: id, slackChannelName: channel } })
      .where(
        and(
          eq(alertRoutes.tenantId, tenantId),
          eq(alertRoutes.name, name),
          isNull(alertRoutes.notify),
        ),
      );

  /* ---------- The chat log ---------- */
  await tx
    .delete(chatEvents)
    .where(and(eq(chatEvents.tenantId, tenantId), sql`${chatEvents.meta}->>'seed' = 'true'`));
  const nadia = byMail("nadia");
  const thomas = byMail("thomas");
  const lucas = byMail("lucas");
  const claire = byMail("claire");
  const inc220 = (open as Array<{ id: string; number: number }>).find((r) => r.number === 220);
  type Row = typeof chatEvents.$inferInsert;
  const rows: Row[] = [
    // Slack: the hour's deliveries, newest first in the Health list.
    {
      provider: "slack",
      kind: "pin",
      direction: "in",
      target: "#inc-220",
      incidentId: inc220?.id,
      memberId: thomas?.id,
      createdAt: ago(2),
    },
    {
      provider: "slack",
      kind: "update",
      target: "#inc-220",
      detail: nadia?.name,
      incidentId: inc220?.id,
      createdAt: ago(9),
    },
    {
      provider: "slack",
      kind: "page",
      target: nadia?.name ?? "Nadia Benali",
      detail: "INC-220",
      memberId: nadia?.id,
      meta: { ackAt: ago(14).toISOString(), ackBy: nadia?.name },
      createdAt: ago(15),
    },
    {
      provider: "slack",
      kind: "announcement",
      target: "#incidents",
      incidentId: inc220?.id,
      meta: { edited: true },
      createdAt: ago(33),
    },
    {
      provider: "slack",
      kind: "invite",
      target: "#inc-220",
      detail: lucas?.name ?? "Lucas Girard",
      incidentId: inc220?.id,
      memberId: lucas?.id,
      status: "failed",
      error: "users_not_found",
      createdAt: ago(61),
    },
    {
      provider: "slack",
      kind: "lookup",
      target: lucas?.name,
      detail: lucas?.email,
      memberId: lucas?.id,
      status: "failed",
      error: "users_not_found",
      createdAt: ago(62),
    },
    // Teams.
    {
      provider: "teams",
      kind: "update",
      target: "inc-220",
      detail: nadia?.name,
      incidentId: inc220?.id,
      createdAt: ago(18),
    },
    {
      provider: "teams",
      kind: "header",
      target: "inc-220",
      incidentId: inc220?.id,
      createdAt: ago(19),
    },
    {
      provider: "teams",
      kind: "announcement",
      target: "Announcements",
      incidentId: inc220?.id,
      meta: { edited: true },
      createdAt: ago(34),
    },
    {
      provider: "teams",
      kind: "invite",
      target: "inc-220",
      detail: lucas?.name ?? "Lucas Girard",
      incidentId: inc220?.id,
      memberId: lucas?.id,
      status: "failed",
      error: "not_in_team",
      createdAt: ago(62),
    },
    {
      provider: "teams",
      kind: "lookup",
      target: lucas?.name,
      detail: lucas?.email,
      memberId: lucas?.id,
      status: "failed",
      error: "not_in_team",
      createdAt: ago(63),
    },
    {
      provider: "teams",
      kind: "lookup",
      target: claire?.name,
      detail: claire?.email,
      memberId: claire?.id,
      status: "failed",
      error: "not_in_team",
      createdAt: ago(63),
    },
  ].map((r) => ({
    tenantId,
    direction: "out",
    status: "delivered",
    ...r,
    meta: { ...(r.meta ?? {}), seed: true },
  })) as Row[];
  await tx.insert(chatEvents).values(rows);
}
