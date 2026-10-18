import "server-only";
import { cache } from "react";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import {
  alertPriorities,
  alertRoutes,
  alerts,
  announcementRules,
  apiKeys,
  auditEvents,
  customRoles,
  escalationPathVersions,
  escalationPaths,
  incidentChannels,
  incidentFields,
  incidentTypes,
  incidents,
  integrationInstalls,
  investigations,
  mailDeliveries,
  members,
  migrationRuns,
  migrationTeamSwitch,
  qaRuns,
  scimSettings,
  serviceAutonomy,
  severities,
  ssoConnections,
  teams,
  telemetrySettings,
  webhookDeliveries,
  webhookEndpoints,
  withTenant,
  workingHoursSets,
  type QaSuite,
} from "@openincident/db";
import { getEdition, hasPermission, type Permission } from "@openincident/config";
import { getT, type Translate } from "@/i18n/server";
import { LOCALES } from "@/i18n/locales";
import { entitlementsFor } from "@/lib/entitlements";
import { requireMember } from "@/lib/session";
import { telemetryInstalled } from "@/lib/telemetry-module";

/**
 * The settings directory: five groups, one entry per screen, each with the
 * one line that says where it stands — read from the workspace's rows, never
 * written by hand — and the short list of what needs somebody now.
 *
 * Read once per request (React `cache`) by the layout, for the navigation and
 * its search, and by the overview, for its cards and "Needs your attention".
 */

export type EntryKey =
  | "general"
  | "brand"
  | "hours"
  | "billing"
  | "members"
  | "roles"
  | "sso"
  | "scim"
  | "chat"
  | "types"
  | "severities"
  | "fields"
  | "announcements"
  | "rules"
  | "alertSeverities"
  | "labels"
  | "migrate"
  | "integrations"
  | "api"
  | "atlas"
  | "telemetry"
  | "audit"
  | "qa";

export type DirectoryEntry = {
  key: EntryKey;
  href: string;
  label: string;
  status: string;
  /** A state that wants a look: the status in that colour, a dot in the navigation. */
  tone?: "wait" | "dang";
  /** Enterprise screen on an instance without the entitlement. */
  locked?: boolean;
  /** Every path that counts as this entry (old URLs and sub-pages included). */
  paths: string[];
  permission: Permission;
};

export type DirectoryGroup = {
  key: "workspace" | "people" | "incidents" | "alerts" | "platform";
  title: string;
  desc: string;
  entries: DirectoryEntry[];
};

export type AttentionItem = {
  tone: "wait" | "dang" | "mute";
  title: string;
  sub: string;
  where: string;
  href: string;
};

/** Opsgenie's announced end of service. */
export const OPSGENIE_SHUTDOWN = new Date("2027-04-05T00:00:00Z");

const DAY = 86_400_000;

type Spec = {
  key: EntryKey;
  href: string;
  permission: Permission;
  paths?: string[];
  ee?: "sso" | "customRoles";
  cloudOnly?: boolean;
};

