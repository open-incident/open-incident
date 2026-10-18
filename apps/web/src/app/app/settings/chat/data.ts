/**
 * Everything Settings › Slack & Teams shows, read in one pass from the real
 * tables: the installs, the chat log (chat_events), the incident channels,
 * the linked identities, the members' paging rules, the rules that post
 * alerts, and — for the "What people see" preview — the workspace's own
 * latest incident, alert and Atlas action. A figure on the page is a count of
 * rows; nothing is made up, and an empty table is an empty answer.
 */
import "server-only";
import { and, count, desc, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import {
  alertPriorities,
  alertRoutes,
  alertSources,
  alerts,
  atlasActions,
  chatEvents,
  chatIdentities,
  escalationPaths,
  incidentChannels,
  incidentRoles,
  incidentStatuses,
  incidentUpdates,
  incidents,
  investigations,
  members,
  notificationMethods,
  notificationRules,
  roleAssignments,
  services,
  severities,
  withTenant,
  type ChatEventKind,
  type ChatProvider,
  type Tx,
} from "@openincident/db";
import {
  getSlackInstall,
  getTeamsInstall,
  getTeamsPairing,
  onCallForIncident,
  slack,
  slackConfigured,
  teamsAppId,
  teamsConfigured,
  teamsGraph,
  type SlackInstall,
  type TeamsInstall,
} from "@openincident/chat";
import { describeConditions } from "@/lib/route-summary";
import type { Translate } from "@/i18n/server";
import "@/lib/chat-on-call";

export type ChatEventView = {
  at: string;
  kind: ChatEventKind;
  direction: "in" | "out";
  target: string | null;
  detail: string | null;
  status: "delivered" | "failed";
  error: string | null;
  meta: { edited?: boolean; ackAt?: string; ackBy?: string; resolved?: boolean; byHand?: boolean };
};

export type Tone = "dang" | "wait" | "open" | "ok" | "mute";

export type ProviderData = {
  id: ChatProvider;
  /** The instance has what this tool needs (app credentials / bot). */
  env: boolean;
  connected: boolean;
  pairing: { code: string; expiresAt: string } | null;
  team: string | null;
  tenantDomain: string | null;
  installedBy: { you: boolean; name: string | null } | null;
  installedAt: string | null;
  config: {
    mode: "auto" | "none";
    prefix: string;
    announceId: string | null;
    announceName: string | null;
    autoInvite: boolean;
    inviteOnCall: boolean;
    dmPages: boolean;
    postRca: boolean;
    atlasDrafts: boolean;
  };
  /** Channels the announcement can go to, as the tool lists them — empty when it could not be read. */
  channelOptions: Array<{ id: string; name: string }>;
  stats: { channels90: number; linked: number; members: number; misses: number };
  last: ChatEventView | null;
  open: Array<{ label: string; tone: Tone }>;
  pages: Array<{
    memberId: string;
    name: string;
    step: number;
    next: { kind: string; delay: number } | null;
    reachable: boolean;
  }>;
  rules: Array<{
    id: string;
    name: string;
    channel: string;
    when: string;
    alerts7d: number;
    muted: boolean;
  }>;
  people: Array<{
    memberId: string;
    name: string;
    email: string;
    linked: boolean;
    byHandAt: string | null;
    miss: boolean;
  }>;
  health: { events: ChatEventView[]; failedLastHour: number; sentLastHour: number };
};

export type PreviewData = {
  incident: {
    reference: string;
    name: string;
    status: string | null;
    statusTone: Tone;
    severity: string | null;
    severityTone: Tone;
    lead: string | null;
    service: string | null;
    createdAt: string;
    bridge: boolean;
    people: string[];
    onCall: string[];
    update: { by: string; message: string; status: string | null; at: string } | null;
    lastActivityAt: string;
  } | null;
  nextNumber: number;
  alert: {
    title: string;
    priority: string | null;
    source: string;
    fields: Array<[string, string]>;
    at: string;
    resolvedAt: string | null;
  } | null;
  atlas: {
    reference: string;
    service: string | null;
    level: number;
    title: string;
    detail: string | null;
    reversible: boolean;
    costEur: number;
    at: string;
    rca: {
      title: string;
      confidence: string | null;
      findings: number;
      challenged: boolean;
      at: string;
    } | null;
  } | null;
  pageTarget: string;
  pathName: string | null;
  unlinkedName: string | null;
  lastPin: { by: string } | null;
};

export type ChatPageData = {
  manage: boolean;
  meId: string;
  meName: string;
  teamsAppId: string;
  providers: { slack: ProviderData; teams: ProviderData };
  preview: PreviewData;
};

const OUTBOUND: ChatEventKind[] = [
  "channel",
  "header",
  "update",
  "note",
  "announcement",
  "page",
  "invite",
  "test",
  "alert",
  "rca",
  "atlas",
  "draft",
];

function eventView(r: typeof chatEvents.$inferSelect): ChatEventView {
  return {
    at: r.createdAt.toISOString(),
    kind: r.kind,
    direction: r.direction,
    target: r.target,
    detail: r.detail,
    status: r.status,
    error: r.error,
    meta: r.meta as ChatEventView["meta"],
  };
}

function severityTone(rank: number | null | undefined): Tone {
  if (rank === null || rank === undefined) return "mute";
  return rank <= 0 ? "dang" : rank === 1 ? "wait" : "open";
}

function statusTone(name: string | null | undefined, phase: string): Tone {
  if (phase === "post_incident" || phase === "closed") return "ok";
  const n = (name ?? "").toLowerCase();
  if (/monitor|resolv|fixed/.test(n)) return "ok";
  if (/identif|mitigat/.test(n)) return "wait";
  return "dang";
}

async function providerData(
  tx: Tx,
  tenantId: string,
  provider: ChatProvider,
  install: SlackInstall | TeamsInstall | null,
  ctx: {
    meId: string;
    active: Array<{ id: string; name: string; email: string }>;
    t: Translate;
  },
): Promise<ProviderData> {
  const env = provider === "slack" ? slackConfigured() : teamsConfigured();
  const pairing = provider === "teams" && !install ? await getTeamsPairing(tx, tenantId) : null;
  const slackCfg = provider === "slack" && install ? (install as SlackInstall).config : null;
  const teamsCfg = provider === "teams" && install ? (install as TeamsInstall).config : null;
  const settings = install?.settings;
  const config: ProviderData["config"] = {
    mode: (slackCfg ?? teamsCfg)?.channelMode ?? "auto",
    prefix: (slackCfg ?? teamsCfg)?.channelPrefix ?? "inc-",
    announceId: (slackCfg ?? teamsCfg)?.announceChannelId ?? null,
    announceName: (slackCfg ?? teamsCfg)?.announceChannelName ?? null,
    autoInvite: slackCfg ? slackCfg.autoInvite : (settings?.autoInvite ?? true),
    inviteOnCall: settings?.inviteOnCall ?? true,
    dmPages: settings?.dmPages ?? true,
    postRca: settings?.postRca ?? true,
    atlasDrafts: settings?.atlasDrafts ?? false,
  };
  const base: ProviderData = {
    id: provider,
    env,
    connected: Boolean(install),
    pairing: pairing ? { code: pairing.code, expiresAt: pairing.expiresAt.toISOString() } : null,
    team: install?.teamName ?? null,
    tenantDomain: settings?.tenantDomain ?? null,
    installedBy: null,
    installedAt: null,
    config,
    channelOptions: [],
    stats: { channels90: 0, linked: 0, members: ctx.active.length, misses: 0 },
    last: null,
    open: [],
    pages: [],
    rules: [],
    people: [],
    health: { events: [], failedLastHour: 0, sentLastHour: 0 },
  };

  // Who matched, who did not — the People section, and the card's "members linked".
  const ids = await tx
    .select({ memberId: chatIdentities.memberId })
    .from(chatIdentities)
    .where(and(eq(chatIdentities.tenantId, tenantId), eq(chatIdentities.kind, provider)));
  const linked = new Set(ids.map((r) => r.memberId));
  const lookups = await tx
    .select({
      memberId: chatEvents.memberId,
      status: chatEvents.status,
      meta: chatEvents.meta,
      at: chatEvents.createdAt,
    })
    .from(chatEvents)
    .where(
      and(
        eq(chatEvents.tenantId, tenantId),
        eq(chatEvents.provider, provider),
        eq(chatEvents.kind, "lookup"),
        isNotNull(chatEvents.memberId),
      ),
    )
    .orderBy(desc(chatEvents.createdAt))
    .limit(500);
  const latestLookup = new Map<string, (typeof lookups)[number]>();
  for (const l of lookups)
    if (l.memberId && !latestLookup.has(l.memberId)) latestLookup.set(l.memberId, l);
  base.people = ctx.active.map((m) => {
    const l = latestLookup.get(m.id);
    const isLinked = linked.has(m.id);
    return {
      memberId: m.id,
      name: m.name,
      email: m.email,
      linked: isLinked,
      byHandAt:
        isLinked && l && (l.meta as { byHand?: boolean }).byHand ? l.at.toISOString() : null,
      miss: !isLinked && l?.status === "failed",
    };
  });
  base.stats.linked = base.people.filter((p) => p.linked).length;
  base.stats.misses = base.people.filter((p) => p.miss).length;

  if (!install) return base;

  const by = install.installedByMemberId
    ? ctx.active.find((m) => m.id === install.installedByMemberId)
    : null;
  base.installedBy = {
    you: install.installedByMemberId === ctx.meId,
    name: by?.name ?? null,
  };
  base.installedAt = settings?.installedAt ?? install.createdAt.toISOString();

  const [channels] = await tx
    .select({ n: count() })
    .from(incidentChannels)
    .where(
      and(
        eq(incidentChannels.tenantId, tenantId),
        eq(incidentChannels.kind, provider),
        gte(incidentChannels.createdAt, sql`now() - interval '90 days'`),
      ),
    );
  base.stats.channels90 = channels?.n ?? 0;

  const [last] = await tx
    .select()
    .from(chatEvents)
    .where(
      and(
        eq(chatEvents.tenantId, tenantId),
        eq(chatEvents.provider, provider),
        ne(chatEvents.kind, "lookup"),
      ),
    )
    .orderBy(desc(chatEvents.createdAt))
    .limit(1);
  base.last = last ? eventView(last) : null;

  const open = await tx
    .select({
      name: incidentChannels.channelName,
      rank: severities.rank,
      number: incidents.number,
    })
    .from(incidentChannels)
    .innerJoin(incidents, eq(incidents.id, incidentChannels.incidentId))
    .leftJoin(severities, eq(severities.id, incidents.severityId))
    .where(
      and(
        eq(incidentChannels.tenantId, tenantId),
        eq(incidentChannels.kind, provider),
        inArray(incidents.phase, ["triage", "active"]),
      ),
    )
    .orderBy(desc(incidents.number))
    .limit(4);
  base.open = open.map((o) => ({
    label: provider === "slack" ? `#${o.name}` : o.name,
    tone: severityTone(o.rank),
  }));
  if (config.announceName)
    base.open.push({
      label: provider === "slack" ? `#${config.announceName}` : config.announceName,
      tone: "ok",
    });

  // The outbox: what really went out, newest first.
  const events = await tx
    .select()
    .from(chatEvents)
    .where(
      and(
        eq(chatEvents.tenantId, tenantId),
        eq(chatEvents.provider, provider),
        eq(chatEvents.direction, "out"),
        inArray(chatEvents.kind, OUTBOUND),
      ),
    )
    .orderBy(desc(chatEvents.createdAt))
    .limit(6);
  const [hour] = await tx
    .select({
      sent: count(),
      failed: sql<number>`count(*) filter (where ${chatEvents.status} = 'failed')`.mapWith(Number),
    })
    .from(chatEvents)
    .where(
      and(
        eq(chatEvents.tenantId, tenantId),
        eq(chatEvents.provider, provider),
        eq(chatEvents.direction, "out"),
        inArray(chatEvents.kind, OUTBOUND),
        gte(chatEvents.createdAt, sql`now() - interval '1 hour'`),
      ),
    );
  base.health = {
    events: events.map(eventView),
    sentLastHour: hour?.sent ?? 0,
    failedLastHour: hour?.failed ?? 0,
  };

  // Pages in chat: the members whose high-urgency rule names this tool.
  const rules = await tx
    .select({ memberId: notificationRules.memberId, steps: notificationRules.steps })
    .from(notificationRules)
    .where(and(eq(notificationRules.tenantId, tenantId), eq(notificationRules.urgency, "high")));
  const methods = await tx
    .select({ memberId: notificationMethods.memberId })
    .from(notificationMethods)
    .where(
      and(
        eq(notificationMethods.tenantId, tenantId),
        eq(notificationMethods.kind, provider),
        isNotNull(notificationMethods.verifiedAt),
      ),
    );
  const reachable = new Set(methods.map((m) => m.memberId));
  for (const r of rules) {
    const member = ctx.active.find((m) => m.id === r.memberId);
    const i = r.steps.findIndex((s) => s.kind === provider);
    if (!member || i < 0) continue;
    const next = r.steps[i + 1];
    base.pages.push({
      memberId: member.id,
      name: member.name,
      step: i + 1,
      next: next
        ? { kind: next.kind, delay: Math.max(0, next.delayMinutes - r.steps[i]!.delayMinutes) }
        : null,
      reachable: reachable.has(member.id),
    });
  }
  base.pages.sort(
    (a, b) =>
      Number(a.reachable === b.reachable ? 0 : a.reachable ? -1 : 1) ||
      a.name.localeCompare(b.name),
  );

  // Alerts in channels: the rules that post to a channel of this tool (Slack only today).
  if (provider === "slack") {
    const routes = await tx
      .select()
      .from(alertRoutes)
      .where(
        and(
          eq(alertRoutes.tenantId, tenantId),
          sql`${alertRoutes.notify}->>'slackChannelId' is not null`,
        ),
      )
      .orderBy(alertRoutes.position);
    const counts = routes.length
      ? await tx
          .select({ routeId: alerts.routeId, n: count() })
          .from(alerts)
          .where(
            and(
              eq(alerts.tenantId, tenantId),
              inArray(
                alerts.routeId,
                routes.map((r) => r.id),
              ),
              gte(alerts.firstAt, sql`now() - interval '7 days'`),
            ),
          )
          .groupBy(alerts.routeId)
      : [];
    base.rules = routes.map((r) => ({
      id: r.id,
      name: r.name,
      channel: `#${(r.notify?.slackChannelName ?? r.notify?.slackChannelId ?? "").replace(/^#/, "")}`,
      when: describeConditions(r.conditions, ctx.t),
      alerts7d: counts.find((c) => c.routeId === r.id)?.n ?? 0,
      muted: r.escalationMode === "none",
    }));
  }
  return base;
}

/** The channels the announcement can go to — read from the tool itself, so a fake list is impossible. */
async function channelOptions(
  provider: ChatProvider,
  install: SlackInstall | TeamsInstall | null,
): Promise<Array<{ id: string; name: string }>> {
  if (!install) return [];
  try {
    if (provider === "slack") {
      const list = await slack((install as SlackInstall).token).listChannels();
      return list.map((c) => ({ id: c.id, name: c.name }));
    }
    if (!teamsConfigured()) return [];
    const t = install as TeamsInstall;
    const r = await teamsGraph.listChannels(t.config.aadTenantId, t.teamId);
    return r.ok ? r.value.value.map((c) => ({ id: c.id, name: c.displayName })) : [];
  } catch {
    return [];
  }
}

async function previewData(
  tx: Tx,
  tenantId: string,
  slackPages: ProviderData["pages"],
  people: ProviderData["people"],
  me: string,
): Promise<PreviewData> {
  const [inc] = await tx
    .select({
      inc: incidents,
      status: incidentStatuses.name,
      severity: severities.name,
      rank: severities.rank,
      service: services.key,
    })
    .from(incidents)
    .leftJoin(incidentStatuses, eq(incidentStatuses.id, incidents.statusId))
    .leftJoin(severities, eq(severities.id, incidents.severityId))
    .leftJoin(services, eq(services.id, incidents.serviceId))
    .where(
      and(
        eq(incidents.tenantId, tenantId),
        eq(incidents.visibility, "public"),
        ne(incidents.mode, "test"),
      ),
    )
    .orderBy(
      sql`case when ${incidents.phase} in ('triage','active') then 0 else 1 end`,
      desc(incidents.number),
    )
    .limit(1);
  const [max] = await tx
    .select({ n: sql<number>`coalesce(max(${incidents.number}), 0)`.mapWith(Number) })
    .from(incidents)
    .where(eq(incidents.tenantId, tenantId));

  let incident: PreviewData["incident"] = null;
  if (inc) {
    const roles = await tx
      .select({ name: members.name, isLead: incidentRoles.isLead })
      .from(roleAssignments)
      .innerJoin(incidentRoles, eq(incidentRoles.id, roleAssignments.roleId))
      .innerJoin(members, eq(members.id, roleAssignments.memberId))
      .where(eq(roleAssignments.incidentId, inc.inc.id));
    const [creator] = inc.inc.creatorMemberId
      ? await tx
          .select({ name: members.name })
          .from(members)
          .where(eq(members.id, inc.inc.creatorMemberId))
      : [];
    const peopleNames = [
      ...new Set(
        [creator?.name, ...roles.map((r) => r.name)].filter((x): x is string => Boolean(x)),
      ),
    ];
    const onCall = (await onCallForIncident(tx, tenantId, inc.inc.id)).map((m) => m.name);
    const [upd] = await tx
      .select({
        message: incidentUpdates.message,
        at: incidentUpdates.createdAt,
        by: members.name,
        status: incidentStatuses.name,
      })
      .from(incidentUpdates)
      .leftJoin(members, eq(members.id, incidentUpdates.memberId))
      .leftJoin(incidentStatuses, eq(incidentStatuses.id, incidentUpdates.statusId))
      .where(eq(incidentUpdates.incidentId, inc.inc.id))
      .orderBy(desc(incidentUpdates.createdAt))
      .limit(1);
    incident = {
      reference: `INC-${inc.inc.number}`,
      name: inc.inc.name,
      status: inc.status,
      statusTone: statusTone(inc.status, inc.inc.phase),
      severity: inc.severity,
      severityTone: severityTone(inc.rank),
      lead: roles.find((r) => r.isLead)?.name ?? null,
      service: inc.service,
      createdAt: inc.inc.declaredAt.toISOString(),
      bridge: Boolean(inc.inc.bridgeUrl),
      people: peopleNames.filter((n) => !onCall.includes(n)),
      onCall,
      update: upd
        ? { by: upd.by ?? "—", message: upd.message, status: upd.status, at: upd.at.toISOString() }
        : null,
      lastActivityAt: (inc.inc.lastActivityAt ?? inc.inc.declaredAt).toISOString(),
    };
  }

  // An alert as a rule would post it: the latest one, preferring a rule that posts.
  const [al] = await tx
    .select({
      a: alerts,
      priority: alertPriorities.name,
      source: alertSources.kind,
      sourceName: alertSources.name,
    })
    .from(alerts)
    .leftJoin(alertPriorities, eq(alertPriorities.id, alerts.priorityId))
    .innerJoin(alertSources, eq(alertSources.id, alerts.sourceId))
    .leftJoin(alertRoutes, eq(alertRoutes.id, alerts.routeId))
    .where(and(eq(alerts.tenantId, tenantId), eq(alerts.testMode, false)))
    .orderBy(
      sql`case when ${alertRoutes.notify}->>'slackChannelId' is not null then 0 else 1 end`,
      desc(alerts.firstAt),
    )
    .limit(1);
  const alert: PreviewData["alert"] = al
    ? {
        title: al.a.title,
        priority: al.priority,
        source: al.source,
        fields: Object.entries(al.a.attributes)
          .filter(([k, v]) => v && !k.endsWith("_id") && k !== "source" && k !== "source_name")
          .slice(0, 3)
          .map(([k, v]) => [k, v] as [string, string])
          .concat(al.a.groupCount > 1 ? [["Grouped", `${al.a.groupCount} alerts`]] : []),
        at: al.a.firstAt.toISOString(),
        resolvedAt: al.a.resolvedAt?.toISOString() ?? null,
      }
    : null;

  // What Atlas did on its own most recently, and the analysis of that incident.
  const [act] = await tx
    .select({
      a: atlasActions,
      number: incidents.number,
      service: services.key,
    })
    .from(atlasActions)
    .leftJoin(incidents, eq(incidents.id, atlasActions.incidentId))
    .leftJoin(services, eq(services.id, atlasActions.serviceId))
    .where(
      and(
        eq(atlasActions.tenantId, tenantId),
        eq(atlasActions.autonomous, true),
        eq(atlasActions.kind, "system"),
      ),
    )
    .orderBy(desc(atlasActions.at))
    .limit(1);
  let atlas: PreviewData["atlas"] = null;
  if (act) {
    const [inv] = act.a.incidentId
      ? await tx
          .select({
            summary: investigations.summary,
            hypotheses: investigations.hypotheses,
            findings: investigations.findings,
            updatedAt: investigations.updatedAt,
          })
          .from(investigations)
          .where(eq(investigations.incidentId, act.a.incidentId))
      : [];
    const top = inv?.hypotheses.find((h) => h.id === inv.summary?.topHypothesisId) ?? null;
    atlas = {
      reference: act.number ? `INC-${act.number}` : "",
      service: act.service,
      level: act.a.level ?? 3,
      title: act.a.title,
      detail: act.a.detail,
      reversible: act.a.reversible,
      costEur: act.a.costEur,
      at: act.a.at.toISOString(),
      rca: top
        ? {
            title: top.whatBroke,
            confidence: top.confidence,
            findings: top.findings.length,
            challenged: Boolean(top.challenge),
            at: inv!.updatedAt.toISOString(),
          }
        : null,
    };
  }

  const [path] = await tx
    .select({ name: escalationPaths.name })
    .from(escalationPaths)
    .where(and(eq(escalationPaths.tenantId, tenantId), isNotNull(escalationPaths.currentVersionId)))
    .orderBy(escalationPaths.name)
    .limit(1);
  const [pin] = await tx
    .select({ by: members.name })
    .from(chatEvents)
    .innerJoin(members, eq(members.id, chatEvents.memberId))
    .where(and(eq(chatEvents.tenantId, tenantId), eq(chatEvents.kind, "pin")))
    .orderBy(desc(chatEvents.createdAt))
    .limit(1);
  return {
    incident,
    nextNumber: (max?.n ?? 0) + 1,
    alert,
    atlas,
    pageTarget: slackPages[0]?.name ?? me,
    pathName: path?.name ?? null,
    unlinkedName: people.find((p) => !p.linked)?.name ?? null,
    lastPin: pin ? { by: pin.by } : null,
  };
}

export async function loadChatPage(
  tenantId: string,
  me: { id: string; name: string },
  manage: boolean,
  t: Translate,
): Promise<ChatPageData> {
  const data = await withTenant(tenantId, async (tx) => {
    const active = await tx
      .select({ id: members.id, name: members.name, email: members.email })
      .from(members)
      .where(and(eq(members.tenantId, tenantId), eq(members.status, "active")))
      .orderBy(members.name);
    const slackInstall = await getSlackInstall(tx, tenantId);
    const teamsInstall = await getTeamsInstall(tx, tenantId);
    const ctx = { meId: me.id, active, t };
    const slackData = await providerData(tx, tenantId, "slack", slackInstall, ctx);
    const teamsData = await providerData(tx, tenantId, "teams", teamsInstall, ctx);
    const preview = await previewData(tx, tenantId, slackData.pages, slackData.people, me.name);
    return { slackInstall, teamsInstall, slackData, teamsData, preview };
  });
  // The tools' own channel lists, outside the transaction: a slow API must not hold it.
  const [slackOptions, teamsOptions] = await Promise.all([
    channelOptions("slack", data.slackInstall),
    channelOptions("teams", data.teamsInstall),
  ]);
  data.slackData.channelOptions = slackOptions;
  data.teamsData.channelOptions = teamsOptions;
  return {
    manage,
    meId: me.id,
    meName: me.name,
    teamsAppId: teamsAppId(),
    providers: { slack: data.slackData, teams: data.teamsData },
    preview: data.preview,
  };
}