const GROUPS: Array<{ key: DirectoryGroup["key"]; entries: Spec[] }> = [
  {
    key: "workspace",
    entries: [
      { key: "general", href: "/app/settings/general", permission: "settings.workspace" },
      { key: "brand", href: "/app/settings/brand", permission: "settings.workspace" },
      { key: "hours", href: "/app/settings/working-hours", permission: "settings.workspace" },
      {
        key: "billing",
        href: "/app/settings/billing",
        permission: "settings.workspace",
        cloudOnly: true,
      },
    ],
  },
  {
    key: "people",
    entries: [
      { key: "members", href: "/app/settings/members", permission: "settings.members" },
      {
        key: "roles",
        href: "/app/settings/roles",
        permission: "settings.members",
        ee: "customRoles",
      },
      { key: "sso", href: "/app/settings/sso", permission: "settings.members", ee: "sso" },
      { key: "scim", href: "/app/settings/scim", permission: "settings.members", ee: "sso" },
    ],
  },
  {
    key: "incidents",
    entries: [
      { key: "chat", href: "/app/settings/chat", permission: "settings.platform" },
      {
        key: "types",
        href: "/app/settings/types",
        permission: "settings.response",
        paths: ["/app/settings/post-incident"],
      },
      { key: "severities", href: "/app/settings/severities", permission: "settings.response" },
      { key: "fields", href: "/app/settings/fields", permission: "settings.response" },
      {
        key: "announcements",
        href: "/app/settings/announcements",
        permission: "settings.response",
      },
    ],
  },
  {
    key: "alerts",
    entries: [
      {
        key: "rules",
        href: "/app/settings/rules",
        permission: "settings.alerting",
        paths: ["/app/settings/alert-routes"],
      },
      {
        key: "alertSeverities",
        href: "/app/settings/alert-severities",
        permission: "settings.alerting",
        paths: ["/app/settings/alert-priorities"],
      },
      {
        key: "labels",
        href: "/app/settings/labels",
        permission: "settings.alerting",
        paths: ["/app/settings/alert-attributes"],
      },
    ],
  },
  {
    key: "platform",
    entries: [
      { key: "migrate", href: "/app/settings/migrate", permission: "settings.platform" },
      { key: "integrations", href: "/app/settings/integrations", permission: "settings.platform" },
      { key: "api", href: "/app/settings/api", permission: "settings.platform" },
      { key: "atlas", href: "/app/settings/ai", permission: "settings.platform" },
      {
        key: "telemetry",
        href: "/app/settings/observability",
        permission: "settings.platform",
      },
      { key: "audit", href: "/app/settings/audit", permission: "audit.view" },
      { key: "qa", href: "/app/settings/qa", permission: "settings.platform" },
    ],
  },
];

/** Every entry, as routes only — for the layout's permission check on the current path. */
export function entryForPath(pathname: string): Spec | undefined {
  for (const g of GROUPS)
    for (const e of g.entries) {
      const paths = [e.href, ...(e.paths ?? [])];
      if (paths.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return e;
    }
  return undefined;
}

/** "in 3 days", "tomorrow" — the future the format helper does not write. */
function inDays(t: Translate, days: number): string {
  return new Intl.RelativeTimeFormat(t.locale.tag, { numeric: "auto" }).format(days, "day");
}

function list(t: Translate, names: string[]): string {
  return new Intl.ListFormat(t.locale.tag, { type: "conjunction" }).format(names);
}

type Facts = Awaited<ReturnType<typeof readFacts>>;

async function readFacts(tenantId: string) {
  const since90 = new Date(Date.now() - 90 * DAY);
  const since24 = new Date(Date.now() - DAY);
  const count = sql<number>`count(*)`.mapWith(Number);
  return withTenant(tenantId, async (tx) => {
    const memberRows = await tx
      .select({
        id: members.id,
        email: members.email,
        status: members.status,
        createdAt: members.createdAt,
      })
      .from(members)
      .where(eq(members.tenantId, tenantId));

    const sets = await tx
      .select({ id: workingHoursSets.id })
      .from(workingHoursSets)
      .where(eq(workingHoursSets.tenantId, tenantId));
    const paths = await tx
      .select({
        currentVersionId: escalationPaths.currentVersionId,
        draft: escalationPaths.draftGraph,
      })
      .from(escalationPaths)
      .where(eq(escalationPaths.tenantId, tenantId));
    const versions = await tx
      .select({ id: escalationPathVersions.id, graph: escalationPathVersions.graph })
      .from(escalationPathVersions)
      .where(eq(escalationPathVersions.tenantId, tenantId));
    const usedSets = new Set<string>();
    for (const p of paths) {
      const g = p.draft ?? versions.find((v) => v.id === p.currentVersionId)?.graph;
      for (const n of g?.nodes ?? []) {
        if (n.kind === "condition" && n.test.type === "working_hours") usedSets.add(n.test.setId);
        if (n.kind === "delay" && n.untilWorkingHoursSetId) usedSets.add(n.untilWorkingHoursSetId);
      }
    }

    const [customRoleCount] = await tx
      .select({ n: count })
      .from(customRoles)
      .where(eq(customRoles.tenantId, tenantId));
    const sso = await tx
      .select({
        label: ssoConnections.label,
        enforce: ssoConnections.enforce,
        domains: ssoConnections.allowedDomains,
      })
      .from(ssoConnections)
      .where(eq(ssoConnections.tenantId, tenantId))
      .orderBy(ssoConnections.createdAt);
    const [scim] = await tx
      .select({ enabled: scimSettings.enabled, lastSeenAt: scimSettings.lastSeenAt })
      .from(scimSettings)
      .where(eq(scimSettings.tenantId, tenantId));

    const installs = await tx
      .select({ kind: integrationInstalls.kind })
      .from(integrationInstalls)
      .where(
        and(eq(integrationInstalls.tenantId, tenantId), eq(integrationInstalls.status, "active")),
      );
    const [openChannels] = await tx
      .select({ n: count })
      .from(incidentChannels)
      .innerJoin(incidents, eq(incidents.id, incidentChannels.incidentId))
      .where(
        and(
          eq(incidentChannels.tenantId, tenantId),
          sql`${incidents.phase} in ('triage','active')`,
        ),
      );

    const [typeCount] = await tx
      .select({ n: count })
      .from(incidentTypes)
      .where(eq(incidentTypes.tenantId, tenantId));
    const sevs = await tx
      .select({ name: severities.name })
      .from(severities)
      .where(eq(severities.tenantId, tenantId))
      .orderBy(severities.rank);
    const [fieldCount] = await tx
      .select({ n: count })
      .from(incidentFields)
      .where(eq(incidentFields.tenantId, tenantId));
    const [annCount] = await tx
      .select({ n: count })
      .from(announcementRules)
      .where(and(eq(announcementRules.tenantId, tenantId), eq(announcementRules.active, true)));

    const [ruleCount] = await tx
      .select({ n: count })
      .from(alertRoutes)
      .where(eq(alertRoutes.tenantId, tenantId));
    const prios = await tx
      .select({ name: alertPriorities.name })
      .from(alertPriorities)
      .where(eq(alertPriorities.tenantId, tenantId))
      .orderBy(alertPriorities.rank);
    const labelRows = await tx.execute<{ n: number }>(
      sql`select count(distinct k.key)::int as n
            from ${alerts} a, jsonb_object_keys(a.attributes) as k(key)
           where a.tenant_id = ${tenantId} and a.first_at > ${since90.toISOString()}::timestamptz`,
    );

    const [run] = await tx
      .select()
      .from(migrationRuns)
      .where(eq(migrationRuns.tenantId, tenantId))
      .orderBy(desc(migrationRuns.createdAt))
      .limit(1);
    const switches = run
      ? await tx
          .select({
            state: migrationTeamSwitch.state,
            team: teams.name,
            external: migrationTeamSwitch.teamExternalId,
          })
          .from(migrationTeamSwitch)
          .leftJoin(teams, eq(teams.id, migrationTeamSwitch.teamId))
          .where(
            and(eq(migrationTeamSwitch.tenantId, tenantId), eq(migrationTeamSwitch.runId, run.id)),
          )
      : [];

    const keys = await tx
      .select({
        name: apiKeys.name,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.tenantId, tenantId), isNull(apiKeys.revokedAt)));
    const hooks = await tx
      .select({
        id: webhookEndpoints.id,
        url: webhookEndpoints.url,
        failingSince: webhookEndpoints.failingSince,
        active: webhookEndpoints.active,
        disabledAt: webhookEndpoints.disabledAt,
      })
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.tenantId, tenantId));
    const failing = hooks.filter((h) => h.failingSince);
    const lastFailures = failing.length
      ? await tx
          .select({
            endpointId: webhookDeliveries.endpointId,
            httpStatus: webhookDeliveries.httpStatus,
            createdAt: webhookDeliveries.createdAt,
          })
          .from(webhookDeliveries)
          .where(
            and(
              eq(webhookDeliveries.tenantId, tenantId),
              sql`${webhookDeliveries.endpointId} in (${sql.join(
                failing.map((h) => sql`${h.id}`),
                sql`, `,
              )})`,
            ),
          )
          .orderBy(desc(webhookDeliveries.createdAt))
          .limit(50)
      : [];

    const autonomy = await tx
      .select({ level: serviceAutonomy.level, cap: serviceAutonomy.cap })
      .from(serviceAutonomy)
      .where(eq(serviceAutonomy.tenantId, tenantId));
    const [resolvedAlone] = await tx
      .select({ n: count })
      .from(investigations)
      .where(
        and(
          eq(investigations.tenantId, tenantId),
          eq(investigations.resolvedAlone, true),
          gte(investigations.updatedAt, since24),
        ),
      );

    const [tel] = await tx
      .select({
        traces: telemetrySettings.retentionTracesDays,
        logs: telemetrySettings.retentionLogsDays,
      })
      .from(telemetrySettings)
      .where(eq(telemetrySettings.tenantId, tenantId));
    const [auditCount] = await tx
      .select({ n: count })
      .from(auditEvents)
      .where(and(eq(auditEvents.tenantId, tenantId), gte(auditEvents.createdAt, since90)));

    const qa = await tx
      .select({
        id: qaRuns.id,
        suite: qaRuns.suite,
        status: qaRuns.status,
        summary: qaRuns.summary,
        finishedAt: qaRuns.finishedAt,
        queuedAt: qaRuns.queuedAt,
      })
      .from(qaRuns)
      .where(eq(qaRuns.tenantId, tenantId))
      .orderBy(desc(qaRuns.queuedAt))
      .limit(40);

    const invited = memberRows.filter((m) => m.status === "invited");
    const invitationMails = invited.length
      ? await tx
          .select({ to: mailDeliveries.toAddress, createdAt: mailDeliveries.createdAt })
          .from(mailDeliveries)
          .where(and(eq(mailDeliveries.tenantId, tenantId), eq(mailDeliveries.kind, "invitation")))
          .orderBy(desc(mailDeliveries.createdAt))
          .limit(200)
      : [];

    return {
      memberRows,
      setCount: sets.length,
      usedSets: sets.filter((s) => usedSets.has(s.id)).length,
      customRoleCount: customRoleCount?.n ?? 0,
      sso,
      scim: scim ?? null,
      installs: installs.map((i) => i.kind as string),
      openChannels: openChannels?.n ?? 0,
      typeCount: typeCount?.n ?? 0,
      sevs: sevs.map((s) => s.name),
      fieldCount: fieldCount?.n ?? 0,
      annCount: annCount?.n ?? 0,
      ruleCount: ruleCount?.n ?? 0,
      prios: prios.map((p) => p.name),
      labelCount: Number((labelRows as unknown as Array<{ n: number }>)[0]?.n ?? 0),
      run: run ?? null,
      switches,
      keys,
      hooks,
      failing,
      lastFailures,
      acting: autonomy.filter((a) => Math.min(a.level, a.cap ?? a.level) >= 3).length,
      resolvedAlone: resolvedAlone?.n ?? 0,
      tel: tel ?? null,
      auditCount: auditCount?.n ?? 0,
      qa,
      invitationMails,
    };
  });
}

function latestPerSuite(facts: Facts) {
  const out = new Map<QaSuite, Facts["qa"][number]>();
  for (const r of facts.qa) if (!out.has(r.suite)) out.set(r.suite, r);
  return out;
}

export const settingsDirectory = cache(async () => {
  const { tenant, workspace, member } = await requireMember();
  const t = await getT();
  const cloud = getEdition() === "cloud";
  const ent = entitlementsFor(tenant);
  const facts = await readFacts(tenant.id);
  const now = Date.now();
  const rel = (d: Date) => t.fmt.relative(d);

  const status = (key: EntryKey): { status: string; tone?: "wait" | "dang" } => {
    switch (key) {
      case "general": {
        const lang =
          LOCALES.find((l) => l.code === workspace.locale)?.nativeName ?? workspace.locale;
        return {
          status: t("settingsV2.st.general", {
            name: workspace.name,
            timezone: workspace.timezone,
            language: lang,
          }),
        };
      }
      case "brand": {
        const b = workspace.branding;
        const logo = b.logoKey
          ? b.logoDarkKey
            ? t("settingsV2.st.logoBoth")
            : t("settingsV2.st.logoLight")
          : t("settingsV2.st.logoNone");
        return {
          status: b.accentColor
            ? t("settingsV2.st.brand", { accent: b.accentColor.toUpperCase(), logo })
            : t("settingsV2.st.brandDefault", { logo }),
        };
      }
      case "hours":
        return {
          status: facts.setCount
            ? t("settingsV2.st.hours", { count: facts.setCount, used: facts.usedSets })
            : t("settingsV2.st.hoursNone"),
        };
      case "billing": {
        const seats = facts.memberRows.filter((m) => m.status !== "disabled").length;
        return {
          status:
            ent.maxMembers != null
              ? t("settingsV2.st.billing", { seats, max: ent.maxMembers })
              : t("settingsV2.st.billingOpen", { seats }),
        };
      }
      case "members": {
        const active = facts.memberRows.filter((m) => m.status === "active").length;
        const invited = facts.memberRows.filter((m) => m.status === "invited").length;
        return {
          status: invited
            ? t("settingsV2.st.members", { active, invited })
            : t("settingsV2.st.membersOnly", { count: active }),
        };
      }
      case "roles":
        return { status: t("settingsV2.st.roles", { count: facts.customRoleCount }) };
      case "sso": {
        const first = facts.sso[0];
        if (!first) return { status: t("settingsV2.st.ssoNone") };
        const label =
          facts.sso.length > 1
            ? t("settingsV2.st.ssoMore", { label: first.label, count: facts.sso.length - 1 })
            : first.label;
        return {
          status:
            first.enforce && first.domains.length
              ? t("settingsV2.st.ssoOnly", { label, domains: first.domains.join(", ") })
              : t("settingsV2.st.ssoPasswords", { label }),
        };
      }
      case "scim":
        if (!facts.scim) return { status: t("settingsV2.st.scimNone") };
        if (!facts.scim.enabled) return { status: t("settingsV2.st.scimOff") };
        return {
          status: facts.scim.lastSeenAt
            ? t("settingsV2.st.scimSeen", { when: rel(facts.scim.lastSeenAt) })
            : t("settingsV2.st.scimNever"),
        };
      case "chat": {
        const parts: string[] = [];
        if (facts.installs.includes("slack")) parts.push(t("settingsV2.st.slack"));
        if (facts.installs.includes("teams")) parts.push(t("settingsV2.st.teams"));
        if (!parts.length) return { status: t("settingsV2.st.chatNone") };
        parts.push(t("settingsV2.st.channels", { count: facts.openChannels }));
        return { status: parts.join(" · ") };
      }
      case "types":
        return { status: t("settingsV2.st.types", { count: facts.typeCount }) };
      case "severities":
        return {
          status: facts.sevs.length
            ? facts.sevs.length === 1
              ? facts.sevs[0]!
              : t("settingsV2.st.range", {
                  first: facts.sevs[0]!,
                  last: facts.sevs[facts.sevs.length - 1]!,
                })
            : t("settingsV2.st.none"),
        };
      case "fields":
        return {
          status: facts.fieldCount
            ? t("settingsV2.st.fields", { count: facts.fieldCount })
            : t("settingsV2.st.fieldsNone"),
        };
      case "announcements": {
        const slack = facts.installs.includes("slack");
        const teams = facts.installs.includes("teams");
        const where =
          slack && teams
            ? t("settingsV2.st.annBoth")
            : slack
              ? t("settingsV2.st.annSlack")
              : teams
                ? t("settingsV2.st.annTeams")
                : t("settingsV2.st.annNowhere");
        return { status: t("settingsV2.st.announcements", { count: facts.annCount, where }) };
      }
      case "rules":
        return {
          status: facts.ruleCount
            ? t("settingsV2.st.rules", { count: facts.ruleCount })
            : t("settingsV2.st.rulesNone"),
        };
      case "alertSeverities":
        return {
          status: facts.prios.length
            ? t("settingsV2.st.range", {
                first: facts.prios[0]!,
                last: facts.prios[facts.prios.length - 1]!,
              })
            : t("settingsV2.st.none"),
        };
      case "labels":
        return {
          status: facts.labelCount
            ? t("settingsV2.st.labels", { count: facts.labelCount })
            : t("settingsV2.st.labelsNone"),
        };
      case "migrate": {
        const run = facts.run;
        if (!run) return { status: t("settingsV2.st.migrateNone") };
        if (run.completedAt) return { status: t("settingsV2.st.migrateDone") };
        const days = Math.max(0, Math.ceil((OPSGENIE_SHUTDOWN.getTime() - now) / DAY));
        const switched = facts.switches.filter((s) => s.state === "switched").length;
        return {
          status: t("settingsV2.st.migrate", {
            days,
            switched,
            teams: facts.switches.length,
          }),
          tone: "wait",
        };
      }
      case "integrations": {
        const n = facts.installs.length;
        return {
          status: n
            ? t("settingsV2.st.integrations", { count: n })
            : t("settingsV2.st.integrationsNone"),
        };
      }
      case "api": {
        const parts: string[] = [];
        if (facts.keys.length) parts.push(t("settingsV2.st.keys", { count: facts.keys.length }));
        if (facts.failing.length)
          parts.push(t("settingsV2.st.hooksFailing", { count: facts.failing.length }));
        else if (facts.hooks.length)
          parts.push(t("settingsV2.st.hooks", { count: facts.hooks.length }));
        return {
          status: parts.length ? parts.join(" · ") : t("settingsV2.st.apiNone"),
          tone: facts.failing.length ? "wait" : undefined,
        };
      }
      case "atlas":
        return {
          status: facts.acting
            ? t("settingsV2.st.atlas", { acting: facts.acting, resolved: facts.resolvedAlone })
            : t("settingsV2.st.atlasIdle"),
        };
      case "telemetry":
        if (!telemetryInstalled()) return { status: t("settingsV2.st.notInstalled") };
        return {
          status: t("settingsV2.st.telemetry", {
            traces: facts.tel?.traces ?? 15,
            logs: facts.tel?.logs ?? 15,
          }),
        };
      case "audit":
        return { status: t("settingsV2.st.audit", { count: facts.auditCount }) };
      case "qa": {
        if (member.role !== "owner") return { status: t("settingsV2.st.qaOwners") };
        const latest = latestPerSuite(facts);
        if (!latest.size) return { status: t("settingsV2.st.qaNever") };
        const runs = [...latest.values()];
        if (runs.some((r) => r.status === "queued" || r.status === "running"))
          return { status: t("settingsV2.st.qaRunning") };
        const failed = runs.find((r) => r.status === "failed" || r.status === "error");
        if (failed)
          return {
            status: t("settingsV2.st.qaFailed", {
              suite: t(`settingsV2.suite.${failed.suite}`),
              when: rel(failed.finishedAt ?? failed.queuedAt),
            }),
            tone: "dang",
          };
        const last = runs
          .map((r) => r.finishedAt ?? r.queuedAt)
          .sort((a, b) => b.getTime() - a.getTime())[0]!;
        return { status: t("settingsV2.st.qaPassed", { when: rel(last) }) };
      }
    }
  };

  const groups: DirectoryGroup[] = GROUPS.map((g) => ({
    key: g.key,
    title: t(`settingsV2.group.${g.key}`),
    desc: t(`settingsV2.groupDesc.${g.key}`),
    entries: g.entries
      .filter((e) => !e.cloudOnly || cloud)
      .filter((e) => hasPermission(member, e.permission))
      .map((e) => {
        const locked = e.ee ? !ent[e.ee] : false;
        const s = locked
          ? { status: t("settingsV2.st.eeLocked") }
          : e.key === "telemetry" && !telemetryInstalled()
            ? { status: t("settingsV2.st.notInstalled") }
            : status(e.key);
        return {
          key: e.key,
          href: e.href,
          label: t(`settingsV2.entry.${e.key}`),
          status: s.status,
          tone: s.tone,
          locked,
          paths: [e.href, ...(e.paths ?? [])],
          permission: e.permission,
        };
      }),
  })).filter((g) => g.entries.length > 0);

  const can = (p: Permission) => hasPermission(member, p);
  const label = (k: EntryKey) => t(`settingsV2.entry.${k}`);
  const attention: AttentionItem[] = [];

  // Opsgenie: a migration under way, and the days that are left.
  if (can("settings.platform") && facts.run && !facts.run.completedAt) {
    const days = Math.max(0, Math.ceil((OPSGENIE_SHUTDOWN.getTime() - now) / DAY));
    const name = (s: Facts["switches"][number]) => s.team ?? s.external;
    const switched = facts.switches.filter((s) => s.state === "switched").map(name);
    const pending = facts.switches.filter((s) => s.state !== "switched").map(name);
    const subParts = [
      switched.length
        ? t("settingsV2.att.opsgenieSwitched", { count: switched.length, teams: list(t, switched) })
        : t("settingsV2.att.opsgenieNoneSwitched"),
    ];
    if (pending.length)
      subParts.push(
        t("settingsV2.att.opsgeniePending", { count: pending.length, teams: list(t, pending) }),
      );
    attention.push({
      tone: "wait",
      title: t("settingsV2.att.opsgenie", { count: days }),
      sub: subParts.join(" · "),
      where: label("migrate"),
      href: "/app/settings/migrate",
    });
  }

  // Diagnostics: a suite whose last run failed.
  if (member.role === "owner") {
    for (const r of latestPerSuite(facts).values()) {
      if (r.status !== "failed" && r.status !== "error") continue;
      const total = r.summary?.total;
      const failedN = r.summary?.failed;
      attention.push({
        tone: "dang",
        title: t(`settingsV2.att.qa.${r.suite}`, { when: rel(r.finishedAt ?? r.queuedAt) }),
        sub:
          r.status === "failed" && total && failedN != null
            ? t("settingsV2.att.qaSub", { failed: failedN, total })
            : t("settingsV2.att.qaError"),
        where: label("qa"),
        href: `/app/settings/qa/${r.id}`,
      });
    }
  }

  // API keys about to expire — within 30 days.
  if (can("settings.platform")) {
    for (const k of facts.keys) {
      if (!k.expiresAt) continue;
      const left = k.expiresAt.getTime() - now;
      if (left <= 0 || left > 30 * DAY) continue;
      const days = Math.floor(left / DAY);
      attention.push({
        tone: "wait",
        title:
          days === 0
            ? t("settingsV2.att.keyToday", { name: k.name })
            : t("settingsV2.att.key", { name: k.name, count: days }),
        sub: k.lastUsedAt
          ? t("settingsV2.att.keyUsed", { when: rel(k.lastUsedAt) })
          : t("settingsV2.att.keyUnused"),
        where: label("api"),
        href: "/app/settings/api",
      });
    }
    // Webhook endpoints in a failure streak.
    for (const h of facts.failing) {
      const last = facts.lastFailures.find((d) => d.endpointId === h.id);
      let host = h.url;
      try {
        host = new URL(h.url).host;
      } catch {
        /* the raw URL then */
      }
      const since = h.failingSince!;
      const sameDay = now - since.getTime() < DAY;
      attention.push({
        tone: "wait",
        title: t("settingsV2.att.hook", {
          when: sameDay ? t.fmt.time(since) : t.fmt.dateShort(since),
        }),
        sub: last?.httpStatus
          ? t("settingsV2.att.hookAnswers", { host, status: String(last.httpStatus) })
          : t("settingsV2.att.hookSilent", { host }),
        where: label("api"),
        href: "/app/settings/api",
      });
    }
  }

  // Invitations nobody answered for three days or more.
  if (can("settings.members")) {
    const invited = facts.memberRows
      .filter((m) => m.status === "invited")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const m of invited) {
      const pendingDays = Math.floor((now - m.createdAt.getTime()) / DAY);
      if (pendingDays < 3) continue;
      const lastSent =
        facts.invitationMails.find((d) => d.to.toLowerCase() === m.email.toLowerCase())
          ?.createdAt ?? m.createdAt;
      const expires = lastSent.getTime() + 7 * DAY;
      const leftDays = Math.ceil((expires - now) / DAY);
      attention.push({
        tone: "mute",
        title: t("settingsV2.att.invite", { email: m.email, count: pendingDays }),
        sub:
          expires > now
            ? t("settingsV2.att.inviteExpires", { when: inDays(t, leftDays) })
            : t("settingsV2.att.inviteExpired"),
        where: label("members"),
        href: "/app/settings/members?f=invited",
      });
      if (attention.filter((a) => a.href.startsWith("/app/settings/members")).length >= 3) break;
    }
  }

  return {
    groups,
    attention,
    workspaceName: workspace.name,
    cloud,
    role: member.role,
  };
});
